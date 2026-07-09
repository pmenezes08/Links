"""Networking attribution events — the instrumentation sink for the concierge funnel.

Every proactive-networking decision downstream (cue links, digests, betas)
depends on knowing where a Networking visit came from and what the member did.
The ``?source=`` params the client already emits were previously decorative —
nothing read them. This service is the sink: one small append-only table,
written via a thin blueprint (`backend/blueprints/networking_events.py`).

This is analytics plumbing, NOT an AI surface: no entitlement gate beyond
login, no ai_usage rows, no paid calls. Event types and sources are
closed sets so the table stays queryable.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

# Closed sets — reject anything else so dashboards never chase free-text drift.
EVENT_TYPES = {"page_view", "message_tap"}
SOURCES = {
    "welcome_cue",      # rolling-welcome feed post suffix
    "steve_match",      # existing pull-flow Message tap
    "feed_entry",       # AskSteveEntry feed affordance
    "digest",           # future: weekly concierge DM tap-through
    "direct",           # page opened with no source param
}

_MAX_USERNAME_LEN = 191


def ensure_events_table() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS networking_events (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(191) NOT NULL,
                    event_type VARCHAR(32) NOT NULL,
                    source VARCHAR(32) NOT NULL,
                    community_id INT NULL,
                    target_username VARCHAR(191) NULL,
                    created_at DATETIME NOT NULL,
                    INDEX idx_networking_events_user (username),
                    INDEX idx_networking_events_source (source, created_at),
                    INDEX idx_networking_events_created (created_at)
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS networking_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    source TEXT NOT NULL,
                    community_id INTEGER,
                    target_username TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_networking_events_source"
                " ON networking_events(source, created_at)"
            )
        conn.commit()


def normalize_event(
    *,
    event_type: str,
    source: Optional[str],
    community_id=None,
    target_username: Optional[str] = None,
) -> Optional[dict]:
    """Validate/normalize an incoming event; return None if it should be dropped.

    Unknown sources collapse to 'direct' rather than erroring — an old client
    with a new source string must not lose the event entirely. Unknown event
    types ARE rejected (they signal a bug, not version skew).
    """
    etype = str(event_type or "").strip().lower()
    if etype not in EVENT_TYPES:
        return None
    src = str(source or "").strip().lower() or "direct"
    if src not in SOURCES:
        src = "direct"
    try:
        cid = int(community_id) if community_id is not None and str(community_id).strip() else None
    except Exception:
        cid = None
    target = str(target_username or "").strip()[:_MAX_USERNAME_LEN] or None
    return {
        "event_type": etype,
        "source": src,
        "community_id": cid,
        "target_username": target,
    }


def record_event(
    username: str,
    *,
    event_type: str,
    source: Optional[str],
    community_id=None,
    target_username: Optional[str] = None,
) -> bool:
    """Persist one attribution event. Never raises — attribution loss must
    never break the page it instruments."""
    user = str(username or "").strip()[:_MAX_USERNAME_LEN]
    if not user:
        return False
    normalized = normalize_event(
        event_type=event_type,
        source=source,
        community_id=community_id,
        target_username=target_username,
    )
    if normalized is None:
        return False
    try:
        ensure_events_table()
        ph = get_sql_placeholder()
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                INSERT INTO networking_events
                    (username, event_type, source, community_id, target_username, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                """,
                (
                    user,
                    normalized["event_type"],
                    normalized["source"],
                    normalized["community_id"],
                    normalized["target_username"],
                    now,
                ),
            )
            conn.commit()
        return True
    except Exception:
        logger.warning("networking_events.record_event failed for %s", user, exc_info=True)
        return False
