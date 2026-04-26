"""Admin subscription reporting endpoints.

This blueprint owns paid User/Community reporting for admin-web. It keeps
reporting and diagnostics out of ``bodybuilding_app.py`` and reads from the
same billing state persisted by Stripe webhooks.
"""

from __future__ import annotations

import logging
from functools import wraps
from typing import Any, Dict, List

from flask import Blueprint, jsonify, session

from backend.services import ai_usage, subscription_billing_ledger
from backend.services.community import is_app_admin
from backend.services.database import get_db_connection
from . import subscriptions as pricing_api


admin_subscriptions_bp = Blueprint("admin_subscriptions", __name__)
logger = logging.getLogger(__name__)


def _admin_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        username = session.get("username")
        if not username:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        if not is_app_admin(str(username)):
            return jsonify({"success": False, "error": "Admin access required"}), 403
        return view_func(*args, **kwargs)
    return wrapper


@admin_subscriptions_bp.route("/api/admin/subscriptions/users", methods=["GET"])
@_admin_required
def api_admin_subscription_users():
    rows = _query_users()
    premium_value_cents = _premium_value_cents()
    data: List[Dict[str, Any]] = []
    for row in rows:
        username = str(_value(row, "username", 0) or "")
        subscription = _value(row, "subscription", 2) or "free"
        is_special = bool(_value(row, "is_special", 9))
        totals = subscription_billing_ledger.totals_for_user(username)
        billing_kind = _billing_kind(row, is_special)
        try:
            steve_used = ai_usage.monthly_steve_count(username)
            whisper_used = round(float(ai_usage.whisper_minutes_this_month(username) or 0), 2)
        except Exception:
            logger.exception("admin subscriptions usage failed for %s", username)
            steve_used = 0
            whisper_used = 0.0
        data.append({
            "username": username,
            "email": _value(row, "email", 1) or "",
            "subscription": subscription,
            "subscription_status": _value(row, "subscription_status", 3),
            "stripe_customer_id": _value(row, "stripe_customer_id", 4),
            "stripe_subscription_id": _value(row, "stripe_subscription_id", 5),
            "current_period_end": _string_or_none(_value(row, "current_period_end", 6)),
            "cancel_at_period_end": bool(_value(row, "cancel_at_period_end", 7)),
            "canceled_at": _string_or_none(_value(row, "canceled_at", 8)),
            "is_special": is_special,
            "billing_kind": billing_kind,
            "current_subscription_value_cents": premium_value_cents if _has_premium_entitlement(subscription, is_special) else 0,
            "spent_total_cents": totals["spent_total_cents"],
            "spent_ytd_cents": totals["spent_ytd_cents"],
            "steve_used_month": steve_used,
            "whisper_minutes_month": whisper_used,
        })
    return jsonify({"success": True, "users": data})


@admin_subscriptions_bp.route("/api/admin/subscriptions/communities", methods=["GET"])
@_admin_required
def api_admin_subscription_communities():
    rows = _query_communities()
    data = []
    for row in rows:
        community_id = int(_value(row, "id", 0) or 0)
        tier = _value(row, "tier", 3) or "free"
        totals = subscription_billing_ledger.totals_for_community(community_id)
        data.append({
            "id": community_id,
            "name": _value(row, "name", 1) or "",
            "owner": _value(row, "creator_username", 2) or "",
            "tier": tier,
            "member_count": int(_value(row, "member_count", 4) or 0),
            "subscription_status": _value(row, "subscription_status", 5),
            "stripe_customer_id": _value(row, "stripe_customer_id", 6),
            "stripe_subscription_id": _value(row, "stripe_subscription_id", 7),
            "current_period_end": _string_or_none(_value(row, "current_period_end", 8)),
            "cancel_at_period_end": bool(_value(row, "cancel_at_period_end", 9)),
            "canceled_at": _string_or_none(_value(row, "canceled_at", 10)),
            "current_subscription_value_cents": _community_value_cents(str(tier)),
            "spent_total_cents": totals["spent_total_cents"],
            "spent_ytd_cents": totals["spent_ytd_cents"],
        })
    return jsonify({"success": True, "communities": data})


