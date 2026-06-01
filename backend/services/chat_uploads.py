"""Resumable chat media upload sessions (multipart R2)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.entitlements import resolve_entitlements
from backend.services.r2_storage import (
    MULTIPART_PART_SIZE,
    R2_ENABLED,
    R2_PUBLIC_URL,
    abort_multipart_upload,
    complete_multipart_upload,
    create_multipart_upload,
    get_content_type,
    get_r2_public_url,
    list_multipart_upload_parts,
    presign_upload_part,
)

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 3600
PART_URL_TTL_SECONDS = 900
DEFAULT_MAX_BYTES = 500 * 1024 * 1024  # 500 MB fallback
DEFAULT_MAX_DAILY = 50

# R2/S3 multipart UploadId can exceed 256 chars (observed ~300+ on Cloudflare R2).
UPLOAD_ID_MAX_LEN = 512


def _widen_upload_id_column(cursor: Any) -> None:
    """Migrate upload_id column if an older schema used VARCHAR(256)."""
    if not USE_MYSQL:
        return
    try:
        cursor.execute(
            f"ALTER TABLE chat_upload_sessions MODIFY COLUMN upload_id VARCHAR({UPLOAD_ID_MAX_LEN}) NOT NULL"
        )
    except Exception as exc:
        # Table may not exist yet, or column already wide enough — ignore benign errors.
        logger.debug("upload_id column widen skipped: %s", exc)


def ensure_tables(cursor: Optional[Any] = None) -> None:
    """Ensure chat_upload_sessions table exists."""
    owns_connection = cursor is None
    conn = None
    if cursor is None:
        conn = get_db_connection()
        cursor = conn.cursor()
    try:
        if USE_MYSQL:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_upload_sessions (
                    session_id VARCHAR(64) PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    context_type ENUM('dm', 'group') NOT NULL,
                    context_id VARCHAR(64) NOT NULL,
                    object_key VARCHAR(512) NOT NULL,
                    upload_id VARCHAR(512) NOT NULL,
                    expected_bytes BIGINT UNSIGNED DEFAULT 0,
                    content_type VARCHAR(128) NOT NULL,
                    media_kind ENUM('image', 'video') NOT NULL,
                    status ENUM('initiated', 'completed', 'aborted', 'expired') NOT NULL DEFAULT 'initiated',
                    created_at DATETIME NOT NULL,
                    expires_at DATETIME NOT NULL,
                    INDEX idx_chat_upload_user (username),
                    INDEX idx_chat_upload_status_expires (status, expires_at)
                )
                """
            )
            _widen_upload_id_column(cursor)
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_upload_sessions (
                    session_id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    context_type TEXT NOT NULL,
                    context_id TEXT NOT NULL,
                    object_key TEXT NOT NULL,
                    upload_id TEXT NOT NULL,
                    expected_bytes INTEGER DEFAULT 0,
                    content_type TEXT NOT NULL,
                    media_kind TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'initiated',
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                )
                """
            )
        if owns_connection and conn is not None:
            conn.commit()
    finally:
        if owns_connection and conn is not None:
            conn.close()


def _row_val(row: Any, key: str, idx: int, default: Any = None) -> Any:
    if row is None:
        return default
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key, default)
    if isinstance(row, (list, tuple)) and len(row) > idx:
        return row[idx]
    return default


def _upload_caps(username: str) -> Tuple[int, int]:
    """Return (max_bytes_per_file, max_daily_uploads) from entitlements/KB."""
    try:
        ent = resolve_entitlements(username) or {}
        max_bytes = int(ent.get("chat_media_max_bytes") or DEFAULT_MAX_BYTES)
        max_daily = int(ent.get("chat_media_max_daily") or DEFAULT_MAX_DAILY)
        return max(max_bytes, 1024 * 1024), max(max_daily, 1)
    except Exception:
        return DEFAULT_MAX_BYTES, DEFAULT_MAX_DAILY


def _daily_upload_count(cursor: Any, username: str) -> int:
    ph = get_sql_placeholder()
    since = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        f"""
        SELECT COUNT(*) AS cnt FROM chat_upload_sessions
        WHERE username = {ph} AND created_at >= {ph}
        AND status IN ('initiated', 'completed')
        """,
        (username, since),
    )
    row = cursor.fetchone()
    return int(_row_val(row, "cnt", 0, 0) or 0)


def _blocked_pair(cursor: Any, username: str, recipient_username: str) -> bool:
    try:
        ph = get_sql_placeholder()
        cursor.execute(
            f"""
            SELECT 1 FROM blocked_users
            WHERE (blocker_username = {ph} AND blocked_username = {ph})
            OR (blocker_username = {ph} AND blocked_username = {ph})
            """,
            (username, recipient_username, recipient_username, username),
        )
        return cursor.fetchone() is not None
    except Exception as exc:
        logger.warning("blocked check failed: %s", exc)
        return False


def _verify_dm_context(cursor: Any, username: str, recipient_id: str) -> Optional[str]:
    ph = get_sql_placeholder()
    cursor.execute(f"SELECT username FROM users WHERE id = {ph}", (recipient_id,))
    row = cursor.fetchone()
    recipient_username = _row_val(row, "username", 0)
    if not recipient_username:
        return None
    if _blocked_pair(cursor, username, str(recipient_username)):
        return "__blocked__"
    return str(recipient_username)


def _verify_group_context(cursor: Any, username: str, group_id: int) -> bool:
    ph = get_sql_placeholder()
    cursor.execute(
        f"SELECT 1 FROM group_chat_members WHERE group_id = {ph} AND username = {ph}",
        (group_id, username),
    )
    return cursor.fetchone() is not None


def _object_key(prefix: str, filename: str, ext: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    name = (filename.rsplit(".", 1)[0] if "." in filename else prefix)[:50]
    safe_ext = ext if ext in ("mp4", "webm", "mov", "m4v", "avi", "png", "jpg", "jpeg", "webp", "gif") else "mp4"
    return f"{prefix}/{name}_{ts}.{safe_ext}"


def _log_metric(event: str, **fields: Any) -> None:
    logger.info("chat_upload_metric event=%s %s", event, " ".join(f"{k}={v}" for k, v in fields.items()))


def init_upload_session(
    username: str,
    *,
    context: Dict[str, Any],
    filename: str,
    content_type: str,
    expected_bytes: int,
    media_kind: str,
) -> Tuple[dict, int]:
    """Create multipart upload session. Returns (payload, http_status)."""
    if not R2_ENABLED or not R2_PUBLIC_URL:
        return {"success": False, "error": "Direct upload not available"}, 503

    media_kind = (media_kind or "video").strip().lower()
    if media_kind not in ("image", "video"):
        return {"success": False, "error": "Invalid media_kind"}, 400

    content_type = (content_type or get_content_type(filename)).strip()
    if media_kind == "video" and not content_type.startswith("video/"):
        return {"success": False, "error": "Invalid video type"}, 400
    if media_kind == "image" and not content_type.startswith("image/"):
        return {"success": False, "error": "Invalid image type"}, 400

    expected_bytes = max(0, int(expected_bytes or 0))
    max_bytes, max_daily = _upload_caps(username)
    if expected_bytes > max_bytes:
        return {"success": False, "error": "File exceeds upload size limit", "code": "upload_size_limit"}, 413

    ctx_type = (context.get("type") or "").strip().lower()
    if ctx_type not in ("dm", "group"):
        return {"success": False, "error": "Invalid context type"}, 400

    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ensure_tables(cursor)

            if _daily_upload_count(cursor, username) >= max_daily:
                return {
                    "success": False,
                    "error": "Daily upload limit reached",
                    "code": "upload_daily_limit",
                }, 429

            context_id = ""
            if ctx_type == "dm":
                recipient_id = str(context.get("recipient_id") or "").strip()
                if not recipient_id:
                    return {"success": False, "error": "recipient_id required"}, 400
                recipient = _verify_dm_context(cursor, username, recipient_id)
                if recipient == "__blocked__":
                    return {"success": False, "error": "Unable to send message to this user"}, 403
                if not recipient:
                    return {"success": False, "error": "Recipient not found"}, 404
                context_id = recipient_id
            else:
                try:
                    group_id = int(context.get("group_id"))
                except (TypeError, ValueError):
                    return {"success": False, "error": "group_id required"}, 400
                if not _verify_group_context(cursor, username, group_id):
                    return {"success": False, "error": "Access denied"}, 403
                context_id = str(group_id)

            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ("mp4" if media_kind == "video" else "jpg")
            prefix = "message_videos" if media_kind == "video" else "message_photos"
            key = _object_key(prefix, filename, ext)

            upload_id = create_multipart_upload(key, content_type)
            if not upload_id:
                return {"success": False, "error": "Failed to start upload"}, 500

            session_id = uuid.uuid4().hex
            now = datetime.now(timezone.utc)
            expires = now + timedelta(seconds=SESSION_TTL_SECONDS)
            ph = get_sql_placeholder()
            cursor.execute(
                f"""
                INSERT INTO chat_upload_sessions
                (session_id, username, context_type, context_id, object_key, upload_id,
                 expected_bytes, content_type, media_kind, status, created_at, expires_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, 'initiated', {ph}, {ph})
                """,
                (
                    session_id,
                    username,
                    ctx_type,
                    context_id,
                    key,
                    upload_id,
                    expected_bytes,
                    content_type,
                    media_kind,
                    now.strftime("%Y-%m-%d %H:%M:%S"),
                    expires.strftime("%Y-%m-%d %H:%M:%S"),
                ),
            )
            conn.commit()

            public_url = get_r2_public_url(key)
            _log_metric(
                "init",
                username=username,
                session_id=session_id,
                context_type=ctx_type,
                expected_bytes=expected_bytes,
                media_kind=media_kind,
            )
            return {
                "success": True,
                "session_id": session_id,
                "upload_id": upload_id,
                "part_size": MULTIPART_PART_SIZE,
                "key": key,
                "public_url": public_url,
            }, 200
    except Exception as exc:
        logger.exception("init_upload_session failed: %s", exc)
        return {"success": False, "error": "Server error"}, 500


def _load_session(cursor: Any, session_id: str, username: str) -> Optional[dict]:
    ph = get_sql_placeholder()
    cursor.execute(
        f"""
        SELECT session_id, username, context_type, context_id, object_key, upload_id,
               expected_bytes, content_type, media_kind, status, expires_at
        FROM chat_upload_sessions WHERE session_id = {ph}
        """,
        (session_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    session = {
        "session_id": _row_val(row, "session_id", 0),
        "username": _row_val(row, "username", 1),
        "context_type": _row_val(row, "context_type", 2),
        "context_id": _row_val(row, "context_id", 3),
        "object_key": _row_val(row, "object_key", 4),
        "upload_id": _row_val(row, "upload_id", 5),
        "expected_bytes": _row_val(row, "expected_bytes", 6, 0),
        "content_type": _row_val(row, "content_type", 7),
        "media_kind": _row_val(row, "media_kind", 8),
        "status": _row_val(row, "status", 9),
        "expires_at": _row_val(row, "expires_at", 10),
    }
    if session["username"] != username:
        return None
    return session


def _session_still_valid(cursor: Any, session: dict) -> bool:
    if session.get("status") != "initiated":
        return False
    expires = session.get("expires_at")
    if not expires:
        return True
    try:
        if isinstance(expires, str):
            exp_dt = datetime.strptime(expires[:19], "%Y-%m-%d %H:%M:%S")
        else:
            exp_dt = expires
        if exp_dt < datetime.now(timezone.utc):
            return False
    except Exception:
        pass
    ctx_type = session.get("context_type")
    username = session.get("username")
    context_id = session.get("context_id")
    if ctx_type == "dm":
        recipient = _verify_dm_context(cursor, username, str(context_id))
        return bool(recipient and recipient != "__blocked__")
    if ctx_type == "group":
        try:
            return _verify_group_context(cursor, username, int(context_id))
        except (TypeError, ValueError):
            return False
    return False


def presign_part_url(username: str, session_id: str, part_number: int) -> Tuple[dict, int]:
    if part_number < 1:
        return {"success": False, "error": "Invalid part_number"}, 400
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ensure_tables(cursor)
            session = _load_session(cursor, session_id, username)
            if not session:
                return {"success": False, "error": "Session not found"}, 404
            if not _session_still_valid(cursor, session):
                return {"success": False, "error": "Session expired or invalid"}, 410
            url = presign_upload_part(
                session["object_key"],
                session["upload_id"],
                part_number,
                expires_in=PART_URL_TTL_SECONDS,
            )
            if not url:
                return {"success": False, "error": "Failed to generate part URL"}, 500
            return {"success": True, "upload_url": url, "part_number": part_number}, 200
    except Exception as exc:
        logger.exception("presign_part_url failed: %s", exc)
        return {"success": False, "error": "Server error"}, 500


def _normalize_client_parts(parts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for p in parts:
        pn = int(p.get("part_number") or p.get("PartNumber") or 0)
        etag = str(p.get("etag") or p.get("ETag") or "").strip().strip('"')
        if pn >= 1 and etag:
            normalized.append({"PartNumber": pn, "ETag": etag})
    return normalized


def _resolve_multipart_parts(
    key: str,
    upload_id: str,
    client_parts: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    normalized = _normalize_client_parts(client_parts)
    if normalized:
        return normalized
    # Browser PUT to presigned R2 URLs often cannot read ETag (CORS expose-headers).
    return list_multipart_upload_parts(key, upload_id)


def complete_upload_session(
    username: str,
    session_id: str,
    parts: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[dict, int]:
    client_parts = parts or []
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ensure_tables(cursor)
            session = _load_session(cursor, session_id, username)
            if not session:
                return {"success": False, "error": "Session not found"}, 404
            if session.get("status") != "initiated":
                return {"success": False, "error": "Session not active"}, 409
            if not _session_still_valid(cursor, session):
                return {"success": False, "error": "Session expired or invalid"}, 410

            key = session["object_key"]
            upload_id = session["upload_id"]
            normalized = _resolve_multipart_parts(key, upload_id, client_parts)
            if not normalized:
                return {"success": False, "error": "No uploaded parts found"}, 400

            ok = complete_multipart_upload(key, upload_id, normalized)
            if not ok:
                return {"success": False, "error": "Failed to complete upload"}, 500

            ph = get_sql_placeholder()
            cursor.execute(
                f"UPDATE chat_upload_sessions SET status = 'completed' WHERE session_id = {ph}",
                (session_id,),
            )
            conn.commit()

            public_url = get_r2_public_url(key)
            _log_metric(
                "complete",
                username=username,
                session_id=session_id,
                parts=len(normalized),
                key=key,
            )

            # Async HEVC/MOV fallback transcode hook (best-effort, non-blocking)
            if session.get("media_kind") == "video" and key.lower().endswith((".mov", ".m4v")):
                try:
                    from backend.services.chat_upload_transcode import schedule_chat_video_transcode

                    schedule_chat_video_transcode(key, public_url)
                except Exception as transcode_err:
                    logger.debug("transcode schedule skipped: %s", transcode_err)

            return {"success": True, "public_url": public_url, "key": key}, 200
    except Exception as exc:
        logger.exception("complete_upload_session failed: %s", exc)
        return {"success": False, "error": "Server error"}, 500


def abort_upload_session(username: str, session_id: str) -> Tuple[dict, int]:
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ensure_tables(cursor)
            session = _load_session(cursor, session_id, username)
            if not session:
                return {"success": False, "error": "Session not found"}, 404
            if session.get("status") == "completed":
                return {"success": False, "error": "Already completed"}, 409

            abort_multipart_upload(session["object_key"], session["upload_id"])
            ph = get_sql_placeholder()
            cursor.execute(
                f"UPDATE chat_upload_sessions SET status = 'aborted' WHERE session_id = {ph}",
                (session_id,),
            )
            conn.commit()
            _log_metric("abort", username=username, session_id=session_id)
            return {"success": True}, 200
    except Exception as exc:
        logger.exception("abort_upload_session failed: %s", exc)
        return {"success": False, "error": "Server error"}, 500


def janitor_expired_sessions(limit: int = 200, dry_run: bool = False) -> dict:
    """Abort expired initiated sessions."""
    ensure_tables()
    cleaned = 0
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ph = get_sql_placeholder()
            now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute(
                f"""
                SELECT session_id, object_key, upload_id FROM chat_upload_sessions
                WHERE status = 'initiated' AND expires_at < {ph}
                LIMIT {int(limit)}
                """,
                (now,),
            )
            rows = cursor.fetchall() or []
            for row in rows:
                sid = _row_val(row, "session_id", 0)
                key = _row_val(row, "object_key", 1)
                upload_id = _row_val(row, "upload_id", 2)
                if not dry_run:
                    abort_multipart_upload(key, upload_id)
                    cursor.execute(
                        f"UPDATE chat_upload_sessions SET status = 'expired' WHERE session_id = {ph}",
                        (sid,),
                    )
                cleaned += 1
            if not dry_run:
                conn.commit()
        _log_metric("janitor", cleaned=cleaned, dry_run=dry_run)
        return {"cleaned": cleaned, "dry_run": dry_run}
    except Exception as exc:
        logger.exception("janitor failed: %s", exc)
        return {"cleaned": cleaned, "error": str(exc)}
