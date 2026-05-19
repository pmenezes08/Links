"""Structured feedback queue for bugs and product ideas reported to Steve."""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, Iterable, Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

FEEDBACK_TYPES = {"bug", "feature_request", "complaint", "pricing", "other"}
SEVERITIES = {"low", "medium", "high", "critical"}
STATUSES = {"new", "triaged", "planned", "in_progress", "resolved", "closed"}


def _now() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _row_to_dict(row: Any) -> Dict[str, Any]:
    if row is None:
        return {}
    if hasattr(row, "keys"):
        return {key: row[key] for key in row.keys()}
    return dict(row)


def ensure_feedback_tables() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS steve_feedback_items (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL,
                    submitted_by VARCHAR(255) NOT NULL,
                    type VARCHAR(32) NOT NULL DEFAULT 'other',
                    severity VARCHAR(32) NOT NULL DEFAULT 'medium',
                    status VARCHAR(32) NOT NULL DEFAULT 'new',
                    title VARCHAR(255) NOT NULL,
                    summary TEXT,
                    raw_user_message TEXT,
                    steve_summary TEXT,
                    surface VARCHAR(64) NOT NULL DEFAULT 'steve_dm',
                    community_id INT NULL,
                    device_info TEXT,
                    app_version VARCHAR(64),
                    media_url TEXT,
                    duplicate_of INT NULL,
                    admin_notes TEXT,
                    closed_at DATETIME NULL,
                    closed_by VARCHAR(255) NULL,
                    INDEX idx_steve_feedback_status (status),
                    INDEX idx_steve_feedback_type (type),
                    INDEX idx_steve_feedback_created (created_at)
                )
                """
            )
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS steve_feedback_events (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    feedback_id INT NOT NULL,
                    created_at DATETIME NOT NULL,
                    actor_username VARCHAR(255) NOT NULL,
                    event_type VARCHAR(64) NOT NULL,
                    note TEXT,
                    old_value TEXT,
                    new_value TEXT,
                    INDEX idx_feedback_events_feedback (feedback_id)
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS steve_feedback_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    submitted_by TEXT NOT NULL,
                    type TEXT NOT NULL DEFAULT 'other',
                    severity TEXT NOT NULL DEFAULT 'medium',
                    status TEXT NOT NULL DEFAULT 'new',
                    title TEXT NOT NULL,
                    summary TEXT,
                    raw_user_message TEXT,
                    steve_summary TEXT,
                    surface TEXT NOT NULL DEFAULT 'steve_dm',
                    community_id INTEGER,
                    device_info TEXT,
                    app_version TEXT,
                    media_url TEXT,
                    duplicate_of INTEGER,
                    admin_notes TEXT,
                    closed_at TEXT,
                    closed_by TEXT
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_steve_feedback_status ON steve_feedback_items(status)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_steve_feedback_type ON steve_feedback_items(type)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_steve_feedback_created ON steve_feedback_items(created_at)")
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS steve_feedback_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    feedback_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    actor_username TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    note TEXT,
                    old_value TEXT,
                    new_value TEXT
                )
                """
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_feedback_events_feedback ON steve_feedback_events(feedback_id)")
        try:
            conn.commit()
        except Exception:
            pass


def classify_feedback(text: str | None) -> tuple[str, str, str]:
    raw = (text or "").strip()
    msg = raw.lower()
    feedback_type = "other"
    if any(term in msg for term in ("bug", "broken", "not working", "doesn't work", "does not work", "error", "crash", "stuck")):
        feedback_type = "bug"
    elif any(term in msg for term in ("feature", "i wish", "should add", "can you add", "improvement", "suggestion")):
        feedback_type = "feature_request"
    elif any(term in msg for term in ("complaint", "annoying", "frustrating", "hate", "bad experience")):
        feedback_type = "complaint"
    elif any(term in msg for term in ("price", "pricing", "billing", "subscription", "membership", "payment")):
        feedback_type = "pricing"

    severity = "medium" if feedback_type == "bug" else "low"
    if any(term in msg for term in ("can't login", "cannot login", "payment", "checkout", "crash", "blocked", "can't post", "can't message")):
        severity = "high"
    if any(term in msg for term in ("data loss", "security", "privacy leak", "charged twice", "critical")):
        severity = "critical"

    title = raw.splitlines()[0][:120].strip() if raw else "Steve feedback"
    title = re.sub(r"\s+", " ", title) or "Steve feedback"
    return feedback_type, severity, title


def _insert_event(
    cursor,
    *,
    feedback_id: int,
    actor_username: str,
    event_type: str,
    note: str = "",
    old_value: str = "",
    new_value: str = "",
) -> None:
    ph = get_sql_placeholder()
    cursor.execute(
        f"""
        INSERT INTO steve_feedback_events
            (feedback_id, created_at, actor_username, event_type, note, old_value, new_value)
        VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
        """,
        (feedback_id, _now(), actor_username, event_type, note, old_value, new_value),
    )


