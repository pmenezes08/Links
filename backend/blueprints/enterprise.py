"""
Enterprise seat management endpoints.

User-facing:
    GET    /api/me/enterprise-seats           — my active/grace seats
    GET    /api/me/iap-nag                    — pending nag banners
    POST   /api/me/iap-nag/ack                — "I've cancelled my IAP sub"
    GET    /api/me/winback                    — offer details if eligible
    POST   /api/me/winback/redeem             — consume a token

Community hooks (called from existing join/leave flows in the monolith):
    POST   /api/communities/<id>/enterprise/seat/start
    POST   /api/communities/<id>/enterprise/seat/end

Admin:
    GET    /api/admin/enterprise/seats
    POST   /api/admin/enterprise/seats/override-end
    POST   /api/admin/enterprise/communities/<id>/tier

The community hooks are designed to be called *idempotently* from the
monolith's existing ``user_communities`` insert/delete paths — Wave 5
exposes them so we can wire them later without another deploy.
"""

from __future__ import annotations

import logging
from functools import wraps
from typing import Any, Dict

from flask import Blueprint, jsonify, request, session

import os

from backend.services import (
    auth_session,
    enterprise_iap_nag,
    enterprise_membership,
    subscription_audit,
    winback_promo,
)
from backend.services.content_generation.permissions import is_app_admin
from backend.services.database import get_db_connection, get_sql_placeholder


enterprise_bp = Blueprint("enterprise", __name__)
logger = logging.getLogger(__name__)


@enterprise_bp.after_request
def _no_store_user_scoped_responses(response):
    return auth_session.no_store(response)


def _session_username() -> str | None:
    uname = session.get("username")
    return str(uname) if uname else None


def _login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not _session_username():
            return jsonify({"success": False, "error": "Authentication required"}), 401
        return view(*args, **kwargs)
    return wrapper


def _admin_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        uname = _session_username()
        if not uname:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        if not is_app_admin(uname):
            return jsonify({"success": False, "error": "Admin access required"}), 403
        return view(*args, **kwargs)
    return wrapper


def _body() -> Dict[str, Any]:
    return request.get_json(silent=True) or {}


# ---------------------------------------------------------------------------
# User-facing
# ---------------------------------------------------------------------------

@enterprise_bp.route("/api/me/enterprise-seats", methods=["GET"])
@_login_required
def me_seats():
    username = _session_username()
    seat = enterprise_membership.active_seat_for(username)
    return jsonify({"success": True, "active_seat": seat})


@enterprise_bp.route("/api/me/iap-nag", methods=["GET"])
@_login_required
def me_iap_nag():
    username = _session_username()
    items = enterprise_iap_nag.pending_for_user(username)
    # Only show the banner if the user is genuinely in a conflict state
    # (i.e. actually flagged premium AND holds a seat). Stale rows for
    # users who've cancelled in the meantime are filtered here to keep the
    # UI clean without waiting for the daily cron to mark them acknowledged.
    seat = enterprise_membership.active_seat_for(username)
    show_banners = []
    if seat and seat.get("active"):
        for it in items:
            if int(it.get("community_id") or 0) == int(seat.get("community_id") or 0):
                show_banners.append(it)
    return jsonify({"success": True, "items": show_banners, "raw": items})


@enterprise_bp.route("/api/me/iap-nag/ack", methods=["POST"])
@_login_required
def me_iap_nag_ack():
    username = _session_username()
    body = _body()
    community_id = body.get("community_id")
    try:
        cid = int(community_id) if community_id is not None else None
    except Exception:
        cid = None
    rows = enterprise_iap_nag.acknowledge(username=username, community_id=cid, actor=username)
    return jsonify({"success": True, "rows_updated": rows})


@enterprise_bp.route("/api/me/winback", methods=["GET"])
@_login_required
def me_winback():
    username = _session_username()
    offer = winback_promo.issue_if_eligible(username)
    return jsonify({"success": True, "offer": offer})


@enterprise_bp.route("/api/me/winback/redeem", methods=["POST"])
@_login_required
def me_winback_redeem():
    username = _session_username()
    token = (_body().get("token") or "").strip()
    if not token:
        return jsonify({"success": False, "error": "Token required"}), 400
    try:
        result = winback_promo.redeem(token, username=username)
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 410
    return jsonify(result)


