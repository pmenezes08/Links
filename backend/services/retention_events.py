"""Retention attribution events — the instrumentation sink for return loops.

The weekly member digest, the owner pulse, and the Owner Dashboard action
rows all deep-link back into the app with a ``?source=`` param. This service
is the sink that makes those params measurable: one small append-only table,
written via a thin blueprint (`backend/blueprints/retention_events.py`) and
directly from the cron senders.

Privacy: rows carry the acting user, a closed event/source vocabulary, and
optional community/group ids — never message content, never *other* members'
identities. This is analytics plumbing, NOT an AI surface: no entitlement
gate beyond login, no ai_usage rows, no paid calls.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

# Closed sets — reject anything else so dashboards never chase free-text drift.
EVENT_TYPES = {
    "digest_sent",          # member weekly digest reserved + pushed (cron-side)
    "digest_opened",        # member landed on the digest deep link
    "owner_pulse_opened",   # owner landed on the dashboard from the pulse
    "owner_action_tapped",  # owner tapped a Steve action row on the dashboard
    "owner_dashboard_opened",       # any Owner Dashboard open (guardrail denominator)
    # Owner upgrade surface funnel. `detail` carries the trigger cohort
    # (e.g. "cohort:cap_pressure", "tier:paid_l1", "mode:explicit").
    # Conversion truth is NOT a client event — it's the Stripe webhook →
    # subscription_audit join; these rows measure the funnel up to
    # checkout start. `upgrade_page_shown` doubles as the 14-day
    # frequency-window record (owner_upgrade_prompt.recently_shown).
    "upgrade_page_shown",
    "upgrade_page_tier_viewed",
    "upgrade_page_dismissed",
    "upgrade_page_checkout_started",
}
SOURCES = {
    "weekly_digest_cron",   # server-side send marker
    "weekly_digest_push",   # client tap-through from push / in-app row
    "owner_pulse_push",     # client tap-through from the owner pulse
    "owner_dashboard",      # action rows on the Owner Dashboard
    "upgrade_interstitial", # taps originating on the owner upgrade surface
    "direct",               # opened with no source param
}

_MAX_USERNAME_LEN = 191
_MAX_DETAIL_LEN = 64


def ensure_events_table() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS retention_events (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(191) NOT NULL,
                    event_type VARCHAR(32) NOT NULL,
                    source VARCHAR(32) NOT NULL,
                    community_id INT NULL,
                    group_id INT NULL,
                    detail VARCHAR(64) NULL,
                    created_at DATETIME NOT NULL,
                    INDEX idx_retention_events_user (username),
                    INDEX idx_retention_events_type (event_type, created_at),
                    INDEX idx_retention_events_source (source, created_at)
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS retention_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    source TEXT NOT NULL,
                    community_id INTEGER,
                    group_id INTEGER,
                    detail TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            c.execute(
                "CREATE INDEX IF NOT EXISTS idx_retention_events_type"
                " ON retention_events(event_type, created_at)"
            )
        conn.commit()


def normalize_event(
    *,
    event_type: str,
    source: Optional[str],
    community_id=None,
    group_id=None,
    detail: Optional[str] = None,
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

    def _int_or_none(value):
        try:
            return int(value) if value is not None and str(value).strip() else None
        except Exception:
            return None

    return {
        "event_type": etype,
        "source": src,
        "community_id": _int_or_none(community_id),
        "group_id": _int_or_none(group_id),
        "detail": (str(detail or "").strip()[:_MAX_DETAIL_LEN] or None),
    }


def recently_recorded(
    username: str,
    *,
    event_type: str,
    within_days: int,
) -> bool:
    """True if ``username`` has an ``event_type`` row in the last N days.

    Used as the durable frequency window for interruptive surfaces (e.g.
    the owner upgrade interstitial shows at most once per 14 days, keyed
    on its own ``upgrade_page_shown`` rows — measurement and gating share
    one record). Fail-open: a query failure reads as "not recently", the
    same degrade direction as :mod:`rate_limit`.
    """
    user = str(username or "").strip()
    etype = str(event_type or "").strip().lower()
    if not user or etype not in EVENT_TYPES or within_days <= 0:
        return False
    try:
        ensure_events_table()
        ph = get_sql_placeholder()
        cutoff = datetime.utcnow() - timedelta(days=int(within_days))
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                SELECT 1 FROM retention_events
                WHERE username = {ph} AND event_type = {ph} AND created_at >= {ph}
                LIMIT 1
                """,
                (user, etype, cutoff.strftime("%Y-%m-%d %H:%M:%S")),
            )
            return c.fetchone() is not None
    except Exception:
        logger.warning(
            "retention_events.recently_recorded failed for %s/%s", user, etype,
            exc_info=True,
        )
        return False


def record_event(
    username: str,
    *,
    event_type: str,
    source: Optional[str],
    community_id=None,
    group_id=None,
    detail: Optional[str] = None,
) -> bool:
    """Persist one attribution event. Never raises — attribution loss must
    never break the surface it instruments."""
    user = str(username or "").strip()[:_MAX_USERNAME_LEN]
    if not user:
        return False
    normalized = normalize_event(
        event_type=event_type,
        source=source,
        community_id=community_id,
        group_id=group_id,
        detail=detail,
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
                INSERT INTO retention_events
                    (username, event_type, source, community_id, group_id, detail, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                """,
                (
                    user,
                    normalized["event_type"],
                    normalized["source"],
                    normalized["community_id"],
                    normalized["group_id"],
                    normalized["detail"],
                    now,
                ),
            )
            conn.commit()
        return True
    except Exception:
        logger.warning("retention_events.record_event failed for %s", user, exc_info=True)
        return False
