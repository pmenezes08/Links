"""Cron sweeps for lifecycle email — welcome, activation nudges, verification reminder.

Same doctrine as :mod:`owner_pulse` / :mod:`member_digest`:

* **INSERT-first reservation** (``lifecycle_email_sends``, UNIQUE(recipient,
  kind)) so Cloud Scheduler retries stay idempotent. At-most-once: a send
  failure after the reservation is logged and dropped, never double-sent.
* **Cron-swept, never inline** — the signup/verification request path is
  never coupled to Resend latency or availability.
* **Kill switches** per stream (``WELCOME_EMAIL_ENABLED``,
  ``ACTIVATION_NUDGE_EMAIL_ENABLED``, ``VERIFICATION_REMINDER_EMAIL_ENABLED``)
  on top of the chokepoint's master ``LIFECYCLE_EMAIL_ENABLED``; ``dry_run``
  works regardless and writes/sends nothing.
* **Owner/member path split**: a user who already belongs to a community
  (they arrived via invite, or created one) gets the member welcome anchored
  to that community — never "create your first community".
* **Contact spacing**: at most one lifecycle email per recipient per
  ``MIN_GAP_HOURS`` (48h), and each kind fires at most once ever.

Cohort truth reused, not reimplemented: ``user_communities`` membership,
``retention_events`` activation events (``community_created`` /
``invite_sent``), ``pending_signups.verification_sent_at``.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.services import lifecycle_email
from backend.services import lifecycle_email_templates as templates
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

DEFAULT_MAX_SENDS = 200

KIND_WELCOME = "welcome"
KIND_NO_COMMUNITY = "no_community_nudge"
KIND_EMPTY_COMMUNITY = "empty_community_nudge"
KIND_VERIFICATION_REMINDER = "verification_reminder"

# Timing (hours) — welcome sweeps a trailing window; nudges have min/max ages
# so an old backlog never gets a stale blast when the cron first turns on.
WELCOME_MAX_AGE_HOURS = 72
NO_COMMUNITY_MIN_AGE_HOURS = 48
NO_COMMUNITY_MAX_AGE_HOURS = 14 * 24
EMPTY_COMMUNITY_MIN_AGE_HOURS = 96
EMPTY_COMMUNITY_MAX_AGE_HOURS = 30 * 24
VERIFICATION_MIN_AGE_HOURS = 24
VERIFICATION_MAX_AGE_HOURS = 7 * 24
MIN_GAP_HOURS = 48

_SENDS_DDL_MYSQL = """
CREATE TABLE IF NOT EXISTS lifecycle_email_sends (
    id INT PRIMARY KEY AUTO_INCREMENT,
    recipient VARCHAR(191) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_lifecycle_send (recipient, kind)
)
"""
_SENDS_DDL_SQLITE = """
CREATE TABLE IF NOT EXISTS lifecycle_email_sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient TEXT NOT NULL,
    kind TEXT NOT NULL,
    sent_at TEXT DEFAULT (datetime('now')),
    UNIQUE (recipient, kind)
)
"""

# Never email operator/demo/placeholder accounts (seed scripts, QR invites).
#
# Literal ``%`` in LIKE patterns must be doubled for pymysql: with params
# present it %-interpolates the query text, and a bare ``%@`` raises
# ``ValueError: unsupported format character '@'`` (crashes the sweep).
# SQLite's qmark style does no interpolation, so it keeps single ``%``.
_LIKE_PCT = "%%" if USE_MYSQL else "%"
_EXCLUDED_EMAIL_SQL = (
    " AND u.email IS NOT NULL AND u.email <> ''"
    f" AND u.email NOT LIKE '{_LIKE_PCT}@placeholder.local'"
    f" AND u.email NOT LIKE 'demo_b2b_{_LIKE_PCT}'"
    f" AND u.email NOT LIKE 'staging_test_{_LIKE_PCT}'"
    " AND LOWER(u.username) <> 'admin'"
)


def _stream_enabled(env_var: str) -> bool:
    return (os.environ.get(env_var) or "").strip().lower() in {"1", "true", "yes", "on"}


def _now() -> datetime:
    return datetime.utcnow()


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _ensure_sends_table(cursor) -> None:
    try:
        cursor.execute(_SENDS_DDL_MYSQL if USE_MYSQL else _SENDS_DDL_SQLITE)
    except Exception:  # pragma: no cover - table exists / limited env
        pass


def _try_reserve(conn, cursor, recipient: str, kind: str) -> bool:
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"INSERT INTO lifecycle_email_sends (recipient, kind, sent_at) VALUES ({ph}, {ph}, {ph})",
            (recipient, kind, _fmt(_now())),
        )
        try:
            conn.commit()
        except Exception:
            pass
        return True
    except Exception:
        return False


def _already_sent(cursor, recipient: str, kind: str) -> bool:
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"SELECT 1 FROM lifecycle_email_sends WHERE recipient = {ph} AND kind = {ph} LIMIT 1",
            (recipient, kind),
        )
        return cursor.fetchone() is not None
    except Exception:
        return False


def _recently_contacted(cursor, recipient: str, *, within_hours: int = MIN_GAP_HOURS) -> bool:
    """Cross-kind spacing: any lifecycle email to this recipient lately?"""
    ph = get_sql_placeholder()
    cutoff = _fmt(_now() - timedelta(hours=within_hours))
    try:
        cursor.execute(
            f"SELECT 1 FROM lifecycle_email_sends WHERE recipient = {ph} AND sent_at >= {ph} LIMIT 1",
            (recipient, cutoff),
        )
        return cursor.fetchone() is not None
    except Exception:
        return False


def _release_reservation(conn, cursor, recipient: str, kind: str) -> None:
    """Drop a reservation whose send was skipped (suppressed / no email).

    Only used for *skips known before any send attempt left the building* —
    a real send failure keeps its reservation (at-most-once)."""
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"DELETE FROM lifecycle_email_sends WHERE recipient = {ph} AND kind = {ph}",
            (recipient, kind),
        )
        try:
            conn.commit()
        except Exception:
            pass
    except Exception:
        pass


def _logo_url() -> str:
    return f"{lifecycle_email.public_base_url()}/static/cpoint-logo.png"


def _cta_url(kind: str) -> str:
    return f"{lifecycle_email.public_base_url()}/login?source=lifecycle_email_{kind}"


def _first_community_name(cursor, username: str) -> Optional[str]:
    """Name of the earliest community this user belongs to, if any."""
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"""
            SELECT co.name
            FROM user_communities uc
            JOIN users u ON u.id = uc.user_id
            JOIN communities co ON co.id = uc.community_id
            WHERE u.username = {ph}
            ORDER BY uc.joined_at ASC, uc.id ASC
            LIMIT 1
            """,
            (username,),
        )
        row = cursor.fetchone()
    except Exception:
        return None
    if not row:
        return None
    return row["name"] if hasattr(row, "keys") else row[0]


def _verified_filter_sql() -> str:
    # OAuth users skip email verification; their rows carry provider ids.
    return (
        " AND (u.email_verified = 1 OR u.google_id IS NOT NULL OR u.apple_id IS NOT NULL)"
    )


def _welcome_candidates(cursor) -> List[Dict[str, Any]]:
    ph = get_sql_placeholder()
    cutoff = _fmt(_now() - timedelta(hours=WELCOME_MAX_AGE_HOURS))
    base = f"""
        SELECT u.username
        FROM users u
        WHERE u.created_at >= {ph}
        {_EXCLUDED_EMAIL_SQL}
        {{verified}}
          AND NOT EXISTS (
              SELECT 1 FROM lifecycle_email_sends s
              WHERE s.recipient = u.username AND s.kind = {ph}
          )
        ORDER BY u.created_at ASC
    """
    try:
        cursor.execute(base.format(verified=_verified_filter_sql()), (cutoff, KIND_WELCOME))
    except Exception:
        # google_id/apple_id columns absent in this environment.
        cursor.execute(
            base.format(verified=" AND u.email_verified = 1"), (cutoff, KIND_WELCOME)
        )
    rows = cursor.fetchall() or []
    return [
        {"username": (r["username"] if hasattr(r, "keys") else r[0])}
        for r in rows
    ]


def run_welcome_sweep(*, dry_run: bool = False, max_sends: int = DEFAULT_MAX_SENDS) -> Dict[str, Any]:
    """Welcome email for users whose row appeared in the last 72h.

    Owner variant (create your first community) for organic signups; member
    variant (you're in {community}) when a membership already exists.
    """
    result: Dict[str, Any] = {
        "success": True, "dry_run": dry_run,
        "enabled": _stream_enabled("WELCOME_EMAIL_ENABLED"),
        "candidates": 0, "sent": 0, "skipped_dedup": 0,
        "skipped_suppressed": 0, "skipped_disabled": 0, "errors": 0,
    }
    with get_db_connection() as conn:
        c = conn.cursor()
        _ensure_sends_table(c)
        candidates = _welcome_candidates(c)
        result["candidates"] = len(candidates)

        if dry_run:
            preview = []
            for cand in candidates[:100]:
                community = _first_community_name(c, cand["username"])
                preview.append({
                    "username": cand["username"],
                    "variant": "welcome_member" if community else "welcome_owner",
                    "community": community,
                })
            result["preview"] = preview
            return result

        if not result["enabled"]:
            result["success"] = False
            result["error"] = "WELCOME_EMAIL_ENABLED is off"
            return result

        for cand in candidates[: max(0, int(max_sends))]:
            username = cand["username"]
            try:
                if not _try_reserve(conn, c, username, KIND_WELCOME):
                    result["skipped_dedup"] += 1
                    continue
                community = _first_community_name(c, username)
                variant = "welcome_member" if community else "welcome_owner"
                _email, locale = lifecycle_email.user_email_and_locale(username)
                cta_url = _cta_url(variant)
                if community:
                    subject, html, text = templates.render_welcome_member(
                        community_name=community, logo_url=_logo_url(),
                        cta_url=cta_url, locale=locale,
                    )
                else:
                    subject, html, text = templates.render_welcome_owner(
                        logo_url=_logo_url(), cta_url=cta_url, locale=locale,
                    )
                status = lifecycle_email.send(
                    username, kind=variant, subject=subject, html=html, text=text,
                )
                if status == "sent":
                    result["sent"] += 1
                elif status in ("suppressed", "no_email"):
                    result["skipped_suppressed"] += 1
                    _release_reservation(conn, c, username, KIND_WELCOME)
                elif status == "disabled":
                    result["skipped_disabled"] += 1
                    _release_reservation(conn, c, username, KIND_WELCOME)
                else:
                    # Real send failure: reservation stands (at-most-once).
                    result["errors"] += 1
            except Exception as exc:
                logger.error("welcome sweep failed for %s: %s", username, exc, exc_info=True)
                result["errors"] += 1
    return result


def _no_community_candidates(cursor) -> List[Dict[str, Any]]:
    ph = get_sql_placeholder()
    newest = _fmt(_now() - timedelta(hours=NO_COMMUNITY_MIN_AGE_HOURS))
    oldest = _fmt(_now() - timedelta(hours=NO_COMMUNITY_MAX_AGE_HOURS))
    base = f"""
        SELECT u.username
        FROM users u
        WHERE u.created_at <= {ph} AND u.created_at >= {ph}
        {_EXCLUDED_EMAIL_SQL}
        {{verified}}
          AND NOT EXISTS (
              SELECT 1 FROM user_communities uc WHERE uc.user_id = u.id
          )
          AND NOT EXISTS (
              SELECT 1 FROM lifecycle_email_sends s
              WHERE s.recipient = u.username AND s.kind = {ph}
          )
        ORDER BY u.created_at ASC
    """
    try:
        cursor.execute(
            base.format(verified=_verified_filter_sql()), (newest, oldest, KIND_NO_COMMUNITY)
        )
    except Exception:
        cursor.execute(
            base.format(verified=" AND u.email_verified = 1"),
            (newest, oldest, KIND_NO_COMMUNITY),
        )
    rows = cursor.fetchall() or []
    return [
        {"username": (r["username"] if hasattr(r, "keys") else r[0])}
        for r in rows
    ]


def _empty_community_candidates(cursor) -> List[Dict[str, Any]]:
    """Root communities ≥96h old whose only member is (at most) the owner."""
    ph = get_sql_placeholder()
    newest = _fmt(_now() - timedelta(hours=EMPTY_COMMUNITY_MIN_AGE_HOURS))
    oldest = _fmt(_now() - timedelta(hours=EMPTY_COMMUNITY_MAX_AGE_HOURS))
    cursor.execute(
        f"""
        SELECT co.id, co.name, co.creator_username
        FROM communities co
        JOIN users u ON u.username = co.creator_username
        WHERE co.created_at <= {ph} AND co.created_at >= {ph}
          AND co.parent_community_id IS NULL
          AND co.creator_username IS NOT NULL
          AND LOWER(co.creator_username) <> 'admin'
          {_EXCLUDED_EMAIL_SQL}
          AND (SELECT COUNT(*) FROM user_communities uc WHERE uc.community_id = co.id) <= 1
          AND NOT EXISTS (
              SELECT 1 FROM lifecycle_email_sends s
              WHERE s.recipient = co.creator_username AND s.kind = {ph}
          )
        ORDER BY co.created_at ASC
        """,
        (newest, oldest, KIND_EMPTY_COMMUNITY),
    )
    rows = cursor.fetchall() or []
    out: List[Dict[str, Any]] = []
    seen = set()
    for r in rows:
        owner = (r["creator_username"] if hasattr(r, "keys") else r[2]) or ""
        key = owner.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({
            "community_id": int(r["id"] if hasattr(r, "keys") else r[0]),
            "community": r["name"] if hasattr(r, "keys") else r[1],
            "owner": owner,
        })
    return out


def run_activation_nudge_sweep(
    *, dry_run: bool = False, max_sends: int = DEFAULT_MAX_SENDS
) -> Dict[str, Any]:
    """Two nudges, one daily sweep:

    * ``no_community_nudge`` — organic users 2–14 days old with no
      membership anywhere: "create your first community".
    * ``empty_community_nudge`` — owners whose community is ≥4 days old and
      still has nobody in it (and no invite_sent activation event): invite
      the first few people.
    """
    from backend.services import retention_events

    result: Dict[str, Any] = {
        "success": True, "dry_run": dry_run,
        "enabled": _stream_enabled("ACTIVATION_NUDGE_EMAIL_ENABLED"),
        "no_community": {"candidates": 0, "sent": 0, "skipped": 0, "errors": 0},
        "empty_community": {"candidates": 0, "sent": 0, "skipped": 0, "errors": 0},
    }
    sends_budget = max(0, int(max_sends))
    with get_db_connection() as conn:
        c = conn.cursor()
        _ensure_sends_table(c)

        no_comm = _no_community_candidates(c)
        empty_comm = [
            cand for cand in _empty_community_candidates(c)
            # invite_sent since creation kills the nudge — the owner already
            # made the move; an unaccepted invite is a different (P1) problem.
            if not retention_events.recently_recorded(
                cand["owner"], event_type="invite_sent",
                within_days=EMPTY_COMMUNITY_MAX_AGE_HOURS // 24,
            )
        ]
        result["no_community"]["candidates"] = len(no_comm)
        result["empty_community"]["candidates"] = len(empty_comm)

        if dry_run:
            result["no_community"]["preview"] = [cand["username"] for cand in no_comm[:100]]
            result["empty_community"]["preview"] = [
                {"owner": cand["owner"], "community": cand["community"]}
                for cand in empty_comm[:100]
            ]
            return result

        if not result["enabled"]:
            result["success"] = False
            result["error"] = "ACTIVATION_NUDGE_EMAIL_ENABLED is off"
            return result

        def _dispatch(bucket: str, recipient: str, kind: str, render) -> None:
            nonlocal sends_budget
            counters = result[bucket]
            if sends_budget <= 0:
                return
            if _recently_contacted(c, recipient):
                counters["skipped"] += 1
                return
            if not _try_reserve(conn, c, recipient, kind):
                counters["skipped"] += 1
                return
            try:
                _email, locale = lifecycle_email.user_email_and_locale(recipient)
                subject, html, text = render(locale)
                status = lifecycle_email.send(
                    recipient, kind=kind, subject=subject, html=html, text=text,
                )
                if status == "sent":
                    counters["sent"] += 1
                    sends_budget -= 1
                elif status in ("suppressed", "no_email", "disabled"):
                    counters["skipped"] += 1
                    _release_reservation(conn, c, recipient, kind)
                else:
                    counters["errors"] += 1
            except Exception as exc:
                logger.error(
                    "activation nudge (%s) failed for %s: %s", kind, recipient, exc,
                    exc_info=True,
                )
                counters["errors"] += 1

        for cand in no_comm:
            _dispatch(
                "no_community", cand["username"], KIND_NO_COMMUNITY,
                lambda locale: templates.render_no_community_nudge(
                    logo_url=_logo_url(), cta_url=_cta_url(KIND_NO_COMMUNITY),
                    locale=locale,
                ),
            )
        for cand in empty_comm:
            _dispatch(
                "empty_community", cand["owner"], KIND_EMPTY_COMMUNITY,
                lambda locale, _cand=cand: templates.render_empty_community_nudge(
                    community_name=_cand["community"], logo_url=_logo_url(),
                    cta_url=_cta_url(KIND_EMPTY_COMMUNITY), locale=locale,
                ),
            )
    return result


def _verification_candidates(cursor) -> List[Dict[str, Any]]:
    ph = get_sql_placeholder()
    # pending_signups timestamps are isoformat ('T' separator) — build both
    # cutoffs the same way the writers do so string comparison stays sane.
    newest = (_now() - timedelta(hours=VERIFICATION_MIN_AGE_HOURS)).isoformat()
    oldest = (_now() - timedelta(hours=VERIFICATION_MAX_AGE_HOURS)).isoformat()
    cursor.execute(
        f"""
        SELECT p.id, p.email
        FROM pending_signups p
        WHERE p.verification_sent_at IS NOT NULL
          AND p.verification_sent_at <= {ph} AND p.verification_sent_at >= {ph}
          AND p.email NOT LIKE '{_LIKE_PCT}@placeholder.local'
          AND NOT EXISTS (
              SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(p.email)
          )
          AND NOT EXISTS (
              SELECT 1 FROM lifecycle_email_sends s
              WHERE s.recipient = LOWER(p.email) AND s.kind = {ph}
          )
        ORDER BY p.id ASC
        """,
        (newest, oldest, KIND_VERIFICATION_REMINDER),
    )
    rows = cursor.fetchall() or []
    return [
        {
            "pending_id": int(r["id"] if hasattr(r, "keys") else r[0]),
            "email": (r["email"] if hasattr(r, "keys") else r[1]) or "",
        }
        for r in rows
    ]


def run_verification_reminder_sweep(
    *, dry_run: bool = False, max_sends: int = DEFAULT_MAX_SENDS,
    token_factory=None,
) -> Dict[str, Any]:
    """One reminder to pending signups that never verified (24h–7d old).

    Transactional (the user started this signup): bypasses the lifecycle
    chokepoint and consent model, but is still reservation-capped at exactly
    once per address. A FRESH verification token is minted at send time —
    the original one expires 24h after signup, so re-sending it would mail
    a dead link.
    """
    from backend.services import transactional_email

    result: Dict[str, Any] = {
        "success": True, "dry_run": dry_run,
        "enabled": _stream_enabled("VERIFICATION_REMINDER_EMAIL_ENABLED"),
        "candidates": 0, "sent": 0, "skipped_dedup": 0, "errors": 0,
    }
    with get_db_connection() as conn:
        c = conn.cursor()
        _ensure_sends_table(c)
        candidates = _verification_candidates(c)
        result["candidates"] = len(candidates)

        if dry_run:
            result["preview"] = [cand["email"] for cand in candidates[:100]]
            return result

        if not result["enabled"]:
            result["success"] = False
            result["error"] = "VERIFICATION_REMINDER_EMAIL_ENABLED is off"
            return result

        # Lazy import — the token helpers live in the monolith; the cron runs
        # inside the app process where it is already imported. Tests inject a
        # stub ``token_factory`` (the monolith import would register 300+
        # routes in the test process).
        if token_factory is None:
            from bodybuilding_app import generate_pending_signup_token
            token_factory = generate_pending_signup_token

        for cand in candidates[: max(0, int(max_sends))]:
            recipient_key = cand["email"].strip().lower()
            if not recipient_key:
                continue
            try:
                if not _try_reserve(conn, c, recipient_key, KIND_VERIFICATION_REMINDER):
                    result["skipped_dedup"] += 1
                    continue
                token = token_factory(cand["pending_id"], cand["email"])
                verify_url = f"{lifecycle_email.public_base_url()}/verify_email?token={token}"
                subject, html, text = templates.render_verification_reminder(
                    verify_url=verify_url, logo_url=_logo_url(), locale=None,
                )
                ok = transactional_email.send(cand["email"], subject, html, text=text)
                if ok:
                    result["sent"] += 1
                else:
                    result["errors"] += 1
            except Exception as exc:
                logger.error(
                    "verification reminder failed for pending id %s: %s",
                    cand.get("pending_id"), exc, exc_info=True,
                )
                result["errors"] += 1
    return result
