"""Per-thread keyword search for DM and group chat messages (MySQL FULLTEXT)."""

from __future__ import annotations

import json
import logging
from typing import Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# DM thread search
# ---------------------------------------------------------------------------

def search_dm_thread(
    viewer: str,
    other_username: str,
    query: str,
    limit: int = 20,
    offset: int = 0,
) -> tuple[int, list[dict], bool]:
    """Return ``(total_count, messages, has_more)`` for a keyword search in a DM thread."""
    try:
        from backend.services.dm_human_thread import (
            dm_messages_where_clause,
            ensure_human_dm_thread_column,
            human_pair_thread_key,
        )

        ph = get_sql_placeholder()
        thr_key = human_pair_thread_key(viewer, other_username)

        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_human_dm_thread_column(c)

            where, base_params = dm_messages_where_clause(
                ph, viewer=viewer, peer=other_username, thr_key=thr_key,
            )

            # deleted_at filter (one-sided clear)
            deleted_clause = ""
            deleted_params: tuple = ()
            try:
                c.execute(
                    f"SELECT deleted_at FROM deleted_chat_threads WHERE username = {ph} AND other_username = {ph}",
                    (viewer, other_username),
                )
                del_row = c.fetchone()
                if del_row:
                    da = del_row["deleted_at"] if hasattr(del_row, "keys") else del_row[0]
                    if da:
                        deleted_clause = f" AND timestamp > {ph}"
                        deleted_params = (str(da),)
            except Exception:
                pass

            search_clause = f" AND message LIKE {ph}"
            search_params = (f"%{query}%",)

            full_where = f"{where}{deleted_clause}{search_clause}"
            count_params = base_params + deleted_params + search_params

            c.execute(f"SELECT COUNT(*) FROM messages WHERE {full_where}", count_params)
            total = (c.fetchone() or (0,))[0]

            has_media_paths = True
            has_file_cols = True
            try:
                c.execute(
                    f"SELECT id, sender, receiver, message, image_path, video_path,"
                    f" audio_path, audio_duration_seconds, timestamp, edited_at,"
                    f" reaction, reaction_by, media_paths, file_path, file_name"
                    f" FROM messages WHERE {full_where}"
                    f" ORDER BY timestamp DESC LIMIT {ph} OFFSET {ph}",
                    count_params + (limit, offset),
                )
            except Exception:
                has_media_paths = False
                has_file_cols = False
                try:
                    c.execute(
                        f"SELECT id, sender, receiver, message, image_path, video_path,"
                        f" audio_path, audio_duration_seconds, timestamp, edited_at,"
                        f" reaction, reaction_by"
                        f" FROM messages WHERE {full_where}"
                        f" ORDER BY timestamp DESC LIMIT {ph} OFFSET {ph}",
                        count_params + (limit, offset),
                    )
                except Exception:
                    c.execute(
                        f"SELECT id, sender, receiver, message, image_path, video_path,"
                        f" audio_path, audio_duration_seconds, timestamp"
                        f" FROM messages WHERE {full_where}"
                        f" ORDER BY timestamp DESC LIMIT {ph} OFFSET {ph}",
                        count_params + (limit, offset),
                    )

            messages: list[dict] = []
            for row in c.fetchall():
                _g = (lambda k: row.get(k) if hasattr(row, "get") else None)

                raw_time = _g("timestamp") or (row[8] if not hasattr(row, "keys") else None)
                if raw_time and isinstance(raw_time, str) and not raw_time.endswith("Z") and "+" not in raw_time[-6:]:
                    utc_time = raw_time.replace(" ", "T")
                    if not utc_time.endswith("Z"):
                        utc_time += "Z"
                else:
                    utc_time = str(raw_time) if raw_time else None

                mp_raw = _g("media_paths") if has_media_paths else None
                media_paths_val = None
                if mp_raw:
                    try:
                        media_paths_val = json.loads(mp_raw) if isinstance(mp_raw, str) else mp_raw
                    except (json.JSONDecodeError, TypeError):
                        pass

                messages.append({
                    "id": _g("id") or row[0],
                    "text": _g("message") or row[3],
                    "image_path": _g("image_path") or (row[4] if not hasattr(row, "keys") else None),
                    "video_path": _g("video_path") or (row[5] if not hasattr(row, "keys") else None),
                    "audio_path": _g("audio_path") or (row[6] if not hasattr(row, "keys") else None),
                    "audio_duration_seconds": _g("audio_duration_seconds") or (row[7] if not hasattr(row, "keys") else None),
                    "sent": (_g("sender") or row[1]) == viewer,
                    "time": utc_time,
                    "edited_at": _g("edited_at"),
                    "reaction": _g("reaction"),
                    "reaction_by": _g("reaction_by"),
                    "media_paths": media_paths_val,
                    "file_path": _g("file_path") if has_file_cols else None,
                    "file_name": _g("file_name") if has_file_cols else None,
                })

            return total, messages, len(messages) == limit
    except Exception:
        logger.exception("search_dm_thread failed for %s <-> %s", viewer, other_username)
        return 0, [], False


