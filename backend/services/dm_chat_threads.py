"""Build DM thread list for /api/chat_threads (MySQL + SQLite)."""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from flask import url_for

from backend.services.chat_message_preview import preview_from_message_row
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.dm_chats_tables import ensure_archived_chats_table
from backend.services.dm_human_thread import (
    dm_last_message_where_clause,
    ensure_human_dm_thread_column,
    human_pair_thread_key,
    is_private_steve_dm_peer,
)
from backend.services.profile_pictures import CaseInsensitiveUserMap
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


def _fetch_last_message_row(
    cursor,
    ph: str,
    username: str,
    other_username: str,
    deleted_after: str | None,
) -> Any:
    """Load the latest message row with media columns when available."""
    try:
        ensure_human_dm_thread_column(cursor)
    except Exception:
        pass
    base_where, base_params = dm_last_message_where_clause(
        ph, viewer=username, peer=other_username
    )
    if deleted_after:
        where = f"{base_where} AND timestamp > {ph}"
        params = base_params + (deleted_after,)
    else:
        where = base_where
        params = base_params

    full_select = f"""
        SELECT message, timestamp, sender, is_encrypted,
               image_path, video_path, audio_path, audio_summary, media_paths
        FROM messages
        WHERE {where}
        ORDER BY timestamp DESC
        LIMIT 1
    """
    minimal_select = f"""
        SELECT message, timestamp, sender
        FROM messages
        WHERE {where}
        ORDER BY timestamp DESC
        LIMIT 1
    """
    try:
        cursor.execute(full_select, params)
        return cursor.fetchone()
    except Exception:
        try:
            cursor.execute(minimal_select, params)
            return cursor.fetchone()
        except Exception:
            return None