# ---------------------------------------------------------------------------
# Community hooks — called by existing join/leave flows in the monolith.
#
# These are idempotent; the monolith can invoke them unconditionally on any
# community join/leave and they'll no-op for non-Enterprise tiers.
# ---------------------------------------------------------------------------

@enterprise_bp.route("/api/communities/<int:community_id>/enterprise/seat/start", methods=["POST"])
@_login_required
def start_seat(community_id: int):
    username = _session_username()
    body = _body()
    target = (body.get("username") or username).strip()
    # Only admins can start a seat on behalf of someone else.
    if target != username and not is_app_admin(username):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    try:
        seat = enterprise_membership.start_seat(
            username=target,
            community_id=int(community_id),
            source=body.get("source") or "community_join",
            actor_username=username,
        )
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        logger.exception("start_seat failed")
        return jsonify({"success": False, "error": str(e)}), 500

    # If the user is holding a personal IAP Premium sub, open a nag record
    # so the client starts showing the banner after the grace window.
    try:
        if _user_is_premium_iap(target):
            enterprise_iap_nag.start_nag(username=target, community_id=int(community_id))
            subscription_audit.log(
                username=target,
                action="iap_conflict_detected",
                source="community_join",
                community_id=int(community_id),
                metadata={"reason": "premium_iap_plus_enterprise_seat"},
            )
    except Exception:
        logger.exception("start_seat: iap nag bootstrap failed (non-fatal)")

    return jsonify({"success": True, "seat": seat})


@enterprise_bp.route("/api/communities/<int:community_id>/enterprise/seat/end", methods=["POST"])
@_login_required
def end_seat(community_id: int):
    username = _session_username()
    body = _body()
    target = (body.get("username") or username).strip()
    if target != username and not is_app_admin(username):
        return jsonify({"success": False, "error": "Forbidden"}), 403
    end_reason = str(body.get("end_reason") or "voluntary_leave")
    try:
        result = enterprise_membership.end_seat(
            username=target,
            community_id=int(community_id),
            end_reason=end_reason,
            source=body.get("source") or "community_leave",
            actor_username=username,
            reason_note=body.get("reason"),
        )
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        logger.exception("end_seat failed")
        return jsonify({"success": False, "error": str(e)}), 500
    # Stop any outstanding nag rows — the conflict is gone.
    try:
        enterprise_iap_nag.acknowledge(username=target, community_id=int(community_id), actor=username)
    except Exception:
        pass
    # Offer winback if eligible.
    offer = None
    try:
        offer = winback_promo.issue_if_eligible(target, source="seat_end")
    except Exception:
        logger.exception("end_seat: winback offer failed (non-fatal)")
    return jsonify({"success": True, "seat": result, "winback_offer": offer})


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

@enterprise_bp.route("/api/admin/enterprise/seats", methods=["GET"])
@_admin_required
def admin_list_seats():
    seats = enterprise_membership.list_active_seats()
    return jsonify({"success": True, "seats": seats})


@enterprise_bp.route("/api/admin/enterprise/seats/override-end", methods=["POST"])
@_admin_required
def admin_override_end():
    body = _body()
    target = (body.get("username") or "").strip()
    community_id = body.get("community_id")
    reason = (body.get("reason") or "").strip()
    if not target or not community_id:
        return jsonify({"success": False, "error": "username and community_id required"}), 400
    if not reason:
        return jsonify({"success": False, "error": "Reason required"}), 400
    try:
        result = enterprise_membership.end_seat(
            username=target,
            community_id=int(community_id),
            end_reason="admin_override",
            source="admin",
            actor_username=_session_username(),
            reason_note=reason,
        )
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    return jsonify({"success": True, "seat": result})