# ---------------------------------------------------------------------------
# Group thread search
# ---------------------------------------------------------------------------

def search_group_thread(
    viewer: str,
    group_id: int,
    query: str,
    limit: int = 20,
    offset: int = 0,
) -> tuple[int, list[dict], bool]:
    """Return ``(total_count, messages, has_more)`` for a keyword search in a group chat."""
    try:
        ph = get_sql_placeholder()

        with get_db_connection() as conn:
            c = conn.cursor()

            # Membership check
            c.execute(
                f"SELECT 1 FROM group_chat_members WHERE group_id = {ph} AND username = {ph}",
                (group_id, viewer),
            )
            if not c.fetchone():
                return 0, [], False

            # cleared_before filter
            cleared_before: int = 0
            try:
                c.execute(
                    f"SELECT cleared_before_message_id FROM group_chat_read_receipts"
                    f" WHERE group_id = {ph} AND username = {ph}",
                    (group_id, viewer),
                )
                rr = c.fetchone()
                if rr:
                    cleared_before = int(
                        rr["cleared_before_message_id"] if hasattr(rr, "keys") else rr[0]
                    ) or 0
            except Exception:
                pass

            where = f"m.group_id = {ph} AND m.is_deleted = 0"
            params: list = [group_id]

            if cleared_before > 0:
                where += f" AND m.id > {ph}"
                params.append(cleared_before)

            where += f" AND m.message_text LIKE {ph}"
            params.append(f"%{query}%")

            c.execute(
                f"SELECT COUNT(*) FROM group_chat_messages m WHERE {where}",
                tuple(params),
            )
            total = (c.fetchone() or (0,))[0]

            has_file_cols = True
            try:
                c.execute(
                    f"SELECT m.id, m.sender_username, m.message_text, m.image_path,"
                    f" m.voice_path, m.video_path, m.media_paths, m.client_key,"
                    f" m.created_at, up.profile_picture, m.is_edited, m.audio_summary,"
                    f" m.file_path, m.file_name"
                    f" FROM group_chat_messages m"
                    f" LEFT JOIN user_profiles up ON m.sender_username = up.username"
                    f" WHERE {where}"
                    f" ORDER BY m.created_at DESC LIMIT {ph} OFFSET {ph}",
                    tuple(params + [limit, offset]),
                )
            except Exception:
                has_file_cols = False
                c.execute(
                    f"SELECT m.id, m.sender_username, m.message_text, m.image_path,"
                    f" m.voice_path, m.video_path, m.media_paths, m.client_key,"
                    f" m.created_at, up.profile_picture, m.is_edited, m.audio_summary"
                    f" FROM group_chat_messages m"
                    f" LEFT JOIN user_profiles up ON m.sender_username = up.username"
                    f" WHERE {where}"
                    f" ORDER BY m.created_at DESC LIMIT {ph} OFFSET {ph}",
                    tuple(params + [limit, offset]),
                )

            from backend.blueprints.group_chat import _public_profile_picture_url

            messages: list[dict] = []
            for row in c.fetchall():
                _g = (lambda k: row.get(k) if hasattr(row, "get") else None)

                mp_raw = _g("media_paths")
                media_paths_val = None
                if mp_raw:
                    try:
                        media_paths_val = json.loads(mp_raw) if isinstance(mp_raw, str) else mp_raw
                    except (json.JSONDecodeError, TypeError):
                        pass

                fp = _g("file_path") if has_file_cols else None

                messages.append({
                    "id": _g("id") or row[0],
                    "sender": _g("sender_username") or row[1],
                    "text": _g("message_text") or row[2],
                    "image": _g("image_path") or row[3],
                    "voice": _g("voice_path") or (row[4] if not hasattr(row, "keys") else None),
                    "video": _g("video_path") or (row[5] if not hasattr(row, "keys") else None),
                    "media_paths": media_paths_val,
                    "file_path": fp,
                    "file_name": _g("file_name") if has_file_cols else None,
                    "document": fp,
                    "client_key": _g("client_key") or (row[7] if not hasattr(row, "keys") else None),
                    "created_at": str(_g("created_at") or row[8]) if (_g("created_at") or (not hasattr(row, "keys") and len(row) > 8)) else None,
                    "profile_picture": _public_profile_picture_url(
                        _g("profile_picture") or (row[9] if not hasattr(row, "keys") and len(row) > 9 else None)
                    ),
                    "is_edited": bool(_g("is_edited") or (row[10] if not hasattr(row, "keys") and len(row) > 10 else 0)),
                    "audio_summary": _g("audio_summary") or (row[11] if not hasattr(row, "keys") and len(row) > 11 else None),
                    "reaction": None,
                })

            return total, messages, len(messages) == limit
    except Exception:
        logger.exception("search_group_thread failed for viewer=%s group=%s", viewer, group_id)
        return 0, [], False
