"""
Enterprise membership & seat tracking.

An *Enterprise seat* is a Premium-equivalent AI entitlement a user gets by
being a member of a community whose ``tier = 'enterprise'``. A single
``user_enterprise_seats`` row is the source of truth: rows with
``ended_at IS NULL`` are live seats; rows with a value set are historical
(or within the grace window).

This module owns:

    * schema for ``communities.tier`` + ``user_enterprise_seats``
    * :func:`start_seat` / :func:`end_seat` (called by join/leave hooks)
    * :func:`active_seat_for` used by :mod:`backend.services.entitlements`
    * :func:`grace_window_for_action` — reads grace_days_* from KB

The Enterprise Seat KB pages are the source of truth for policy
(grace_days_*, iap_grace_days, winback eligibility). This module reads
those values on every call so a KB edit takes effect instantly.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from backend.services import knowledge_base as kb
from backend.services import subscription_audit
from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)


# End-reason vocabulary used throughout the lifecycle.
SEAT_END_REASONS = {
    "voluntary_leave",         # user clicks "leave community"
    "removed_by_admin",        # community admin kicks them
    "community_downgraded",    # owner switches community off Enterprise
    "community_deleted",       # community owner deletes the community
    "community_suspended",     # policy / billing lapse
    "admin_override",          # app admin force-ends the seat
}


def _utc_now() -> datetime:
    return datetime.utcnow()


def _utc_now_str() -> str:
    return _utc_now().strftime("%Y-%m-%d %H:%M:%S")


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    s = str(value)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[: len(fmt)], fmt)
        except Exception:
            continue
    return None


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def ensure_tables() -> None:
    """Add ``communities.tier`` + create ``user_enterprise_seats`` if missing."""
    with get_db_connection() as conn:
        c = conn.cursor()

        # Extend communities with a tier column. Default 'free' so every
        # existing row keeps current behaviour; admins opt-in to 'paid' or
        # 'enterprise' via the admin-web.
        try:
            c.execute("ALTER TABLE communities ADD COLUMN tier VARCHAR(32) NOT NULL DEFAULT 'free'")
        except Exception:
            pass

        # Seat ledger.
        try:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS user_enterprise_seats (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(191) NOT NULL,
                    community_id INT NOT NULL,
                    community_slug VARCHAR(191) NULL,
                    started_at TIMESTAMP NOT NULL,
                    ended_at TIMESTAMP NULL,
                    end_reason VARCHAR(64) NULL,
                    grace_until TIMESTAMP NULL,
                    had_personal_premium_at_join TINYINT(1) NOT NULL DEFAULT 0,
                    return_intent TINYINT(1) NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_ent_seat_user (username, ended_at),
                    INDEX idx_ent_seat_community (community_id, ended_at),
                    UNIQUE KEY uq_seat_active (username, community_id, ended_at)
                )
                """
            )
        except Exception:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS user_enterprise_seats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username VARCHAR(191) NOT NULL,
                    community_id INTEGER NOT NULL,
                    community_slug VARCHAR(191) NULL,
                    started_at TIMESTAMP NOT NULL,
                    ended_at TIMESTAMP NULL,
                    end_reason VARCHAR(64) NULL,
                    grace_until TIMESTAMP NULL,
                    had_personal_premium_at_join INTEGER NOT NULL DEFAULT 0,
                    return_intent INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        try:
            conn.commit()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Policy reads from KB
# ---------------------------------------------------------------------------

def _kb_field(slug: str, name: str, default: Any) -> Any:
    try:
        page = kb.get_page(slug)
    except Exception:
        page = None
    if not page:
        return default
    for f in page.get("fields") or []:
        if f.get("name") == name and "value" in f:
            return f["value"]
    return default


def grace_window_for(end_reason: str) -> int:
    """Return grace days from the Enterprise-Seat-End KB page."""
    mapping = {
        "voluntary_leave": "grace_days_voluntary_leave",
        "removed_by_admin": "grace_days_removed_by_admin",
        "community_downgraded": "grace_days_community_downgrade",
        "community_deleted": "grace_days_community_downgrade",
        "community_suspended": "grace_days_community_downgrade",
        "admin_override": "grace_days_admin_override",
    }
    field = mapping.get(end_reason, "grace_days_voluntary_leave")
    try:
        return int(_kb_field("enterprise-seat-end", field, 0) or 0)
    except Exception:
        return 0


def iap_grace_days() -> int:
    """Days we let a mobile IAP Premium user enjoy Enterprise before nagging hard."""
    try:
        return int(_kb_field("enterprise-seat-join", "iap_grace_days", 7) or 7)
    except Exception:
        return 7


