"""Per-thread keyword search for DM and group chat messages (MySQL LIKE)."""

from __future__ import annotations

import json
import logging
from typing import Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


def _safe_int(val, default: int = 0) -> int:
    """Convert *val* to int, returning *default* on None / TypeError."""
    if val is None:
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _parse_time(raw_time) -> Optional[str]:
    """Normalise a raw timestamp value into an ISO-ish UTC string."""
    if not raw_time:
        return None
    s = str(raw_time)
    if not s.endswith("Z") and "+" not in s[-6:]:
        s = s.replace(" ", "T")
        if not s.endswith("Z"):
            s += "Z"
    return s


def _parse_media_paths(raw):
    """Parse a media_paths JSON string, returning None on failure."""
    if not raw:
        return None
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return None


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
            ensure_human_dm_thread_column,
            human_pair_thread_key,
            is_private_steve_dm_peer,
        )

        ph = get_sql_placeholder()
        thr_key = human_pair_thread_key(viewer, other_username)

        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_human_dm_thread_column(c)

            if is_private_steve_dm_peer(other_username):
                where = (
                    f"((LOWER(sender) = LOWER({ph}) AND LOWER(receiver) = LOWER({ph}))"
                    f" OR (LOWER(sender) = LOWER({ph}) AND LOWER(receiver) = LOWER({ph})"
                    f" AND (human_dm_thread IS NULL OR human_dm_thread = '')))"
                )
                base_params = (viewer, other_username, other_username, viewer)
            else:
                where = (
                    f"(((LOWER(sender) = LOWER({ph}) AND LOWER(receiver) = LOWER({ph}))"
                    f" OR (LOWER(sender) = LOWER({ph}) AND LOWER(receiver) = LOWER({ph})))"
                    f" OR (sender = 'steve' AND human_dm_thread = {ph}))"
                )
                base_params = (viewer, other_username, other_username, viewer, thr_key)

            deleted_clause = ""
            deleted_params: tuple = ()
            try:
                c.execute(
                    f"SELECT deleted_at FROM deleted_chat_threads WHERE username = {ph} AND other_username = {ph}",
                    (viewer, other_username),
                )
                del_row = c.fetchone()
                if del_row:
                    da = del_row.get("deleted_at") if hasattr(del_row, "get") else del_row[0]
                    if da:
                        deleted_clause = f" AND timestamp > {ph}"
                        deleted_params = (str(da),)
            except Exception:
                pass

            search_clause = f" AND message LIKE {ph}"
            search_params = (f"%{query}%",)

            full_where = f"{where}{deleted_clause}{search_clause}"
            count_params = base_params + deleted_params + search_params

            c.execute(
                f"SELECT COUNT(*) AS cnt FROM messages WHERE {full_where}",
                count_params,
            )
            row = c.fetchone()
            total = row["cnt"] if (row and hasattr(row, "get")) else (row[0] if row else 0)

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
                g = row.get if hasattr(row, "get") else (lambda k: None)
                sender_raw = g("sender")
                messages.append({
                    "id": g("id"),
                    "sender": sender_raw,
                    "text": g("message"),
                    "image_path": g("image_path"),
                    "video_path": g("video_path"),
                    "audio_path": g("audio_path"),
                    "audio_duration_seconds": g("audio_duration_seconds"),
                    "sent": sender_raw is not None and sender_raw.lower() == viewer.lower(),
                    "time": _parse_time(g("timestamp")),
                    "edited_at": g("edited_at"),
                    "reaction": g("reaction"),
                    "reaction_by": g("reaction_by"),
                    "media_paths": _parse_media_paths(g("media_paths")) if has_media_paths else None,
                    "file_path": g("file_path") if has_file_cols else None,
                    "file_name": g("file_name") if has_file_cols else None,
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

            c.execute(
                f"SELECT 1 FROM group_chat_members WHERE group_id = {ph} AND LOWER(username) = LOWER({ph})",
                (group_id, viewer),
            )
            if not c.fetchone():
                return 0, [], False

            cleared_before: int = 0
            try:
                c.execute(
                    f"SELECT cleared_before_message_id FROM group_chat_read_receipts"
                    f" WHERE group_id = {ph} AND LOWER(username) = LOWER({ph})",
                    (group_id, viewer),
                )
                rr = c.fetchone()
                if rr:
                    raw_val = rr.get("cleared_before_message_id") if hasattr(rr, "get") else rr[0]
                    cleared_before = _safe_int(raw_val)
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
                f"SELECT COUNT(*) AS cnt FROM group_chat_messages m WHERE {where}",
                tuple(params),
            )
            cnt_row = c.fetchone()
            total = cnt_row["cnt"] if (cnt_row and hasattr(cnt_row, "get")) else (cnt_row[0] if cnt_row else 0)

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
                g = row.get if hasattr(row, "get") else (lambda k: None)
                sender_raw = g("sender_username")
                fp = g("file_path") if has_file_cols else None
                ts_str = str(g("created_at")) if g("created_at") else None

                messages.append({
                    "id": g("id"),
                    "sender": sender_raw,
                    "sender_username": sender_raw,
                    "text": g("message_text"),
                    "sent": sender_raw is not None and sender_raw.lower() == viewer.lower(),
                    "time": ts_str,
                    "image_path": g("image_path"),
                    "video_path": g("video_path"),
                    "audio_path": g("voice_path"),
                    "voice": g("voice_path"),
                    "media_paths": _parse_media_paths(g("media_paths")),
                    "file_path": fp,
                    "file_name": g("file_name") if has_file_cols else None,
                    "document": fp,
                    "client_key": g("client_key"),
                    "created_at": ts_str,
                    "profile_picture": _public_profile_picture_url(g("profile_picture")),
                    "is_edited": bool(g("is_edited") or 0),
                    "audio_summary": g("audio_summary"),
                    "reaction": None,
                })

            return total, messages, len(messages) == limit
    except Exception:
        logger.exception("search_group_thread failed for viewer=%s group=%s", viewer, group_id)
        return 0, [], False


# ---------------------------------------------------------------------------
# "Around ID" message window helpers (for jump-to-message from search)
# ---------------------------------------------------------------------------

_AROUND_HALF = 25


def fetch_dm_messages_around(
    viewer: str,
    other_username: str,
    around_id: int,
) -> dict:
    """Return a window of DM messages centred on *around_id*.

    Returns ``{"success": True, "messages": [...], "has_more_before": bool,
    "has_more_after": bool, "target_found": bool}``.
    """
    try:
        from backend.services.dm_human_thread import (
            ensure_human_dm_thread_column,
            human_pair_thread_key,
            is_private_steve_dm_peer,
        )

        ph = get_sql_placeholder()
        thr_key = human_pair_thread_key(viewer, other_username)

        with get_db_connection() as conn:
            c = conn.cursor()
            ensure_human_dm_thread_column(c)

            if is_private_steve_dm_peer(other_username):
                where = (
                    f"((LOWER(sender) = LOWER({ph}) AND LOWER(receiver) = LOWER({ph}))"
                    f" OR (LOWER(sender) = LOWER({ph}) AND LOWER(receiver) = LOWER({ph})"
                    f" AND (human_dm_thread IS NULL OR human_dm_thread = '')))"
                )
                base_params: tuple = (viewer, other_username, other_username, viewer)
            else:
                where = (
                    f"(((LOWER(sender) = LOWER({ph}) AND LOWER(receiver) = LOWER({ph}))"
                    f" OR (LOWER(sender) = LOWER({ph}) AND LOWER(receiver) = LOWER({ph})))"
                    f" OR (sender = 'steve' AND human_dm_thread = {ph}))"
                )
                base_params = (viewer, other_username, other_username, viewer, thr_key)

            deleted_clause = ""
            deleted_params: tuple = ()
            try:
                c.execute(
                    f"SELECT deleted_at FROM deleted_chat_threads WHERE username = {ph} AND other_username = {ph}",
                    (viewer, other_username),
                )
                del_row = c.fetchone()
                if del_row:
                    da = del_row.get("deleted_at") if hasattr(del_row, "get") else del_row[0]
                    if da:
                        deleted_clause = f" AND timestamp > {ph}"
                        deleted_params = (str(da),)
            except Exception:
                pass

            full_where = f"{where}{deleted_clause}"
            wp = base_params + deleted_params

            before_sql = (
                f"SELECT id, sender, receiver, message, image_path, video_path,"
                f" audio_path, audio_duration_seconds, timestamp, edited_at,"
                f" reaction, reaction_by, media_paths, file_path, file_name"
                f" FROM messages WHERE {full_where} AND id <= {ph}"
                f" ORDER BY id DESC LIMIT {ph}"
            )
            c.execute(before_sql, wp + (around_id, _AROUND_HALF + 1))
            before_rows = list(c.fetchall())

            after_sql = (
                f"SELECT id, sender, receiver, message, image_path, video_path,"
                f" audio_path, audio_duration_seconds, timestamp, edited_at,"
                f" reaction, reaction_by, media_paths, file_path, file_name"
                f" FROM messages WHERE {full_where} AND id > {ph}"
                f" ORDER BY id ASC LIMIT {ph}"
            )
            c.execute(after_sql, wp + (around_id, _AROUND_HALF))
            after_rows = list(c.fetchall())

            has_more_before = len(before_rows) > _AROUND_HALF
            if has_more_before:
                before_rows = before_rows[:_AROUND_HALF]
            has_more_after = len(after_rows) == _AROUND_HALF

            target_found = any(
                (r.get("id") if hasattr(r, "get") else r[0]) == around_id
                for r in before_rows
            )

            all_rows = list(reversed(before_rows)) + after_rows

            messages: list[dict] = []
            for row in all_rows:
                g = row.get if hasattr(row, "get") else (lambda k: None)
                sender_raw = g("sender")
                messages.append({
                    "id": g("id"),
                    "sender": sender_raw,
                    "text": g("message"),
                    "image_path": g("image_path"),
                    "video_path": g("video_path"),
                    "audio_path": g("audio_path"),
                    "audio_duration_seconds": g("audio_duration_seconds"),
                    "sent": sender_raw is not None and sender_raw.lower() == viewer.lower(),
                    "time": _parse_time(g("timestamp")),
                    "edited_at": g("edited_at"),
                    "reaction": g("reaction"),
                    "reaction_by": g("reaction_by"),
                    "media_paths": _parse_media_paths(g("media_paths")),
                    "file_path": g("file_path"),
                    "file_name": g("file_name"),
                })

            return {
                "success": True,
                "messages": messages,
                "has_more_before": has_more_before,
                "has_more_after": has_more_after,
                "target_found": target_found,
            }
    except Exception:
        logger.exception("fetch_dm_messages_around failed viewer=%s other=%s around=%s", viewer, other_username, around_id)
        return {"success": False, "messages": [], "has_more_before": False, "has_more_after": False, "target_found": False}


def fetch_group_messages_around(
    viewer: str,
    group_id: int,
    around_id: int,
) -> dict:
    """Return a window of group messages centred on *around_id*."""
    try:
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()

            c.execute(
                f"SELECT 1 FROM group_chat_members WHERE group_id = {ph} AND LOWER(username) = LOWER({ph})",
                (group_id, viewer),
            )
            if not c.fetchone():
                return {"success": False, "messages": [], "has_more_before": False, "has_more_after": False, "target_found": False}

            cleared_before: int = 0
            try:
                c.execute(
                    f"SELECT cleared_before_message_id FROM group_chat_read_receipts"
                    f" WHERE group_id = {ph} AND LOWER(username) = LOWER({ph})",
                    (group_id, viewer),
                )
                rr = c.fetchone()
                if rr:
                    raw_val = rr.get("cleared_before_message_id") if hasattr(rr, "get") else rr[0]
                    cleared_before = _safe_int(raw_val)
            except Exception:
                pass

            base_where = f"m.group_id = {ph} AND m.is_deleted = 0"
            base_params_list: list = [group_id]
            if cleared_before > 0:
                base_where += f" AND m.id > {ph}"
                base_params_list.append(cleared_before)

            bp = tuple(base_params_list)

            before_sql = (
                f"SELECT m.id, m.sender_username, m.message_text, m.image_path,"
                f" m.voice_path, m.video_path, m.media_paths, m.client_key,"
                f" m.created_at, up.profile_picture, m.is_edited, m.audio_summary,"
                f" m.file_path, m.file_name"
                f" FROM group_chat_messages m"
                f" LEFT JOIN user_profiles up ON m.sender_username = up.username"
                f" WHERE {base_where} AND m.id <= {ph}"
                f" ORDER BY m.id DESC LIMIT {ph}"
            )
            c.execute(before_sql, bp + (around_id, _AROUND_HALF + 1))
            before_rows = list(c.fetchall())

            after_sql = (
                f"SELECT m.id, m.sender_username, m.message_text, m.image_path,"
                f" m.voice_path, m.video_path, m.media_paths, m.client_key,"
                f" m.created_at, up.profile_picture, m.is_edited, m.audio_summary,"
                f" m.file_path, m.file_name"
                f" FROM group_chat_messages m"
                f" LEFT JOIN user_profiles up ON m.sender_username = up.username"
                f" WHERE {base_where} AND m.id > {ph}"
                f" ORDER BY m.id ASC LIMIT {ph}"
            )
            c.execute(after_sql, bp + (around_id, _AROUND_HALF))
            after_rows = list(c.fetchall())

            has_more_before = len(before_rows) > _AROUND_HALF
            if has_more_before:
                before_rows = before_rows[:_AROUND_HALF]
            has_more_after = len(after_rows) == _AROUND_HALF

            target_found = any(
                (r.get("id") if hasattr(r, "get") else r[0]) == around_id
                for r in before_rows
            )

            from backend.blueprints.group_chat import _public_profile_picture_url

            all_rows = list(reversed(before_rows)) + after_rows
            messages: list[dict] = []
            for row in all_rows:
                g = row.get if hasattr(row, "get") else (lambda k: None)
                sender_raw = g("sender_username")
                fp = g("file_path")
                ts_str = str(g("created_at")) if g("created_at") else None

                messages.append({
                    "id": g("id"),
                    "sender": sender_raw,
                    "sender_username": sender_raw,
                    "text": g("message_text"),
                    "sent": sender_raw is not None and sender_raw.lower() == viewer.lower(),
                    "time": ts_str,
                    "image_path": g("image_path"),
                    "video_path": g("video_path"),
                    "audio_path": g("voice_path"),
                    "voice": g("voice_path"),
                    "media_paths": _parse_media_paths(g("media_paths")),
                    "file_path": fp,
                    "file_name": g("file_name"),
                    "document": fp,
                    "client_key": g("client_key"),
                    "created_at": ts_str,
                    "profile_picture": _public_profile_picture_url(g("profile_picture")),
                    "is_edited": bool(g("is_edited") or 0),
                    "audio_summary": g("audio_summary"),
                    "reaction": None,
                })

            return {
                "success": True,
                "messages": messages,
                "has_more_before": has_more_before,
                "has_more_after": has_more_after,
                "target_found": target_found,
            }
    except Exception:
        logger.exception("fetch_group_messages_around failed viewer=%s group=%s around=%s", viewer, group_id, around_id)
        return {"success": False, "messages": [], "has_more_before": False, "has_more_after": False, "target_found": False}
