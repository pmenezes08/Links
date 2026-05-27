"""DM thread archive/unarchive and archived list. Extracted from bodybuilding_app monolith."""

from __future__ import annotations

import logging
from typing import Callable, Optional, Tuple

from backend.services.chat_message_preview import preview_from_message_row
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.dm_chats_tables import ensure_archived_chats_table
from backend.services.dm_chat_threads import _fetch_last_message_row
from redis_cache import cache

logger = logging.getLogger(__name__)


def archive_dm_thread(username: str, *, other_username: Optional[str] = None) -> Tuple[dict, int]:
    """Archive a chat thread (hide from main list)."""
    if not other_username:
        return {"success": False, "error": "Other username required"}, 200
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_archived_chats_table(c)
            conn.commit()
            ph = get_sql_placeholder()
            try:
                c.execute(
                    f"INSERT INTO archived_chats (username, other_username) VALUES ({ph}, {ph})",
                    (username, other_username),
                )
            except Exception:
                pass
            conn.commit()
            try:
                cache.delete(f"chat_threads:{username}")
            except Exception:
                pass
        return {"success": True}, 200
    except Exception as e:
        logger.error("archive_dm_thread error: %s", e)
        return {"success": False, "error": "Failed to archive chat"}, 500


def unarchive_dm_thread(username: str, *, other_username: Optional[str] = None) -> Tuple[dict, int]:
    """Unarchive a chat thread (show in main list again)."""
    if not other_username:
        return {"success": False, "error": "Other username required"}, 200
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_archived_chats_table(c)
            ph = get_sql_placeholder()
            c.execute(
                f"DELETE FROM archived_chats WHERE username = {ph} AND other_username = {ph}",
                (username, other_username),
            )
            conn.commit()
            try:
                cache.delete(f"chat_threads:{username}")
            except Exception:
                pass
        return {"success": True}, 200
    except Exception as e:
        logger.error("unarchive_dm_thread error for %s with %s: %s", username, other_username, e)
        return {"success": False, "error": "Failed to unarchive chat"}, 500


def list_archived_dm_threads(
    username: str,
    *,
    static_url_for: Callable[..., str],
) -> Tuple[dict, int]:
    """Return list of archived chat threads for the current user."""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_archived_chats_table(c)
            conn.commit()
            ph = get_sql_placeholder()

            c.execute(
                f"SELECT other_username FROM archived_chats WHERE LOWER(username) = LOWER({ph})",
                (username,),
            )
            archived_rows = c.fetchall()

            if not archived_rows:
                return {"success": True, "threads": []}, 200

            archived_usernames = []
            for r in archived_rows:
                if hasattr(r, "get"):
                    other_user = r.get("other_username")
                elif hasattr(r, "keys"):
                    other_user = r["other_username"]
                else:
                    other_user = r[0]
                if other_user:
                    archived_usernames.append(other_user)

            threads = []
            for other_username in archived_usernames:
                try:
                    c.execute(
                        f"SELECT display_name, profile_picture FROM user_profiles WHERE username = {ph}",
                        (other_username,),
                    )
                    profile_row = c.fetchone()
                    display_name = other_username
                    profile_picture = None

                    if profile_row:
                        if hasattr(profile_row, "get"):
                            display_name = profile_row.get("display_name") or other_username
                            profile_picture = profile_row.get("profile_picture")
                        elif hasattr(profile_row, "keys"):
                            display_name = profile_row["display_name"] or other_username
                            profile_picture = (
                                profile_row["profile_picture"]
                                if "profile_picture" in profile_row.keys()
                                else None
                            )
                        else:
                            display_name = profile_row[0] or other_username
                            profile_picture = profile_row[1] if len(profile_row) > 1 else None

                    msg_row = _fetch_last_message_row(c, ph, username, other_username, None)
                    last_message_text = None
                    last_activity_time = None
                    if msg_row:
                        if hasattr(msg_row, "get"):
                            last_activity_time = msg_row.get("timestamp")
                        elif hasattr(msg_row, "keys"):
                            last_activity_time = msg_row["timestamp"]
                        else:
                            last_activity_time = msg_row[1] if len(msg_row) > 1 else None
                        preview = preview_from_message_row(msg_row)
                        last_message_text = preview or None

                    profile_picture_url = (
                        static_url_for("static", filename=profile_picture) if profile_picture else None
                    )

                    threads.append(
                        {
                            "other_username": other_username,
                            "display_name": display_name,
                            "profile_picture_url": profile_picture_url,
                            "last_message_text": last_message_text,
                            "last_activity_time": str(last_activity_time) if last_activity_time else None,
                            "is_archived": True,
                        }
                    )
                except Exception as thread_err:
                    logger.warning("Failed to build archived thread for %s: %s", other_username, thread_err)

            threads.sort(key=lambda t: (t.get("last_activity_time") or ""), reverse=True)
            return {"success": True, "threads": threads}, 200
    except Exception as e:
        logger.error("list_archived_dm_threads error for %s: %s", username, e)
        return {"success": False, "error": "Failed to load archived chats"}, 500