@admin_subscriptions_bp.route("/api/admin/subscriptions/pricing_diagnostics", methods=["GET"])
@_admin_required
def api_admin_subscription_pricing_diagnostics():
    mode = pricing_api._stripe_mode()
    checks = [
        ("User Premium Membership", "user-tiers", "premium_stripe_price_id"),
        ("Community L1", "community-tiers", "paid_l1_stripe_price_id"),
        ("Community L2", "community-tiers", "paid_l2_stripe_price_id"),
        ("Community L3", "community-tiers", "paid_l3_stripe_price_id"),
        ("Steve Community Package", "community-tiers", "paid_steve_package_stripe_price_id"),
        ("Networking Package", "networking-page", "networking_page_stripe_price_id"),
    ]
    results = []
    missing = []
    for label, slug, base_field in checks:
        field_name = f"{base_field}_{mode}"
        value = pricing_api._price_id_from_kb(slug, base_field)
        item = {
            "label": label,
            "slug": slug,
            "field": field_name,
            "present": bool(value),
            "price_id": value,
        }
        results.append(item)
        if not value:
            missing.append(item)
    return jsonify({
        "success": True,
        "stripe_mode": mode,
        "diagnostics": results,
        "missing": missing,
    })


def _query_users():
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                """
                SELECT username, email, subscription, subscription_status,
                       stripe_customer_id, stripe_subscription_id,
                       current_period_end, cancel_at_period_end, canceled_at,
                       COALESCE(is_special, 0) AS is_special
                FROM users
                WHERE LOWER(COALESCE(subscription, '')) IN ('premium', 'special')
                   OR COALESCE(is_special, 0) = 1
                   OR COALESCE(stripe_subscription_id, '') <> ''
                   OR COALESCE(subscription_status, '') <> ''
                ORDER BY current_period_end DESC, username ASC
                """
            )
            return c.fetchall() or []
        except Exception:
            logger.exception("admin subscription user query failed")
            return []


def _query_communities():
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                """
                SELECT c.id, c.name, c.creator_username, c.tier,
                       COUNT(uc.user_id) AS member_count,
                       c.subscription_status, c.stripe_customer_id,
                       c.stripe_subscription_id, c.current_period_end,
                       c.cancel_at_period_end, c.canceled_at
                FROM communities c
                LEFT JOIN user_communities uc ON uc.community_id = c.id
                WHERE LOWER(COALESCE(c.tier, 'free')) <> 'free'
                   OR COALESCE(c.stripe_subscription_id, '') <> ''
                   OR COALESCE(c.subscription_status, '') <> ''
                GROUP BY c.id, c.name, c.creator_username, c.tier,
                         c.subscription_status, c.stripe_customer_id,
                         c.stripe_subscription_id, c.current_period_end,
                         c.cancel_at_period_end, c.canceled_at
                ORDER BY c.current_period_end DESC, c.name ASC
                """
            )
            return c.fetchall() or []
        except Exception:
            logger.exception("admin subscription community query failed")
            return []


def _value(row: Any, key: str, idx: int) -> Any:
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key)
    if isinstance(row, (list, tuple)) and len(row) > idx:
        return row[idx]
    return None


def _string_or_none(value: Any) -> str | None:
    return str(value) if value else None


def _premium_value_cents() -> int:
    fields = pricing_api._kb_field_map("user-tiers")
    value = fields.get("premium_price_early_eur")
    if value in (None, "", 0):
        value = fields.get("premium_price_standard_eur")
    return _eur_to_cents(value)


def _community_value_cents(tier: str) -> int:
    fields = pricing_api._kb_field_map("community-tiers")
    value = fields.get(f"{tier}_price_eur_monthly")
    return _eur_to_cents(value)


def _eur_to_cents(value: Any) -> int:
    try:
        return int(round(float(str(value).replace(",", ".")) * 100))
    except Exception:
        return 0


def _billing_kind(row: Any, is_special: bool) -> str:
    if _value(row, "stripe_subscription_id", 5) or _value(row, "stripe_customer_id", 4):
        return "stripe"
    if is_special:
        return "special"
    if _has_premium_entitlement(str(_value(row, "subscription", 2) or ""), False):
        return "manual"
    return "free"


def _has_premium_entitlement(subscription: str, is_special: bool) -> bool:
    return is_special or str(subscription or "").lower() in {"premium", "special", "pro", "paid"}
