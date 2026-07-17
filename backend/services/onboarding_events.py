"""Server-side onboarding funnel events.

One row per meaningful funnel transition, written from the existing
onboarding endpoints — no client analytics SDK involved. The table is the
source for funnel questions the product previously could not answer
(start → stage progress → complete/defer conversion).

Event vocabulary (see the ``EVENT_*`` constants):

    stage                  the user reached a new stage (deduped: consecutive
                           saves of the same stage produce one row)
    completed              POST /api/onboarding/complete
    deferred               POST /api/onboarding/defer_profile ("finish later"
                           taps, including the intro-gate Tier-1 exit)
    bootstrap_communities  successful B2B community bootstrap
    resume_required        GET /api/onboarding/state computed
                           requiresOnboardingResume=True (deduped per 24h —
                           the endpoint is polled on every dashboard load)

Funnel reconstruction:
    * start     = a user's earliest ``stage`` row (no separate event needed)
    * progress  = ordered ``stage`` rows
    * complete  = ``completed``; defer = ``deferred``
    * abandon   = DERIVED, not emitted: latest event is a ``stage`` row older
      than ~48h with no ``completed``/``deferred`` row after it
    * invite-accept → feed-view = derived from existing MySQL data
      (``community_invitations.used_at`` × ``community_visit_history``) —
      deliberately no new event here.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from backend.services.database import (
    USE_MYSQL,
    db_backend_is_mysql,
    get_db_connection,
    get_sql_placeholder,
)

logger = logging.getLogger(__name__)

EVENT_STAGE = "stage"
EVENT_COMPLETED = "completed"
EVENT_DEFERRED = "deferred"
EVENT_BOOTSTRAP = "bootstrap_communities"
EVENT_RESUME_REQUIRED = "resume_required"

_SCHEMA_READY = False


def _utc_now_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _ensure_index(cursor, index_name: str, column_sql: str) -> None:
    try:
        if db_backend_is_mysql():
            cursor.execute(
                f"ALTER TABLE onboarding_events ADD INDEX {index_name} ({column_sql})"
            )
        else:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS {index_name} ON onboarding_events ({column_sql})"
            )
    except Exception:
        pass


def ensure_tables() -> None:
    """Create the ``onboarding_events`` table. Idempotent per process."""
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return

    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS onboarding_events (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(191) NOT NULL,
                    event VARCHAR(40) NOT NULL,
                    stage VARCHAR(64) NULL,
                    intent VARCHAR(8) NULL,
                    client VARCHAR(16) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS onboarding_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    event TEXT NOT NULL,
                    stage TEXT NULL,
                    intent TEXT NULL,
                    client TEXT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        _ensure_index(c, "idx_onb_events_user_time", "username, created_at")
        _ensure_index(c, "idx_onb_events_event_time", "event, created_at")
        try:
            conn.commit()
        except Exception:
            pass

    _SCHEMA_READY = True


def client_label_from_request(req) -> Optional[str]:
    """Best-effort 'native' | 'web' label from the request UA. Never raises."""
    try:
        ua = (req.headers.get("User-Agent") or "").lower()
        if not ua:
            return None
        if "capacitor" in ua or "cpoint" in ua:
            return "native"
        return "web"
    except Exception:
        return None


def record_onboarding_event(
    username: str,
    event: str,
    *,
    stage: Optional[str] = None,
    intent: Optional[str] = None,
    client: Optional[str] = None,
    dedupe_consecutive_stage: bool = False,
    dedupe_within_hours: Optional[int] = None,
) -> None:
    """Insert one funnel event row. Never raises — a logging failure must
    not break an onboarding request.

    ``dedupe_consecutive_stage``: skip the insert when the user's most recent
    event is the same (event, stage) pair — the client saves state on nearly
    every chat turn, and only transitions are interesting.
    ``dedupe_within_hours``: skip when the same event exists for the user in
    the window (used for the polled resume_required signal).
    """
    if not username or not event:
        logger.debug("record_onboarding_event called without username/event, skipping")
        return

    try:
        ensure_tables()
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()

            if dedupe_consecutive_stage:
                c.execute(
                    f"""
                    SELECT event, stage FROM onboarding_events
                    WHERE username = {ph}
                    ORDER BY id DESC LIMIT 1
                    """,
                    (username,),
                )
                row = c.fetchone()
                if row is not None:
                    last_event = row["event"] if hasattr(row, "keys") else row[0]
                    last_stage = row["stage"] if hasattr(row, "keys") else row[1]
                    if last_event == event and (last_stage or None) == (stage or None):
                        return

            if dedupe_within_hours:
                cutoff = (
                    datetime.utcnow() - timedelta(hours=int(dedupe_within_hours))
                ).strftime("%Y-%m-%d %H:%M:%S")
                c.execute(
                    f"""
                    SELECT 1 FROM onboarding_events
                    WHERE username = {ph} AND event = {ph} AND created_at >= {ph}
                    LIMIT 1
                    """,
                    (username, event, cutoff),
                )
                if c.fetchone() is not None:
                    return

            c.execute(
                f"""
                INSERT INTO onboarding_events (username, event, stage, intent, client, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                """,
                (
                    username,
                    event[:40],
                    (stage or None) and str(stage)[:64],
                    (intent or None) and str(intent)[:8],
                    (client or None) and str(client)[:16],
                    _utc_now_str(),
                ),
            )
            try:
                conn.commit()
            except Exception:
                pass
    except Exception as err:
        logger.warning("onboarding_events.record_onboarding_event failed: %s", err)


def funnel_summary(days: int = 30) -> dict:
    """Distinct-user counts per funnel event over a trailing window.

    Read side for the admin activation-funnel endpoint. Shape::

        {
          "window_days": 30,
          "started": 12,                     # distinct users with any stage row
          "stages": {"intent": 12, ...},     # distinct users who reached each stage
          "completed": 7,
          "deferred": 3,
          "bootstrap_communities": 1,
          "resume_required": 4,
        }

    Fail-open: a query failure returns zeroed counts, never an exception
    into the host request.
    """
    try:
        window = max(1, min(int(days or 30), 365))
    except Exception:
        window = 30
    out: dict = {
        "window_days": window,
        "started": 0,
        "stages": {},
        "completed": 0,
        "deferred": 0,
        "bootstrap_communities": 0,
        "resume_required": 0,
    }
    try:
        ensure_tables()
        ph = get_sql_placeholder()
        cutoff = (
            datetime.utcnow() - timedelta(days=window)
        ).strftime("%Y-%m-%d %H:%M:%S")
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                SELECT event, COUNT(DISTINCT username) AS users
                FROM onboarding_events
                WHERE created_at >= {ph}
                GROUP BY event
                """,
                (cutoff,),
            )
            per_event = {}
            for row in c.fetchall() or []:
                event = row["event"] if hasattr(row, "keys") else row[0]
                users = row["users"] if hasattr(row, "keys") else row[1]
                per_event[str(event)] = int(users or 0)
            out["started"] = per_event.get(EVENT_STAGE, 0)
            out["completed"] = per_event.get(EVENT_COMPLETED, 0)
            out["deferred"] = per_event.get(EVENT_DEFERRED, 0)
            out["bootstrap_communities"] = per_event.get(EVENT_BOOTSTRAP, 0)
            out["resume_required"] = per_event.get(EVENT_RESUME_REQUIRED, 0)

            c.execute(
                f"""
                SELECT stage, COUNT(DISTINCT username) AS users
                FROM onboarding_events
                WHERE event = {ph} AND stage IS NOT NULL AND created_at >= {ph}
                GROUP BY stage
                """,
                (EVENT_STAGE, cutoff),
            )
            for row in c.fetchall() or []:
                stage = row["stage"] if hasattr(row, "keys") else row[0]
                users = row["users"] if hasattr(row, "keys") else row[1]
                if stage:
                    out["stages"][str(stage)] = int(users or 0)
    except Exception as err:
        logger.warning("onboarding_events.funnel_summary failed: %s", err)
    return out