@enterprise_bp.route("/api/admin/enterprise/communities/<int:community_id>/tier", methods=["POST"])
@_admin_required
def admin_set_community_tier(community_id: int):
    """Change a community's tier.

    When moving *out* of Enterprise, we emit ``enterprise_seat_community_downgraded``
    end_seat for every member so the grace window + winback flow kicks in.
    """
    body = _body()
    new_tier = str(body.get("tier") or "").strip().lower()
    if new_tier not in ("free", "paid", "enterprise"):
        return jsonify({"success": False, "error": "Invalid tier"}), 400
    reason = (body.get("reason") or "").strip()

    enterprise_membership.ensure_tables()
    ph = get_sql_placeholder()
    members: list[str] = []
    with get_db_connection() as conn:
        c = conn.cursor()
        # Current tier.
        try:
            c.execute(
                f"SELECT tier FROM communities WHERE id = {ph}",
                (int(community_id),),
            )
            row = c.fetchone()
        except Exception:
            row = None
        current = (row["tier"] if hasattr(row, "keys") else (row[0] if row else "free")) if row else "free"
        current = (current or "free").lower()
        # Set new tier.
        c.execute(
            f"UPDATE communities SET tier = {ph} WHERE id = {ph}",
            (new_tier, int(community_id)),
        )
        # Gather members if we're downgrading out of Enterprise.
        if current == "enterprise" and new_tier != "enterprise":
            try:
                c.execute(
                    f"""
                    SELECT u.username FROM user_communities uc
                    JOIN users u ON u.id = uc.user_id
                    WHERE uc.community_id = {ph}
                    """,
                    (int(community_id),),
                )
                members = [r["username"] if hasattr(r, "keys") else r[0] for r in (c.fetchall() or [])]
            except Exception:
                members = []
        try:
            conn.commit()
        except Exception:
            pass

    # Close seats for all members (best-effort, per-user).
    closed = []
    for uname in members:
        try:
            res = enterprise_membership.end_seat(
                username=uname,
                community_id=int(community_id),
                end_reason="community_downgraded",
                source="admin",
                actor_username=_session_username(),
                reason_note=reason or None,
            )
            if res:
                closed.append(uname)
        except Exception:
            logger.exception("tier change: end_seat failed for %s", uname)

    return jsonify({
        "success": True,
        "community_id": int(community_id),
        "previous_tier": current,
        "new_tier": new_tier,
        "seats_closed": closed,
    })


@enterprise_bp.route("/api/admin/subscription-audit", methods=["GET"])
@_admin_required
def admin_subscription_audit():
    """Recent audit rows (admin UI Lifecycle tab).

    Query params:
      * ``limit`` (int, default 100, max 500)
      * ``username`` (optional) — filter to one user
      * ``action`` (optional) — filter to a single action string
    """
    try:
        limit = min(int(request.args.get("limit", 100)), 500)
    except Exception:
        limit = 100
    username_filter = (request.args.get("username") or "").strip() or None
    action_filter = (request.args.get("action") or "").strip() or None
    if username_filter:
        rows = subscription_audit.list_for_user(username_filter, limit=limit)
    else:
        rows = subscription_audit.list_recent(limit=limit)
    if action_filter:
        rows = [r for r in rows if r.get("action") == action_filter]
    return jsonify({"success": True, "rows": rows, "count": len(rows)})


