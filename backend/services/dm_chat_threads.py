"""Build DM thread list for /api/chat_threads (MySQL + SQLite)."""

from __future__ import annotations

import logging
from datetime import date, datetime

from flask import url_for

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.dm_chats_tables import ensure_archived_chats_table
from redis_cache import CHAT_THREADS_TTL, cache

logger = logging.getLogger(__name__)


def _normalize_last_activity_time(value: object) -> str | None:
    """Thread list JSON + sort: one comparable type (ISO-like string), never datetime vs str."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(sep="T", timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip()
    return s if s else None


def build_chat_threads_payload(username: str) -> dict:
    """
    Return { success, threads } or { success, error }.
    Uses Redis cache chat_threads:{username}.
    """
    cache_key = f"chat_threads:{username}"
    cached_threads = cache.get(cache_key)
    if cached_threads:
        logger.debug("Cache hit: chat_threads for %s", username)
        return {"success": True, "threads": cached_threads}

    ph = get_sql_placeholder()

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            ensure_archived_chats_table(c)
            try:
                c.execute(f"SELECT other_username FROM archived_chats WHERE username = {ph}", (username,))
                archived_set = set(
                    r["other_username"] if hasattr(r, "keys") else r[0] for r in c.fetchall()
                )
            except Exception:
                archived_set = set()

            deleted_threads: dict[str, str | None] = {}
            try:
                c.execute(f"SELECT other_username, deleted_at FROM deleted_chat_threads WHERE username = {ph}", (username,))
                for dr in c.fetchall():
                    other = dr["other_username"] if hasattr(dr, "keys") else dr[0]
                    dat = dr["deleted_at"] if hasattr(dr, "keys") else dr[1]
                    deleted_threads[other] = str(dat) if dat else None
            except Exception:
                pass

            muted_chats: set[str] = set()
            try:
                c.execute(f"SELECT chat_key FROM user_muted_chats WHERE username = {ph}", (username,))
                for mr in c.fetchall():
                    chat_key = mr["chat_key"] if hasattr(mr, "keys") else mr[0]
                    if chat_key.startswith("dm:"):
                        muted_chats.add(chat_key[3:])
            except Exception:
                pass

            c.execute(
                f"""
                SELECT DISTINCT receiver AS other_username
                FROM messages
                WHERE sender = {ph}
                UNION
                SELECT DISTINCT sender AS other_username
                FROM messages
                WHERE receiver = {ph}
                ORDER BY other_username
                """,
                (username, username),
            )
            counterpart_rows = c.fetchall()

            blocked_set: set[str] = set()
            try:
                c.execute(
                    f"""
                    SELECT blocked_username FROM blocked_users WHERE blocker_username = {ph}
                    UNION
                    SELECT blocker_username FROM blocked_users WHERE blocked_username = {ph}
                    """,
                    (username, username),
                )
                blocked_set = set(
                    r["blocked_username"] if hasattr(r, "keys") else r[0] for r in c.fetchall()
                )
            except Exception as blocked_err:
                logger.warning("Could not get blocked users for chat threads: %s", blocked_err)

            counterpart_usernames = [
                row["other_username"] if isinstance(row, dict) or hasattr(row, "keys") else row[0]
                for row in counterpart_rows
            ]
            profile_map: dict[str, dict] = {}
            if counterpart_usernames:
                try:
                    placeholders = ",".join([ph] * len(counterpart_usernames))
                    c.execute(
                        f"SELECT username, display_name, profile_picture FROM user_profiles WHERE username IN ({placeholders})",
                        tuple(counterpart_usernames),
                    )
                    for profile_row in c.fetchall():
                        profile_username = profile_row["username"] if hasattr(profile_row, "keys") else profile_row[0]
                        display_name = profile_row["display_name"] if hasattr(profile_row, "keys") else profile_row[1]
                        profile_picture_rel = profile_row["profile_picture"] if hasattr(profile_row, "keys") else profile_row[2]
                        pic_url = None
                        if profile_picture_rel:
                            pr = str(profile_picture_rel).strip()
                            if pr.startswith("http://") or pr.startswith("https://"):
                                pic_url = pr
                            else:
                                pic_url = url_for("static", filename=pr)
                        profile_map[profile_username] = {
                            "display_name": display_name,
                            "profile_picture_url": pic_url,
                        }
                except Exception as profile_err:
                    logger.warning("Could not batch fetch chat thread profiles: %s", profile_err)

            threads: list[dict] = []
            for row in counterpart_rows:
                try:
                    other_username = (
                        row["other_username"] if isinstance(row, dict) or hasattr(row, "keys") else row[0]
                    )

                    if other_username in archived_set:
                        continue
                    if other_username in blocked_set:
                        continue

                    del_at_for_preview = deleted_threads.get(other_username) if other_username in deleted_threads else None
                    try:
                        if del_at_for_preview:
                            c.execute(
                                f"""
                                SELECT message, timestamp, sender, is_encrypted
                                FROM messages
                                WHERE ((sender = {ph} AND receiver = {ph}) OR (sender = {ph} AND receiver = {ph}))
                                  AND timestamp > {ph}
                                ORDER BY timestamp DESC
                                LIMIT 1
                                """,
                                (username, other_username, other_username, username, del_at_for_preview),
                            )
                        else:
                            c.execute(
                                f"""
                                SELECT message, timestamp, sender, is_encrypted
                                FROM messages
                                WHERE (sender = {ph} AND receiver = {ph}) OR (sender = {ph} AND receiver = {ph})
                                ORDER BY timestamp DESC
                                LIMIT 1
                                """,
                                (username, other_username, other_username, username),
                            )
                    except Exception:
                        if del_at_for_preview:
                            c.execute(
                                f"""
                                SELECT message, timestamp, sender
                                FROM messages
                                WHERE ((sender = {ph} AND receiver = {ph}) OR (sender = {ph} AND receiver = {ph}))
                                  AND timestamp > {ph}
                                ORDER BY timestamp DESC
                                LIMIT 1
                                """,
                                (username, other_username, other_username, username, del_at_for_preview),
                            )
                        else:
                            c.execute(
                                f"""
                                SELECT message, timestamp, sender
                                FROM messages
                                WHERE (sender = {ph} AND receiver = {ph}) OR (sender = {ph} AND receiver = {ph})
                                ORDER BY timestamp DESC
                                LIMIT 1
                                """,
                                (username, other_username, other_username, username),
                            )
                    last_row = c.fetchone()
                    last_message_text = None
                    last_activity_time = None
                    last_sender = None
                    is_encrypted = False
                    if last_row:
                        if hasattr(last_row, "keys"):
                            last_message_text = last_row["message"]
                            last_activity_time = last_row["timestamp"]
                            last_sender = last_row["sender"]
                            try:
                                is_encrypted = bool(last_row["is_encrypted"])
                            except (KeyError, IndexError, TypeError):
                                is_encrypted = False
                        else:
                            last_message_text = last_row[0]
                            last_activity_time = last_row[1]
                            last_sender = last_row[2]
                            is_encrypted = bool(last_row[3]) if len(last_row) > 3 else False

                    if is_encrypted and not last_message_text:
                        last_message_text = "🔒 Encrypted message"

                    if del_at_for_preview and not last_activity_time:
                        da = str(del_at_for_preview).strip()
                        if len(da) >= 19:
                            last_activity_time = da[:10] + "T" + da[11:19] + "Z"
                        else:
                            last_activity_time = da

                    if del_at_for_preview:
                        c.execute(
                            f"SELECT COUNT(*) as count FROM messages WHERE sender={ph} AND receiver={ph} AND is_read=0 AND timestamp > {ph}",
                            (other_username, username, del_at_for_preview),
                        )
                    else:
                        c.execute(
                            f"SELECT COUNT(*) as count FROM messages WHERE sender={ph} AND receiver={ph} AND is_read=0",
                            (other_username, username),
                        )
                    unread_row = c.fetchone()
                    unread_count = (
                        unread_row["count"]
                        if hasattr(unread_row, "keys")
                        else (unread_row[0] if unread_row else 0)
                    )

                    profile = profile_map.get(other_username) or {}
                    display_name = profile.get("display_name") or other_username
                    profile_picture_url = profile.get("profile_picture_url")

                    threads.append(
                        {
                            "other_username": other_username,
                            "display_name": display_name,
                            "profile_picture_url": profile_picture_url,
                            "last_message_text": last_message_text,
                            "last_activity_time": _normalize_last_activity_time(last_activity_time),
                            "last_sender": last_sender,
                            "unread_count": int(unread_count or 0),
                            "muted": other_username in muted_chats,
                        }
                    )
                except Exception as inner_e:
                    logger.warning("Failed to build thread for counterpart: %s", inner_e)
                    continue

        threads = [t for t in threads if t.get("other_username")]
        threads.sort(key=lambda t: (t.get("last_activity_time") or ""), reverse=True)

        cache.set(cache_key, threads, CHAT_THREADS_TTL)
        logger.debug("Cached chat_threads for %s", username)

        return {"success": True, "threads": threads}
    except Exception as e:
        logger.error("Error building chat threads for %s: %s", username, e)
        return {"success": False, "error": "Failed to load chats"}
