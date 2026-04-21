"""Community lifecycle scheduler — Free-community inactivity warnings.

Fires three owner-directed notifications for Free communities:

    1. ``pre_archive``           — first warning on ``free_inactivity_warn_day``
                                    (default day 75 of inactivity).
    2. ``pre_archive_last``      — final warning on
                                    ``free_inactivity_warn_last_day`` (day 88,
                                    2 days before auto-archive on day 90).
    3. ``purge_reminder``        — post-archive nudge on
                                    ``archive_purge_reminder_day`` (day 300 of
                                    archive; 65 days before the 365-day purge).

All thresholds are KB-driven via the ``community-tiers`` page so they can be
tuned without a code deploy. The dispatcher is idempotent: every sent
notification writes a row to ``community_lifecycle_notifications`` so
running the job multiple times in a single day never re-sends.

Kill switch: setting ``community_lifecycle_notifications_enabled`` to False
on the KB page pauses all sends without touching Cloud Scheduler. The job
still runs, logs its intent, and returns the counts it *would* have sent —
useful for dry-runs and incident mitigation.

Intentionally out of scope of this module:

  * The actual archive state transition (flipping ``archived_at``) — that
    lives in the archive sweep that runs on day 90. This module only
    *warns* about upcoming archives and upcoming purges.
  * The in-app Restore button — it already exists on the owner's community
    page and consumes the same ``archived_at`` column.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)


# ── Warning taxonomy ────────────────────────────────────────────────────
WARN_PRE_ARCHIVE = "pre_archive"
WARN_PRE_ARCHIVE_LAST = "pre_archive_last"
WARN_PURGE_REMINDER = "purge_reminder"

_ALL_WARNING_TYPES = (WARN_PRE_ARCHIVE, WARN_PRE_ARCHIVE_LAST, WARN_PURGE_REMINDER)

# Notification ``type`` column value — shared with the bell UI so these
# show up alongside other community notifications. Kept stable across
# warning variants so the client only needs one filter.
_NOTIF_TYPE = "community_lifecycle_warning"

# ``from_user`` stamp on the in-app notification. Using a sentinel rather
# than a real account keeps dispatches attributable and out of DM surfaces.
_NOTIF_FROM_USER = "system-lifecycle"


# ── Schema guards ──────────────────────────────────────────────────────


def ensure_tables() -> None:
    """Create the dedup table + archived_at column on first run.

    Both pieces are idempotent — safe to call on every dispatch. The
    column add is wrapped in try/except because MySQL doesn't have
    ``ADD COLUMN IF NOT EXISTS`` (8.0+ does, 5.7 doesn't); we take the
    "try and swallow duplicate-column errors" approach used elsewhere
    in the codebase.
    """
    from backend.services.database import USE_MYSQL

    use_mysql = bool(USE_MYSQL)

    with get_db_connection() as conn:
        c = conn.cursor()

        if use_mysql:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_lifecycle_notifications (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    community_id INT NOT NULL,
                    warning_type VARCHAR(64) NOT NULL,
                    sent_at DATETIME NOT NULL,
                    owner_username VARCHAR(191),
                    delivery_channel VARCHAR(32) DEFAULT 'in_app+email',
                    UNIQUE KEY uq_lifecycle_dedup (community_id, warning_type),
                    INDEX idx_lifecycle_sent_at (sent_at)
                )
                """
            )
        else:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_lifecycle_notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    community_id INTEGER NOT NULL,
                    warning_type TEXT NOT NULL,
                    sent_at TEXT NOT NULL,
                    owner_username TEXT,
                    delivery_channel TEXT DEFAULT 'in_app+email',
                    UNIQUE (community_id, warning_type)
                )
                """
            )

        # archived_at on communities — needed for the purge-reminder
        # selector. Absent on older schemas; add if missing.
        try:
            if use_mysql:
                c.execute("SHOW COLUMNS FROM communities LIKE 'archived_at'")
                has_col = c.fetchone() is not None
            else:
                c.execute("PRAGMA table_info(communities)")
                rows = c.fetchall() or []
                has_col = any(
                    (r["name"] if hasattr(r, "keys") else r[1]) == "archived_at"
                    for r in rows
                )
            if not has_col:
                if use_mysql:
                    c.execute("ALTER TABLE communities ADD COLUMN archived_at DATETIME NULL")
                else:
                    c.execute("ALTER TABLE communities ADD COLUMN archived_at TEXT")
        except Exception as exc:
            logger.warning("ensure_archived_at_column: %s", exc)

        try:
            conn.commit()
        except Exception:
            pass


# ── KB config loader ───────────────────────────────────────────────────


def _load_config_from_kb() -> Dict[str, Any]:
    """Fetch lifecycle fields + copy from the ``community-tiers`` KB page.

    Returns defaults on any error so the dispatcher still runs in a
    broken-KB state (the kill-switch defaults to True — i.e. sends
    continue — but every missing field falls back to its in-code value,
    so copy never renders as ``None``).
    """
    defaults: Dict[str, Any] = {
        "enabled": True,
        "warn_day": 75,
        "warn_last_day": 88,
        "archive_day": 90,
        "purge_reminder_day": 300,
        "purge_day": 365,
        "subject_pre_archive": "Your community \"{name}\" will be archived in 15 days",
        "body_pre_archive": (
            "Hi {owner},\n\nYour community \"{name}\" has had no posts or new "
            "members for {days} days. Free communities are automatically "
            "archived after {archive_day} days of inactivity.\n\nPost "
            "something, invite a member, or reply to this email to keep it "
            "active.\n\n— The C-Point team"
        ),
        "subject_pre_archive_last": "Last chance: \"{name}\" will be archived in 2 days",
        "body_pre_archive_last": (
            "Hi {owner},\n\nFinal reminder: your community \"{name}\" will "
            "be archived in 2 days if it stays inactive.\n\nA single post "
            "or a new member invite resets the clock.\n\n— The C-Point team"
        ),
        "subject_purge_reminder": "\"{name}\" will be permanently deleted in 65 days",
        "body_purge_reminder": (
            "Hi {owner},\n\nYour archived community \"{name}\" has been in "
            "archive for {days} days. In {remaining} days it will be "
            "permanently deleted.\n\nOpen the community in C-Point and "
            "click Restore to bring it back at any time before the purge "
            "date.\n\n— The C-Point team"
        ),
    }
    try:
        from backend.services.knowledge_base import get_page

        page = get_page("community-tiers") or {}
    except Exception:
        logger.warning("_load_config_from_kb: KB unavailable, using defaults")
        return defaults

    fields = {f.get("name"): f.get("value") for f in (page.get("fields") or [])}

    def _as_int(name: str, fallback: int) -> int:
        raw = fields.get(name)
        try:
            val = int(raw)
            return val if val > 0 else fallback
        except (TypeError, ValueError):
            return fallback

    def _as_str(name: str, fallback: str) -> str:
        raw = fields.get(name)
        if raw is None:
            return fallback
        text = str(raw)
        return text or fallback

    enabled_raw = fields.get("community_lifecycle_notifications_enabled")
    enabled = True if enabled_raw is None else bool(enabled_raw)

    return {
        "enabled": enabled,
        "warn_day": _as_int("free_inactivity_warn_day", defaults["warn_day"]),
        "warn_last_day": _as_int(
            "free_inactivity_warn_last_day", defaults["warn_last_day"]
        ),
        "archive_day": _as_int(
            "free_inactivity_archive_days", defaults["archive_day"]
        ),
        "purge_reminder_day": _as_int(
            "archive_purge_reminder_day", defaults["purge_reminder_day"]
        ),
        "purge_day": _as_int("free_inactivity_purge_days", defaults["purge_day"]),
        "subject_pre_archive": _as_str(
            "owner_warning_pre_archive_subject", defaults["subject_pre_archive"]
        ),
        "body_pre_archive": _as_str(
            "owner_warning_pre_archive_body", defaults["body_pre_archive"]
        ),
        "subject_pre_archive_last": _as_str(
            "owner_warning_pre_archive_last_subject",
            defaults["subject_pre_archive_last"],
        ),
        "body_pre_archive_last": _as_str(
            "owner_warning_pre_archive_last_body",
            defaults["body_pre_archive_last"],
        ),
        "subject_purge_reminder": _as_str(
            "owner_warning_purge_reminder_subject",
            defaults["subject_purge_reminder"],
        ),
        "body_purge_reminder": _as_str(
            "owner_warning_purge_reminder_body", defaults["body_purge_reminder"]
        ),
    }


# ── Candidate discovery ────────────────────────────────────────────────


def _fetch_last_activity_date(cursor, community_id: int) -> Optional[datetime]:
    """Return the most recent of (last post, last member join) for a community.

    ``None`` when the table has no rows for the community (never any
    activity — unusual but possible for a just-created Free community
    that was abandoned immediately).
    """
    placeholder = get_sql_placeholder()
    last: Optional[datetime] = None

    # Posts
    try:
        cursor.execute(
            f"""
            SELECT MAX(timestamp) AS last_post
            FROM posts
            WHERE community_id = {placeholder}
            """,
            (community_id,),
        )
        row = cursor.fetchone()
        if row:
            val = row["last_post"] if hasattr(row, "keys") else row[0]
            parsed = _coerce_datetime(val)
            if parsed and (last is None or parsed > last):
                last = parsed
    except Exception:
        # Posts table may not exist in some test environments.
        pass

    # Member joins
    try:
        cursor.execute(
            f"""
            SELECT MAX(joined_at) AS last_join
            FROM user_communities
            WHERE community_id = {placeholder}
            """,
            (community_id,),
        )
        row = cursor.fetchone()
        if row:
            val = row["last_join"] if hasattr(row, "keys") else row[0]
            parsed = _coerce_datetime(val)
            if parsed and (last is None or parsed > last):
                last = parsed
    except Exception:
        pass

    return last


def _coerce_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
    return None


def _days_since(dt: datetime, *, now: datetime) -> int:
    delta = now - dt
    return int(delta.total_seconds() // 86400)


def _was_already_notified(cursor, community_id: int, warning_type: str) -> bool:
    placeholder = get_sql_placeholder()
    try:
        cursor.execute(
            f"""
            SELECT 1 FROM community_lifecycle_notifications
            WHERE community_id = {placeholder} AND warning_type = {placeholder}
            LIMIT 1
            """,
            (community_id, warning_type),
        )
        return cursor.fetchone() is not None
    except Exception:
        # If the dedup table isn't there we treat as "already notified"
        # (fail-safe) so we never spam when the state we rely on is
        # missing. ``ensure_tables`` should have run, so this only fires
        # in a race.
        logger.exception("_was_already_notified: dedup check failed")
        return True


def _record_notification(
    cursor, community_id: int, warning_type: str, owner_username: Optional[str]
) -> None:
    placeholder = get_sql_placeholder()
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        cursor.execute(
            f"""
            INSERT INTO community_lifecycle_notifications
                (community_id, warning_type, sent_at, owner_username)
            VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder})
            """,
            (community_id, warning_type, now_str, owner_username),
        )
    except Exception:
        logger.exception(
            "_record_notification: insert failed for community=%s type=%s",
            community_id,
            warning_type,
        )


def _fetch_free_communities(cursor) -> List[Dict[str, Any]]:
    """Return (id, name, creator_username, archived_at) for every Free
    community. Non-free communities are out of scope (Paid tiers have
    separate non-payment lifecycle that ships with billing)."""
    try:
        cursor.execute(
            """
            SELECT id, name, creator_username,
                   COALESCE(tier, 'free') AS tier,
                   archived_at
            FROM communities
            WHERE (COALESCE(tier, '') = '' OR COALESCE(tier, 'free') = 'free')
              AND (parent_community_id IS NULL)
            """
        )
    except Exception:
        logger.exception("_fetch_free_communities: query failed")
        return []
    rows = cursor.fetchall() or []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if hasattr(row, "keys"):
            out.append(
                {
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "creator_username": row.get("creator_username"),
                    "archived_at": row.get("archived_at"),
                }
            )
        else:
            out.append(
                {
                    "id": row[0] if len(row) > 0 else None,
                    "name": row[1] if len(row) > 1 else None,
                    "creator_username": row[2] if len(row) > 2 else None,
                    "archived_at": row[4] if len(row) > 4 else None,
                }
            )
    return out


def _fetch_owner_email(cursor, username: Optional[str]) -> Optional[str]:
    if not username:
        return None
    placeholder = get_sql_placeholder()
    try:
        cursor.execute(
            f"SELECT email FROM users WHERE username = {placeholder}",
            (username,),
        )
        row = cursor.fetchone()
    except Exception:
        return None
    if not row:
        return None
    if hasattr(row, "keys"):
        val = row.get("email")
    else:
        val = row[0] if isinstance(row, (list, tuple)) and row else None
    return (str(val) if val else None) or None


# ── Delivery ──────────────────────────────────────────────────────────


def _send_in_app(*, owner_username: str, community_id: int, message: str) -> None:
    """In-app notification fan-out. Keeps the bell surface consistent
    with other community notifications."""
    try:
        from backend.services.notifications import (
            create_notification,
            truncate_notification_preview,
        )

        create_notification(
            owner_username,
            _NOTIF_FROM_USER,
            _NOTIF_TYPE,
            community_id=community_id,
            message=message,
            preview_text=truncate_notification_preview(message, 160),
        )
    except Exception:
        logger.exception(
            "_send_in_app: create_notification failed (owner=%s community=%s)",
            owner_username,
            community_id,
        )


def _send_email(*, to_email: str, subject: str, body_text: str) -> bool:
    """Transactional email via the existing Resend helper.

    We import the helper lazily to avoid importing the Flask monolith
    into this service at module load — which would pull the whole app
    into any cron process.
    """
    try:
        from bodybuilding_app import _send_email_via_resend  # type: ignore

        # Minimal HTML wrapper so the text body renders cleanly in clients
        # that prefer HTML. No images / tracking pixels.
        html = (
            "<div style=\"font-family: -apple-system, BlinkMacSystemFont, "
            "sans-serif; font-size: 14px; line-height: 1.5; color: #222;\">"
            f"{body_text.replace(chr(10), '<br>')}"
            "</div>"
        )
        return bool(_send_email_via_resend(to_email, subject, html, text=body_text))
    except Exception:
        logger.exception("_send_email: Resend send failed (to=%s)", to_email)
        return False


# ── Main dispatcher ────────────────────────────────────────────────────


def dispatch_due_notifications(*, dry_run: Optional[bool] = None) -> Dict[str, Any]:
    """Scan Free communities and fire any lifecycle warnings that are due.

    Returns a summary dict with per-warning counts and feature-flag state
    so the cron endpoint can surface it in Cloud Scheduler logs.

    Idempotency:
      * Every send writes a row to ``community_lifecycle_notifications``
        with a unique key on ``(community_id, warning_type)``.
      * Re-running the dispatcher in the same window is a no-op for
        already-notified communities.

    Dry-run semantics (``dry_run=True``):
      * Discovery + dedup checks still run.
      * In-app / email sends are skipped.
      * Dedup rows are **not** written — a subsequent real run still
        fires for the same communities. Use dry-run to preview, not to
        "clear" pending sends.

    Dry-run also activates when the KB kill-switch is off, regardless of
    the ``dry_run`` arg.
    """
    ensure_tables()
    config = _load_config_from_kb()
    flagged_off = not config["enabled"]
    effective_dry_run = bool(dry_run) or flagged_off

    now = datetime.utcnow()
    summary: Dict[str, Any] = {
        "enabled": config["enabled"],
        "dry_run": effective_dry_run,
        "scanned": 0,
        "already_notified": 0,
        "sent": {w: 0 for w in _ALL_WARNING_TYPES},
        "skipped_no_activity": 0,
        "skipped_no_owner": 0,
        "errors": 0,
        "config": {
            "warn_day": config["warn_day"],
            "warn_last_day": config["warn_last_day"],
            "archive_day": config["archive_day"],
            "purge_reminder_day": config["purge_reminder_day"],
            "purge_day": config["purge_day"],
        },
    }

    with get_db_connection() as conn:
        cursor = conn.cursor()
        communities = _fetch_free_communities(cursor)
        summary["scanned"] = len(communities)

        for comm in communities:
            try:
                warning = _select_warning_for_community(
                    cursor, comm, config, now=now
                )
                if warning is None:
                    continue

                if _was_already_notified(cursor, comm["id"], warning):
                    summary["already_notified"] += 1
                    continue

                owner = comm.get("creator_username")
                if not owner:
                    summary["skipped_no_owner"] += 1
                    continue

                subject, body = _render_copy(warning, comm, config, now=now)
                if not effective_dry_run:
                    _send_in_app(
                        owner_username=owner,
                        community_id=comm["id"],
                        message=body,
                    )
                    email = _fetch_owner_email(cursor, owner)
                    if email:
                        _send_email(to_email=email, subject=subject, body_text=body)
                    _record_notification(cursor, comm["id"], warning, owner)
                summary["sent"][warning] += 1
            except Exception:
                logger.exception(
                    "dispatch_due_notifications: community %s failed",
                    (comm or {}).get("id"),
                )
                summary["errors"] += 1

        try:
            conn.commit()
        except Exception:
            pass

    return summary


def _select_warning_for_community(
    cursor, comm: Dict[str, Any], config: Dict[str, Any], *, now: datetime
) -> Optional[str]:
    """Decide which (if any) warning applies to a community right now.

    Logic (in order):
      * Archived community older than ``purge_reminder_day`` → purge_reminder.
      * Active community with inactivity >= warn_last_day → pre_archive_last.
      * Active community with inactivity >= warn_day (< warn_last_day) →
        pre_archive.

    We key off **today's** inactivity day with ``>=`` rather than ``==``
    so a missed cron run still fires when the scheduler recovers; dedup
    on the sent table prevents double-sends once the job is back.
    """
    archived_at = _coerce_datetime(comm.get("archived_at"))
    if archived_at is not None:
        days_archived = _days_since(archived_at, now=now)
        if days_archived >= int(config["purge_reminder_day"]):
            return WARN_PURGE_REMINDER
        return None

    last_activity = _fetch_last_activity_date(cursor, comm["id"])
    if last_activity is None:
        return None

    days_inactive = _days_since(last_activity, now=now)
    if days_inactive >= int(config["warn_last_day"]):
        return WARN_PRE_ARCHIVE_LAST
    if days_inactive >= int(config["warn_day"]):
        return WARN_PRE_ARCHIVE
    return None


def _render_copy(
    warning: str, comm: Dict[str, Any], config: Dict[str, Any], *, now: datetime
) -> tuple[str, str]:
    """Fill in the KB-driven subject/body templates for a given warning."""
    name = comm.get("name") or "your community"
    owner = comm.get("creator_username") or "there"

    if warning == WARN_PRE_ARCHIVE:
        days = config["warn_day"]
        subject = config["subject_pre_archive"].format(name=name, owner=owner, days=days)
        body = config["body_pre_archive"].format(
            name=name, owner=owner, days=days, archive_day=config["archive_day"]
        )
        return subject, body
    if warning == WARN_PRE_ARCHIVE_LAST:
        days = config["warn_last_day"]
        subject = config["subject_pre_archive_last"].format(
            name=name, owner=owner, days=days
        )
        body = config["body_pre_archive_last"].format(
            name=name, owner=owner, days=days, archive_day=config["archive_day"]
        )
        return subject, body
    # WARN_PURGE_REMINDER
    archived_at = _coerce_datetime(comm.get("archived_at")) or now
    days_archived = _days_since(archived_at, now=now)
    remaining = max(0, int(config["purge_day"]) - days_archived)
    subject = config["subject_purge_reminder"].format(
        name=name, owner=owner, days=days_archived, remaining=remaining
    )
    body = config["body_purge_reminder"].format(
        name=name, owner=owner, days=days_archived, remaining=remaining
    )
    return subject, body