def create_feedback_item(
    *,
    submitted_by: str,
    raw_user_message: str,
    steve_summary: str | None = None,
    feedback_type: str | None = None,
    severity: str | None = None,
    surface: str = "steve_dm",
    community_id: int | None = None,
    device_info: str | None = None,
    app_version: str | None = None,
    media_url: str | None = None,
    duplicate_of: int | None = None,
) -> Dict[str, Any]:
    ensure_feedback_tables()
    inferred_type, inferred_severity, title = classify_feedback(raw_user_message)
    item_type = feedback_type if feedback_type in FEEDBACK_TYPES else inferred_type
    item_severity = severity if severity in SEVERITIES else inferred_severity
    summary = (steve_summary or raw_user_message or "").strip()
    now = _now()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"""
            INSERT INTO steve_feedback_items
                (created_at, updated_at, submitted_by, type, severity, status, title,
                 summary, raw_user_message, steve_summary, surface, community_id,
                 device_info, app_version, media_url, duplicate_of)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (
                now, now, submitted_by, item_type, item_severity, "new", title,
                summary, raw_user_message, steve_summary or summary, surface, community_id,
                device_info, app_version, media_url, duplicate_of,
            ),
        )
        feedback_id = int(c.lastrowid)
        _insert_event(
            c,
            feedback_id=feedback_id,
            actor_username=submitted_by,
            event_type="created",
            note=summary,
            new_value="new",
        )
        try:
            conn.commit()
        except Exception:
            pass
    return get_feedback_item(feedback_id)


def get_feedback_item(feedback_id: int) -> Dict[str, Any]:
    ensure_feedback_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(f"SELECT * FROM steve_feedback_items WHERE id = {ph}", (feedback_id,))
        return _row_to_dict(c.fetchone())


def list_feedback_items(filters: Optional[Dict[str, Any]] = None, limit: int = 100) -> list[Dict[str, Any]]:
    ensure_feedback_tables()
    filters = filters or {}
    ph = get_sql_placeholder()
    where = []
    params: list[Any] = []
    for key in ("status", "type", "severity", "submitted_by"):
        value = str(filters.get(key) or "").strip()
        if value:
            where.append(f"{key} = {ph}")
            params.append(value)
    query = "SELECT * FROM steve_feedback_items"
    if where:
        query += " WHERE " + " AND ".join(where)
    query += f" ORDER BY created_at DESC LIMIT {ph}"
    params.append(max(1, min(int(limit or 100), 500)))
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(query, tuple(params))
        return [_row_to_dict(row) for row in c.fetchall()]


def update_feedback_item_status(
    *,
    feedback_id: int,
    status: str,
    actor_username: str,
    note: str = "",
    severity: str | None = None,
    duplicate_of: int | None = None,
) -> Dict[str, Any]:
    if status not in STATUSES:
        raise ValueError("Invalid feedback status")
    if severity is not None and severity not in SEVERITIES:
        raise ValueError("Invalid feedback severity")
    ensure_feedback_tables()
    current = get_feedback_item(feedback_id)
    if not current:
        raise KeyError("Feedback item not found")

    now = _now()
    assignments = ["status = ?", "updated_at = ?"]
    params: list[Any] = [status, now]
    if severity is not None:
        assignments.append("severity = ?")
        params.append(severity)
    if duplicate_of is not None:
        assignments.append("duplicate_of = ?")
        params.append(duplicate_of)
    if status in {"resolved", "closed"}:
        assignments.extend(["closed_at = ?", "closed_by = ?"])
        params.extend([now, actor_username])
    params.append(feedback_id)

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        sql_assignments = ", ".join(assignments).replace("?", ph)
        c.execute(f"UPDATE steve_feedback_items SET {sql_assignments} WHERE id = {ph}", tuple(params))
        _insert_event(
            c,
            feedback_id=feedback_id,
            actor_username=actor_username,
            event_type="status_changed",
            note=note,
            old_value=str(current.get("status") or ""),
            new_value=status,
        )
        try:
            conn.commit()
        except Exception:
            pass
    return get_feedback_item(feedback_id)


def add_admin_note(*, feedback_id: int, actor_username: str, note: str) -> Dict[str, Any]:
    note = (note or "").strip()
    if not note:
        raise ValueError("Note is required")
    ensure_feedback_tables()
    current = get_feedback_item(feedback_id)
    if not current:
        raise KeyError("Feedback item not found")
    existing = (current.get("admin_notes") or "").strip()
    stamped = f"[{_now()}] {actor_username}: {note}"
    combined = f"{existing}\n{stamped}".strip() if existing else stamped
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"UPDATE steve_feedback_items SET admin_notes = {ph}, updated_at = {ph} WHERE id = {ph}",
            (combined, _now(), feedback_id),
        )
        _insert_event(c, feedback_id=feedback_id, actor_username=actor_username, event_type="admin_note", note=note)
        try:
            conn.commit()
        except Exception:
            pass
    return get_feedback_item(feedback_id)


def list_feedback_events(feedback_id: int) -> list[Dict[str, Any]]:
    ensure_feedback_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"SELECT * FROM steve_feedback_events WHERE feedback_id = {ph} ORDER BY created_at ASC",
            (feedback_id,),
        )
        return [_row_to_dict(row) for row in c.fetchall()]


def send_closure_receipt(*, feedback_id: int, actor_username: str, message: str | None = None) -> Dict[str, Any]:
    item = get_feedback_item(feedback_id)
    if not item:
        raise KeyError("Feedback item not found")
    receiver = str(item.get("submitted_by") or "").strip()
    if not receiver:
        raise ValueError("Feedback item has no submitted_by user")
    receipt = (message or "").strip() or (
        f"Quick update: the feedback you sent about \"{item.get('title') or 'that issue'}\" "
        "has been marked resolved. Thanks for flagging it."
    )
    from backend.services.content_generation.delivery import send_steve_dm

    message_id = send_steve_dm(receiver_username=receiver, content=receipt)
    with get_db_connection() as conn:
        c = conn.cursor()
        _insert_event(
            c,
            feedback_id=feedback_id,
            actor_username=actor_username,
            event_type="closure_receipt_sent",
            note=receipt,
            new_value=str(message_id),
        )
        try:
            conn.commit()
        except Exception:
            pass
    return {"message_id": message_id, "receipt": receipt}