def iap_nag_stop_after_days() -> int:
    try:
        return int(_kb_field("enterprise-seat-join", "iap_nag_stop_after_days", 14) or 14)
    except Exception:
        return 14


def winback_first_month_price_eur() -> float:
    try:
        return float(_kb_field("enterprise-seat-end", "winback_first_month_price_eur", 3.99) or 3.99)
    except Exception:
        return 3.99


def winback_then_price_eur() -> float:
    try:
        return float(_kb_field("enterprise-seat-end", "winback_then_price_eur", 7.99) or 7.99)
    except Exception:
        return 7.99


def winback_window_days() -> int:
    try:
        return int(_kb_field("enterprise-seat-end", "winback_window_days", 14) or 14)
    except Exception:
        return 14


# ---------------------------------------------------------------------------
# Community lookups
# ---------------------------------------------------------------------------

def _community_info(community_id: int) -> Optional[Dict[str, Any]]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT id, name, tier FROM communities WHERE id = {ph}",
                (int(community_id),),
            )
            row = c.fetchone()
        except Exception:
            try:
                c.execute(
                    f"SELECT id, name FROM communities WHERE id = {ph}",
                    (int(community_id),),
                )
                row = c.fetchone()
            except Exception:
                return None
    if not row:
        return None
    name = row["name"] if hasattr(row, "keys") else row[1]
    tier = None
    try:
        tier = row["tier"] if hasattr(row, "keys") else (row[2] if len(row) > 2 else None)
    except Exception:
        tier = None
    return {"id": int(row["id"] if hasattr(row, "keys") else row[0]),
            "name": str(name or ""),
            "slug": _slugify(name),
            "tier": (tier or "free")}


def _slugify(name: Optional[str]) -> str:
    if not name:
        return ""
    import re
    s = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip().lower())
    return s.strip("-")


def is_enterprise_community(community_id: int) -> bool:
    # Guarantee the ``communities.tier`` column exists so a fresh DB doesn't
    # silently return False for what should be an Enterprise community.
    try:
        ensure_tables()
    except Exception:
        pass
    info = _community_info(community_id)
    return bool(info and (info.get("tier") or "").lower() == "enterprise")


# ---------------------------------------------------------------------------
# Seat lifecycle
# ---------------------------------------------------------------------------