def _ts_norm(value: object) -> str:
    """Normalize a message timestamp (datetime or string) to a lexicographically
    comparable second-precision string ("YYYY-MM-DD HH:MM:SS")."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return str(value).strip().replace("T", " ")[:19]


def _ts_after(ts_value: object, cutoff: str) -> bool:
    """Mirror the legacy SQL ``timestamp > deleted_after`` (second precision)."""
    return _ts_norm(ts_value) > _ts_norm(cutoff)


_BATCH_ROW_COLS = (
    "id, message, timestamp, sender, is_encrypted, "
    "image_path, video_path, audio_path, audio_summary, media_paths"
)
_BATCH_ROW_KEYS = (
    "id", "message", "timestamp", "sender", "is_encrypted",
    "image_path", "video_path", "audio_path", "audio_summary", "media_paths",
)


def _batch_thread_stats(
    c, ph: str, username: str, counterpart_usernames: list[str]
) -> tuple[dict[str, dict], dict[str, int]]:
    """Batched replacement for the per-thread N+1 loop.

    Returns ``(last_by_peer, unread_by_peer)`` keyed by ``peer.lower()``:
    - newest visible message row per counterpart (same visibility rules as
      :func:`dm_last_message_where_clause`: normal pair rows plus Steve rows
      tagged for that pair; the private Steve thread sees only untagged rows),
    - unread counts per counterpart (``deleted_chat_threads`` cutoffs are NOT
      applied here — the caller keeps the legacy per-peer query for those rare
      threads, preserving exact semantics).

    Any failure (old MySQL without window functions, missing media columns)
    must be caught by the caller, which falls back to the legacy per-thread
    queries.
    """
    try:
        ensure_human_dm_thread_column(c)
    except Exception:
        pass

    last_by_peer: dict[str, dict] = {}

    def _consider(peer_key: str, row_dict: dict) -> None:
        cur = last_by_peer.get(peer_key)
        if cur is None:
            last_by_peer[peer_key] = row_dict
            return
        newer = (_ts_norm(row_dict.get("timestamp")), int(row_dict.get("id") or 0))
        existing = (_ts_norm(cur.get("timestamp")), int(cur.get("id") or 0))
        if newer > existing:
            last_by_peer[peer_key] = row_dict

    def _row_to_dict(r, lead_key: str) -> dict:
        keys = (lead_key,) + _BATCH_ROW_KEYS
        if hasattr(r, "keys"):
            return {k: r[k] for k in keys}
        return dict(zip(keys, r))

    # Newest normal-pair row per counterpart. Steve rows tagged for a human
    # pair are excluded here (they belong to that pair, handled below); the
    # private Steve thread keeps its untagged rows via peer = 'steve'.
    c.execute(
        f"""
        SELECT peer, {_BATCH_ROW_COLS} FROM (
            SELECT CASE WHEN sender = {ph} THEN receiver ELSE sender END AS peer,
                   {_BATCH_ROW_COLS},
                   ROW_NUMBER() OVER (
                       PARTITION BY (CASE WHEN sender = {ph} THEN receiver ELSE sender END)
                       ORDER BY timestamp DESC, id DESC
                   ) AS rn
            FROM messages
            WHERE (sender = {ph} OR receiver = {ph})
              AND NOT (sender = 'steve' AND human_dm_thread IS NOT NULL AND human_dm_thread <> '')
        ) ranked
        WHERE rn = 1
        """,
        (username, username, username, username),
    )
    for r in c.fetchall():
        d = _row_to_dict(r, "peer")
        peer = str(d.pop("peer") or "")
        if peer:
            _consider(peer.lower(), d)

    # Newest Steve in-thread row per human pair the viewer belongs to.
    thr_to_peer: dict[str, str] = {}
    for peer in counterpart_usernames:
        if not is_private_steve_dm_peer(peer):
            thr_to_peer[human_pair_thread_key(username, peer)] = peer.lower()
    if thr_to_peer:
        placeholders = ",".join([ph] * len(thr_to_peer))
        c.execute(
            f"""
            SELECT thr, {_BATCH_ROW_COLS} FROM (
                SELECT human_dm_thread AS thr, {_BATCH_ROW_COLS},
                       ROW_NUMBER() OVER (
                           PARTITION BY human_dm_thread
                           ORDER BY timestamp DESC, id DESC
                       ) AS rn
                FROM messages
                WHERE sender = 'steve' AND human_dm_thread IN ({placeholders})
            ) ranked
            WHERE rn = 1
            """,
            tuple(thr_to_peer.keys()),
        )
        for r in c.fetchall():
            d = _row_to_dict(r, "thr")
            thr = str(d.pop("thr") or "")
            peer_key = thr_to_peer.get(thr)
            if peer_key:
                _consider(peer_key, d)

    # Unread per counterpart. Human senders are never tagged, so excluding
    # tagged Steve rows here only affects the private Steve thread (untagged
    # rows only); tagged Steve rows are attributed to their human pair below.
    unread_by_peer: dict[str, int] = {}
    c.execute(
        f"""
        SELECT sender, COUNT(*) AS cnt FROM messages
        WHERE receiver = {ph} AND is_read = 0
          AND NOT (sender = 'steve' AND human_dm_thread IS NOT NULL AND human_dm_thread <> '')
        GROUP BY sender
        """,
        (username,),
    )
    for r in c.fetchall():
        sender = r["sender"] if hasattr(r, "keys") else r[0]
        cnt = r["cnt"] if hasattr(r, "keys") else r[1]
        key = str(sender or "").lower()
        unread_by_peer[key] = unread_by_peer.get(key, 0) + int(cnt or 0)

    # Unread Steve in-thread rows count toward the human pair they belong to.
    # The badge count (count_dm_unread_excluding_cleared) includes these rows,
    # so leaving them out of every thread produced a "ghost badge": unread > 0
    # with no thread showing unread and no way to clear it.
    if thr_to_peer:
        placeholders = ",".join([ph] * len(thr_to_peer))
        c.execute(
            f"""
            SELECT human_dm_thread AS thr, COUNT(*) AS cnt FROM messages
            WHERE receiver = {ph} AND is_read = 0 AND sender = 'steve'
              AND human_dm_thread IN ({placeholders})
            GROUP BY human_dm_thread
            """,
            (username,) + tuple(thr_to_peer.keys()),
        )
        for r in c.fetchall():
            thr = r["thr"] if hasattr(r, "keys") else r[0]
            cnt = r["cnt"] if hasattr(r, "keys") else r[1]
            peer_key = thr_to_peer.get(str(thr or ""))
            if peer_key:
                unread_by_peer[peer_key] = unread_by_peer.get(peer_key, 0) + int(cnt or 0)

    return last_by_peer, unread_by_peer


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

            try:
                ensure_human_dm_thread_column(c)
            except Exception:
                pass
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
            # Case-insensitive map: messages store the session spelling, which
            # can differ from user_profiles.username.
            profile_map = CaseInsensitiveUserMap()
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
                        profile_map.set(profile_username, {
                            "display_name": display_name,
                            "profile_picture_url": pic_url,
                        })
                except Exception as profile_err:
                    logger.warning("Could not batch fetch chat thread profiles: %s", profile_err)

            # Batched last-message + unread stats (2N+1 queries → 3). Any failure
            # falls back to the legacy per-thread queries below.
            batch_stats: tuple[dict[str, dict], dict[str, int]] | None = None
            try:
                if counterpart_usernames:
                    batch_stats = _batch_thread_stats(c, ph, username, counterpart_usernames)
                else:
                    batch_stats = ({}, {})
            except Exception as batch_err:
                logger.warning(
                    "chat_threads batch stats failed for %s; using per-thread queries: %s",
                    username,
                    batch_err,
                )
                batch_stats = None

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
                    if batch_stats is not None:
                        last_row = batch_stats[0].get(other_username.lower())
                        # Legacy applied ``timestamp > deleted_after`` in SQL; on the
                        # single newest row that reduces to this check.
                        if (
                            del_at_for_preview
                            and last_row is not None
                            and not _ts_after(last_row.get("timestamp"), del_at_for_preview)
                        ):
                            last_row = None
                    else:
                        last_row = _fetch_last_message_row(
                            c, ph, username, other_username, del_at_for_preview
                        )
                    if is_private_steve_dm_peer(other_username) and not last_row:
                        continue
                    last_message_text = None
                    last_activity_time = None
                    last_sender = None
                    is_encrypted = False
                    if last_row:
                        if hasattr(last_row, "keys"):
                            last_activity_time = last_row["timestamp"]
                            last_sender = last_row["sender"]
                            try:
                                is_encrypted = bool(last_row["is_encrypted"])
                            except (KeyError, IndexError, TypeError):
                                is_encrypted = False
                        else:
                            last_activity_time = last_row[1]
                            last_sender = last_row[2]
                            is_encrypted = bool(last_row[3]) if len(last_row) > 3 else False

                        preview = preview_from_message_row(last_row)
                        last_message_text = preview or None
                        if is_encrypted and not preview:
                            last_message_text = "Encrypted message"

                    if del_at_for_preview and not last_activity_time:
                        da = str(del_at_for_preview).strip()
                        if len(da) >= 19:
                            last_activity_time = da[:10] + "T" + da[11:19] + "Z"
                        else:
                            last_activity_time = da

                    if batch_stats is not None and not del_at_for_preview:
                        unread_count = batch_stats[1].get(other_username.lower(), 0)
                    else:
                        # Deleted-thread cutoffs (rare) keep the exact legacy query;
                        # also the full fallback path when batching failed.
                        if del_at_for_preview:
                            if is_private_steve_dm_peer(other_username):
                                c.execute(
                                    f"SELECT COUNT(*) as count FROM messages WHERE sender={ph} AND receiver={ph} "
                                    f"AND is_read=0 AND timestamp > {ph} "
                                    f"AND (human_dm_thread IS NULL OR human_dm_thread = '')",
                                    ("steve", username, del_at_for_preview),
                                )
                            else:
                                c.execute(
                                    f"SELECT COUNT(*) as count FROM messages WHERE receiver={ph} AND is_read=0 AND timestamp > {ph} "
                                    f"AND (sender={ph} OR (sender='steve' AND human_dm_thread={ph}))",
                                    (username, del_at_for_preview, other_username,
                                     human_pair_thread_key(username, other_username)),
                                )
                        else:
                            if is_private_steve_dm_peer(other_username):
                                c.execute(
                                    f"SELECT COUNT(*) as count FROM messages WHERE sender={ph} AND receiver={ph} "
                                    f"AND is_read=0 AND (human_dm_thread IS NULL OR human_dm_thread = '')",
                                    ("steve", username),
                                )
                            else:
                                # Same visibility as the thread itself: peer rows
                                # plus Steve in-thread rows tagged for this pair.
                                c.execute(
                                    f"SELECT COUNT(*) as count FROM messages WHERE receiver={ph} AND is_read=0 "
                                    f"AND (sender={ph} OR (sender='steve' AND human_dm_thread={ph}))",
                                    (username, other_username,
                                     human_pair_thread_key(username, other_username)),
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