@enterprise_bp.route("/api/admin/winback/analytics", methods=["GET"])
@_admin_required
def admin_winback_analytics():
    """Counts + conversion for the winback promo programme.

    Pulls straight from ``winback_tokens`` + ``subscription_audit_log``:
        * issued         — tokens created (all time or last ``days``)
        * sent           — pushed/emailed successfully
        * redeemed       — users who actually came back on Premium
        * expired        — tokens swept unused
        * conversion_pct — redeemed / (sent + redeemed + expired)
    """
    try:
        days = int(request.args.get("days", 90))
    except Exception:
        days = 90

    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(days, 1))).strftime("%Y-%m-%d %H:%M:%S")

    ph = get_sql_placeholder()
    counts: Dict[str, int] = {"issued": 0, "sent": 0, "redeemed": 0, "expired": 0, "pending": 0}
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT status, COUNT(*) AS n
                FROM winback_tokens
                WHERE created_at >= {ph}
                GROUP BY status
                """,
                (cutoff,),
            )
            rows = c.fetchall() or []
            for r in rows:
                status = r["status"] if hasattr(r, "keys") else r[0]
                n = r["n"] if hasattr(r, "keys") else r[1]
                counts[status] = int(n or 0)
            try:
                c.execute(f"SELECT COUNT(*) AS n FROM winback_tokens WHERE created_at >= {ph}", (cutoff,))
                r = c.fetchone()
                counts["issued"] = int((r["n"] if hasattr(r, "keys") else r[0]) or 0)
            except Exception:
                counts["issued"] = sum(counts.get(k, 0) for k in ("sent", "redeemed", "expired", "pending"))
        except Exception:
            pass

    redeemed = counts.get("redeemed", 0)
    exposed = counts.get("sent", 0) + redeemed + counts.get("expired", 0)
    conv = (redeemed / exposed * 100.0) if exposed else 0.0

    return jsonify({
        "success": True,
        "window_days": days,
        "cutoff": cutoff,
        "counts": counts,
        "conversion_pct": round(conv, 2),
    })


# ---------------------------------------------------------------------------
# Cron endpoints (Wave 6 will wire these up from Cloud Scheduler).
# Auth is via shared ``X-Cron-Secret`` header, not session — scheduler runs
# without a browser context.
# ---------------------------------------------------------------------------

def _cron_authed() -> bool:
    expected = os.environ.get("CRON_SHARED_SECRET") or ""
    if not expected:
        return False
    provided = request.headers.get("X-Cron-Secret") or ""
    return bool(expected) and provided == expected


@enterprise_bp.route("/api/cron/enterprise/grace-sweep", methods=["POST"])
def cron_grace_sweep():
    if not _cron_authed():
        return jsonify({"success": False, "error": "forbidden"}), 403
    result = enterprise_membership.sweep_expired_grace_windows()
    return jsonify({"success": True, **(result or {})})


@enterprise_bp.route("/api/cron/enterprise/nag-dispatch", methods=["POST"])
def cron_nag_dispatch():
    if not _cron_authed():
        return jsonify({"success": False, "error": "forbidden"}), 403
    result = enterprise_iap_nag.dispatch_due()
    return jsonify({"success": True, **(result or {})})


@enterprise_bp.route("/api/cron/enterprise/winback-expire", methods=["POST"])
def cron_winback_expire():
    if not _cron_authed():
        return jsonify({"success": False, "error": "forbidden"}), 403
    result = winback_promo.sweep_expired()
    return jsonify({"success": True, **(result or {})})


@enterprise_bp.route("/api/cron/subscriptions/revoke-expired", methods=["POST"])
def cron_revoke_expired_subscriptions():
    """Revoke personal Premium rows that haven't been reaffirmed by a webhook
    within the store's expected renewal window.

    Defensive sweep for IAP subs where the RTDN / ASSN2 push got lost — we
    check ``subscription_audit_log`` for the most recent
    ``personal_premium_renewed`` / ``personal_premium_purchased`` timestamp
    and, if older than 35 days for monthly plans, flip the user to Free and
    log ``personal_premium_expired``. Stripe subs are left alone because
    Stripe will always emit ``customer.subscription.deleted``.
    """
    if not _cron_authed():
        return jsonify({"success": False, "error": "forbidden"}), 403

    from datetime import datetime, timedelta, timezone
    ph = get_sql_placeholder()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=35)).strftime("%Y-%m-%d %H:%M:%S")

    revoked: list[str] = []
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            # Candidates: Premium-ish users we believe are on IAP.
            c.execute(
                """
                SELECT username FROM users
                WHERE LOWER(COALESCE(subscription, '')) IN ('premium', 'pro', 'paid')
                  AND (subscription_provider IS NULL OR LOWER(subscription_provider) != 'stripe')
                """
            )
            candidates = [
                (r["username"] if hasattr(r, "keys") else r[0])
                for r in (c.fetchall() or [])
            ]
        except Exception:
            candidates = []

        for uname in candidates:
            try:
                c.execute(
                    f"""
                    SELECT MAX(created_at) AS last_seen
                    FROM subscription_audit_log
                    WHERE username = {ph}
                      AND action IN ('personal_premium_renewed', 'personal_premium_purchased')
                    """,
                    (uname,),
                )
                row = c.fetchone()
                last_seen = row["last_seen"] if row and hasattr(row, "keys") else (row[0] if row else None)
            except Exception:
                last_seen = None

            last_str = str(last_seen) if last_seen else None
            if last_str and last_str > cutoff:
                continue  # recently reaffirmed, skip

            try:
                c.execute(
                    f"UPDATE users SET subscription = 'free' WHERE username = {ph}",
                    (uname,),
                )
                revoked.append(uname)
                subscription_audit.log(
                    username=uname,
                    action="personal_premium_expired",
                    source="cron",
                    reason="no_renewal_webhook_in_35_days",
                    metadata={"last_seen": last_str},
                )
            except Exception:
                logger.exception("revoke_expired: update failed for %s", uname)

        try:
            conn.commit()
        except Exception:
            pass

    return jsonify({"success": True, "revoked": revoked, "cutoff": cutoff})


@enterprise_bp.route("/api/cron/usage/cycle-notify", methods=["POST"])
def cron_usage_cycle_notify():
    """Queue 80% / 95% usage warnings for Premium users near their caps.

    Wave 6 only *identifies* the users and records an audit breadcrumb so
    the notification delivery layer (push + email) can consume the queue
    downstream. We never spam — each user gets at most one 80 pct + one
    95 pct ping per calendar month, dedup'd via the audit log.
    """
    if not _cron_authed():
        return jsonify({"success": False, "error": "forbidden"}), 403

    from backend.services import ai_usage
    from backend.services.entitlements import resolve_entitlements

    notified_80: list[str] = []
    notified_95: list[str] = []
    month_start = _first_of_current_month_utc_str()

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                """
                SELECT username FROM users
                WHERE LOWER(COALESCE(subscription, '')) IN ('premium', 'pro', 'paid')
                   OR COALESCE(is_special, 0) = 1
                """
            )
            candidates = [
                (r["username"] if hasattr(r, "keys") else r[0])
                for r in (c.fetchall() or [])
            ]
        except Exception:
            candidates = []

        for uname in candidates:
            try:
                ent = resolve_entitlements(uname)
            except Exception:
                continue
            cap = ent.get("steve_uses_per_month")
            if not cap:
                continue  # unlimited users don't get capped warnings
            try:
                used = ai_usage.monthly_steve_count(uname)
            except Exception:
                used = 0
            pct = float(used) / float(cap) if cap else 0.0
            if pct < 0.8:
                continue
            # Has this user already been notified this cycle?
            for threshold, label, bucket in (
                (0.95, "usage_cycle_warning_95", notified_95),
                (0.8, "usage_cycle_warning_80", notified_80),
            ):
                if pct < threshold:
                    continue
                try:
                    c.execute(
                        f"""
                        SELECT 1 FROM subscription_audit_log
                        WHERE username = {ph}
                          AND action = {ph}
                          AND created_at >= {ph}
                        LIMIT 1
                        """,
                        (uname, label, month_start),
                    )
                    if c.fetchone():
                        continue
                except Exception:
                    pass
                subscription_audit.log(
                    username=uname,
                    action=label,
                    source="cron",
                    metadata={"used": used, "cap": cap, "pct": round(pct, 3)},
                )
                bucket.append(uname)
                break  # 95pct implies 80pct; don't double-log

        try:
            conn.commit()
        except Exception:
            pass

    return jsonify({
        "success": True,
        "notified_80": notified_80,
        "notified_95": notified_95,
    })


def _first_of_current_month_utc_str() -> str:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _user_is_premium_iap(username: str) -> bool:
    """Approximate: is this user paying for Premium through a mobile store?

    Wave 5 tracks the authoritative provider via the Stripe/ASSN2/RTDN
    webhooks on ``users.subscription_provider``. For the MVP we
    conservatively assume non-Stripe customers are IAP.
    """
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT subscription, subscription_provider FROM users WHERE username = {ph}",
                (username,),
            )
            row = c.fetchone()
        except Exception:
            try:
                c.execute(
                    f"SELECT subscription FROM users WHERE username = {ph}",
                    (username,),
                )
                row = c.fetchone()
                if not row:
                    return False
                sub = (row["subscription"] if hasattr(row, "keys") else row[0]) or ""
                return str(sub).lower() in ("premium", "pro", "paid")
            except Exception:
                return False
    if not row:
        return False
    sub = (row["subscription"] if hasattr(row, "keys") else row[0]) or ""
    provider = None
    try:
        provider = row["subscription_provider"] if hasattr(row, "keys") else (row[1] if len(row) > 1 else None)
    except Exception:
        provider = None
    if str(sub).lower() not in ("premium", "pro", "paid"):
        return False
    # Conservative: treat anything non-stripe as IAP.
    return (provider or "").lower() != "stripe"