def active_seat_for(username: str) -> Optional[Dict[str, Any]]:
    """Return the newest non-ended seat row (or a seat still in its grace window).

    The entitlements resolver uses this to decide whether the user currently
    gets Premium-via-Enterprise or just has a personal plan.
    """
    if not username:
        return None
    ensure_tables()
    ph = get_sql_placeholder()
    now_str = _utc_now_str()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT id, username, community_id, community_slug, started_at,
                       ended_at, end_reason, grace_until, had_personal_premium_at_join,
                       return_intent, created_at
                FROM user_enterprise_seats
                WHERE username = {ph}
                  AND (ended_at IS NULL OR (grace_until IS NOT NULL AND grace_until > {ph}))
                ORDER BY COALESCE(grace_until, ended_at, created_at) DESC, id DESC
                LIMIT 1
                """,
                (username, now_str),
            )
            row = c.fetchone()
        except Exception:
            return None
    if not row:
        return None
    def g(key, idx):
        return row[key] if hasattr(row, "keys") else row[idx]
    return {
        "id": g("id", 0),
        "username": g("username", 1),
        "community_id": g("community_id", 2),
        "community_slug": g("community_slug", 3),
        "started_at": str(g("started_at", 4)) if g("started_at", 4) else None,
        "ended_at": str(g("ended_at", 5)) if g("ended_at", 5) else None,
        "end_reason": g("end_reason", 6),
        "grace_until": str(g("grace_until", 7)) if g("grace_until", 7) else None,
        "had_personal_premium_at_join": bool(int(g("had_personal_premium_at_join", 8) or 0)),
        "return_intent": bool(int(g("return_intent", 9) or 0)),
        "active": g("ended_at", 5) is None,
    }


def list_active_seats() -> List[Dict[str, Any]]:
    """All currently-active seats (ended_at IS NULL). Used by the admin UI."""
    ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                """
                SELECT id, username, community_id, community_slug, started_at, created_at
                FROM user_enterprise_seats
                WHERE ended_at IS NULL
                ORDER BY started_at DESC, id DESC
                """
            )
            rows = c.fetchall() or []
        except Exception:
            rows = []
    out: List[Dict[str, Any]] = []
    for r in rows:
        def g(key, idx):
            return r[key] if hasattr(r, "keys") else r[idx]
        out.append({
            "id": g("id", 0),
            "username": g("username", 1),
            "community_id": g("community_id", 2),
            "community_slug": g("community_slug", 3),
            "started_at": str(g("started_at", 4)) if g("started_at", 4) else None,
        })
    return out


def start_seat(
    *,
    username: str,
    community_id: int,
    source: str = "community_join",
    actor_username: Optional[str] = None,
) -> Dict[str, Any]:
    """Create (or re-open) an Enterprise seat for ``username`` in ``community_id``.

    Idempotent: if an active seat already exists for this (user, community),
    we return it unchanged rather than inserting a duplicate row.

    Raises :class:`ValueError` if the community isn't Enterprise-tier.
    """
    ensure_tables()
    info = _community_info(community_id)
    if not info:
        raise ValueError(f"Community {community_id} not found")
    if (info.get("tier") or "").lower() != "enterprise":
        raise ValueError(
            f"Community {community_id} is not Enterprise tier "
            f"(got '{info.get('tier')}')"
        )

    existing = active_seat_for(username)
    if existing and existing.get("community_id") == int(community_id) and existing.get("active"):
        return existing

    # Detect whether the user had personal Premium at the moment of join so
    # the end-flow can check return_intent later.
    had_premium = _user_has_personal_premium(username)

    ph = get_sql_placeholder()
    started_at = _utc_now_str()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO user_enterprise_seats
                (username, community_id, community_slug, started_at,
                 had_personal_premium_at_join, created_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (
                username,
                int(community_id),
                info.get("slug") or None,
                started_at,
                1 if had_premium else 0,
                started_at,
            ),
        )
        try:
            conn.commit()
        except Exception:
            pass

    subscription_audit.log(
        username=username,
        action="enterprise_seat_joined",
        source=source,
        community_id=int(community_id),
        community_slug=info.get("slug"),
        actor_username=actor_username,
        metadata={"had_personal_premium": had_premium,
                  "community_name": info.get("name")},
        effective_at=started_at,
    )

    return {
        "username": username,
        "community_id": int(community_id),
        "community_slug": info.get("slug"),
        "started_at": started_at,
        "active": True,
        "had_personal_premium_at_join": had_premium,
    }


def end_seat(
    *,
    username: str,
    community_id: int,
    end_reason: str,
    source: str = "community_leave",
    actor_username: Optional[str] = None,
    reason_note: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Close the active seat for (user, community) and start the grace window.

    ``end_reason`` must be one of :data:`SEAT_END_REASONS`. Grace window days
    come from the Enterprise-Seat-End KB page — edits there take effect the
    next time this function runs.

    Returns the updated seat summary, or ``None`` if no active seat was
    found (idempotent: calling twice is safe).
    """
    ensure_tables()
    if end_reason not in SEAT_END_REASONS:
        raise ValueError(f"Invalid end_reason '{end_reason}'")

    ph = get_sql_placeholder()
    now = _utc_now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    grace_days = grace_window_for(end_reason)
    grace_until = (now + timedelta(days=grace_days)).strftime("%Y-%m-%d %H:%M:%S") if grace_days > 0 else now_str

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, community_slug, had_personal_premium_at_join
            FROM user_enterprise_seats
            WHERE username = {ph} AND community_id = {ph} AND ended_at IS NULL
            ORDER BY id DESC LIMIT 1
            """,
            (username, int(community_id)),
        )
        row = c.fetchone()
        if not row:
            logger.info(
                "end_seat: no active seat for %s in community %s (idempotent noop)",
                username, community_id,
            )
            return None
        def g(key, idx):
            return row[key] if hasattr(row, "keys") else row[idx]
        seat_id = int(g("id", 0))
        community_slug = g("community_slug", 1)
        had_premium = bool(int(g("had_personal_premium_at_join", 2) or 0))

        # Return-intent is set if they had personal Premium at join and
        # cancelled it specifically to join the Enterprise community.
        # Wave 5 stores the return_intent flag at join time via a dedicated
        # confirmation flow; for now we approximate: if they had Premium at
        # join and no longer have it, mark return_intent=1 so winback is
        # eligible.
        return_intent = 1 if (had_premium and not _user_has_personal_premium(username)) else 0

        c.execute(
            f"""
            UPDATE user_enterprise_seats SET
                ended_at = {ph},
                end_reason = {ph},
                grace_until = {ph},
                return_intent = {ph}
            WHERE id = {ph}
            """,
            (now_str, end_reason, grace_until, return_intent, seat_id),
        )
        try:
            conn.commit()
        except Exception:
            pass

    subscription_audit.log(
        username=username,
        action=_action_for_end_reason(end_reason),
        source=source,
        community_id=int(community_id),
        community_slug=community_slug,
        actor_username=actor_username,
        reason=reason_note,
        metadata={"end_reason": end_reason,
                  "grace_days": grace_days,
                  "grace_until": grace_until,
                  "return_intent": bool(return_intent)},
        effective_at=now_str,
    )
    if grace_days > 0:
        subscription_audit.log(
            username=username,
            action="enterprise_seat_grace_started",
            source=source,
            community_id=int(community_id),
            community_slug=community_slug,
            metadata={"grace_until": grace_until, "grace_days": grace_days},
            effective_at=now_str,
        )
    if return_intent:
        subscription_audit.log(
            username=username,
            action="winback_eligible",
            source=source,
            community_id=int(community_id),
            metadata={"window_days": winback_window_days(),
                      "first_month_eur": winback_first_month_price_eur(),
                      "then_eur": winback_then_price_eur()},
            effective_at=now_str,
        )

    return {
        "username": username,
        "community_id": int(community_id),
        "ended_at": now_str,
        "end_reason": end_reason,
        "grace_until": grace_until,
        "grace_days": grace_days,
        "return_intent": bool(return_intent),
    }


def _action_for_end_reason(end_reason: str) -> str:
    return {
        "voluntary_leave": "enterprise_seat_left",
        "removed_by_admin": "enterprise_seat_removed_by_admin",
        "community_downgraded": "enterprise_seat_community_downgraded",
        "community_deleted": "enterprise_seat_community_downgraded",
        "community_suspended": "enterprise_seat_community_downgraded",
        "admin_override": "admin_seat_end_override",
    }[end_reason]


def _user_has_personal_premium(username: str) -> bool:
    """Read-through to ``users.subscription``. Cheap, no API calls."""
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT subscription FROM users WHERE username = {ph}",
                (username,),
            )
            row = c.fetchone()
        except Exception:
            return False
    if not row:
        return False
    sub = (row["subscription"] if hasattr(row, "keys") else row[0]) or ""
    return str(sub).lower() in ("premium", "pro", "paid")


# ---------------------------------------------------------------------------
# Grace-window sweeper (called by cron in Wave 6)
# ---------------------------------------------------------------------------

def sweep_expired_grace_windows(now: Optional[datetime] = None) -> Dict[str, Any]:
    """Log ``enterprise_seat_grace_expired`` for every seat whose grace elapsed.

    Doesn't revoke anything itself — the entitlements resolver reads
    ``grace_until`` live, so once the timestamp is in the past the user is
    automatically downgraded. This function only emits audit rows so the
    admin UI/analytics have a clean event.
    """
    ensure_tables()
    ts = (now or _utc_now()).strftime("%Y-%m-%d %H:%M:%S")
    ph = get_sql_placeholder()
    logged: List[Dict[str, Any]] = []
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT id, username, community_id, community_slug, end_reason,
                       grace_until
                FROM user_enterprise_seats
                WHERE ended_at IS NOT NULL
                  AND grace_until IS NOT NULL
                  AND grace_until <= {ph}
                """,
                (ts,),
            )
            rows = c.fetchall() or []
        except Exception:
            return {"expired": [], "error": True}

        for r in rows:
            def g(key, idx):
                return r[key] if hasattr(r, "keys") else r[idx]
            seat_id = int(g("id", 0))
            # Idempotency: only log once per seat. We piggy-back on the audit
            # log existing check to avoid a second "grace_expired" row.
            try:
                c.execute(
                    f"""
                    SELECT 1 FROM subscription_audit_log
                    WHERE username = {ph} AND action = {ph}
                      AND metadata_json LIKE {ph}
                    LIMIT 1
                    """,
                    (g("username", 1), "enterprise_seat_grace_expired",
                     f'%"seat_id": {seat_id}%'),
                )
                if c.fetchone():
                    continue
            except Exception:
                pass

            info = {
                "seat_id": seat_id,
                "end_reason": g("end_reason", 4),
                "grace_until": str(g("grace_until", 5)) if g("grace_until", 5) else None,
            }
            subscription_audit.log(
                username=g("username", 1),
                action="enterprise_seat_grace_expired",
                source="cron",
                community_id=g("community_id", 2),
                community_slug=g("community_slug", 3),
                metadata=info,
                effective_at=ts,
            )
            logged.append({"username": g("username", 1), **info})
    return {"expired": logged, "count": len(logged)}
