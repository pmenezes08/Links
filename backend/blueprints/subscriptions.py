"""
Stripe-backed subscription endpoints.

Owns three routes:

    GET  /api/stripe/config               — publishable key for Stripe.js init
    POST /api/stripe/create_checkout_session — start a Checkout session
    GET  /api/kb/pricing                  — KB-sourced pricing payload for UI

The first two lived in ``bodybuilding_app.py`` until Step E of the
subscriptions work. They moved here so the monolith stops growing and
the whole Stripe surface lives next to the webhook blueprint
(``subscription_webhooks.py``) that fulfils the events we create.

Design rules enforced in this file:

* Stripe price IDs are sourced from the Knowledge Base (editable by
  admins via admin-web) and scoped by the ``STRIPE_API_KEY`` prefix
  (``sk_test_*`` -> ``*_test`` fields, ``sk_live_*`` -> ``*_live``).
  The env vars ``STRIPE_PRICE_PREMIUM_MONTHLY`` and
  ``STRIPE_PRICE_PREMIUM_YEARLY`` stay as a last-resort fallback for
  the User Premium plan only — Community Paid Tiers have no env-var
  path because they're brand-new this step.
* Community-tier checkouts require the caller to be the community's
  owner, the community must not already have an active Stripe
  subscription, and the target tier's member cap must fit the current
  member count. Stripe would happily take the money otherwise.
* Checkout metadata includes ``sku`` (``premium`` or ``community_tier``)
  so the webhook handler can dispatch correctly.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin

from flask import Blueprint, jsonify, request, session

from backend.services import community as community_svc
from backend.services import community_billing, enterprise_membership, knowledge_base
from backend.services.database import get_db_connection, get_sql_placeholder


subscriptions_bp = Blueprint("subscriptions", __name__)
logger = logging.getLogger(__name__)


# ── Session / Stripe helpers ────────────────────────────────────────────


def _session_username() -> Optional[str]:
    uname = session.get("username")
    return str(uname) if uname else None


_DEFAULT_STRIPE_API_KEY = "sk_test_your_stripe_key"


def _stripe_api_key() -> str:
    return (os.getenv("STRIPE_API_KEY") or _DEFAULT_STRIPE_API_KEY).strip()


def _stripe_mode() -> str:
    """Return 'test' or 'live' based on the current ``STRIPE_API_KEY``.

    Anything that isn't prefixed ``sk_live_`` is treated as test mode —
    this intentionally errs on the safe side so a misconfigured prod
    never accidentally hands out live-mode price IDs.
    """
    key = _stripe_api_key()
    return "live" if key.startswith("sk_live_") else "test"


def _stripe_publishable_key() -> str:
    return (os.getenv("STRIPE_PUBLISHABLE_KEY") or "").strip()


def _stripe_client():
    """Return the ``stripe`` module when configured, else ``None``.

    Matches the pattern used in ``backend/blueprints/me.py`` so tests
    and dev environments without Stripe keep working.
    """
    try:
        import stripe  # type: ignore
    except Exception:
        return None
    api_key = _stripe_api_key()
    if not api_key or api_key == _DEFAULT_STRIPE_API_KEY:
        return None
    stripe.api_key = api_key
    return stripe


# ── KB price lookups ────────────────────────────────────────────────────


def _kb_field_map(slug: str) -> Dict[str, Any]:
    """Return ``{field_name: value}`` for a KB page, ``{}`` on any failure."""
    try:
        page = knowledge_base.get_page(slug) or {}
    except Exception:
        logger.exception("_kb_field_map: KB read failed for %s", slug)
        return {}
    fields = page.get("fields") or []
    out: Dict[str, Any] = {}
    for f in fields:
        name = f.get("name")
        if name:
            out[str(name)] = f.get("value")
    return out


def _price_id_from_kb(slug: str, base_field: str) -> str:
    """Return the mode-appropriate Stripe price ID from a KB page field.

    ``base_field`` is the prefix of the field pair — e.g.
    ``premium_stripe_price_id`` resolves to ``premium_stripe_price_id_test``
    or ``*_live`` depending on ``_stripe_mode()``. Empty string when the
    field isn't populated yet.
    """
    fields = _kb_field_map(slug)
    suffix = "live" if _stripe_mode() == "live" else "test"
    value = fields.get(f"{base_field}_{suffix}") or ""
    return str(value).strip()


def _env_premium_price_id(billing_cycle: str) -> str:
    """Fallback Stripe price ID for premium, read from env vars."""
    key = {
        "monthly": "STRIPE_PRICE_PREMIUM_MONTHLY",
        "yearly": "STRIPE_PRICE_PREMIUM_YEARLY",
    }.get(billing_cycle)
    if not key:
        return ""
    return (os.getenv(key) or "").strip()


def _resolve_premium_price(billing_cycle: str) -> str:
    """KB first, env fallback. Yearly has no KB field yet (stays env-only)."""
    if billing_cycle == "monthly":
        kb_value = _price_id_from_kb("user-tiers", "premium_stripe_price_id")
        if kb_value:
            return kb_value
    return _env_premium_price_id(billing_cycle)


_COMMUNITY_TIER_PRICE_FIELDS: Dict[str, str] = {
    community_svc.COMMUNITY_TIER_PAID_L1: "paid_l1_stripe_price_id",
    community_svc.COMMUNITY_TIER_PAID_L2: "paid_l2_stripe_price_id",
    community_svc.COMMUNITY_TIER_PAID_L3: "paid_l3_stripe_price_id",
}


def _resolve_community_tier_price(tier_code: str) -> str:
    base = _COMMUNITY_TIER_PRICE_FIELDS.get(tier_code)
    if not base:
        return ""
    return _price_id_from_kb("community-tiers", base)


# ── /api/stripe/config ──────────────────────────────────────────────────


@subscriptions_bp.route("/api/stripe/config", methods=["GET"])
def api_stripe_config():
    """Expose the publishable key so the client can initialize Stripe.js."""
    if not _session_username():
        return jsonify({"success": False, "error": "Authentication required"}), 401
    pub = _stripe_publishable_key()
    if not pub:
        return jsonify({"success": False, "error": "stripe_not_configured"}), 400
    return jsonify({"success": True, "publishableKey": pub})


# ── /api/kb/pricing ─────────────────────────────────────────────────────


_PREMIUM_FEATURE_BULLETS: Tuple[str, ...] = (
    "Full Steve capabilities across posts, replies, and networking",
    "Own up to 10 communities with member-cap scaling by tier",
    "Voice and post summaries",
    "Priority support + early feature access",
)

_STEVE_PACKAGE_FEATURE_BULLETS: Tuple[str, ...] = (
    "Shared community Steve credit pool (~300 / month)",
    "Premium members spend the pool before their personal credits",
    "Free members can join the pool while it lasts",
    "Opt-in add-on for Paid communities — included on Enterprise",
)

_NETWORKING_FEATURE_BULLETS: Tuple[str, ...] = (
    "Your community appears in the public directory",
    "Discoverable by prospective members",
    "Rate-limited APIs to keep the directory high-signal",
    "Included on Enterprise — add-on for Paid communities",
)


def _premium_payload(fields: Dict[str, Any]) -> Dict[str, Any]:
    """Build the user-premium card data from the ``user-tiers`` KB page."""
    price_eur = fields.get("premium_price_early_eur")
    if price_eur in (None, "", 0):
        price_eur = fields.get("premium_price_standard_eur")
    mode = _stripe_mode()
    price_id = _resolve_premium_price("monthly")
    return {
        "sku": "premium",
        "name": "User Premium Membership",
        "tagline": "Unlock Steve for yourself and own larger communities.",
        "price_eur": price_eur,
        "billing_cycle": "monthly",
        "currency": "EUR",
        "features": list(_PREMIUM_FEATURE_BULLETS),
        "cta_label": "Subscribe",
        "stripe_mode": mode,
        # Publishing the ID here lets the client render a disabled CTA
        # when the ID hasn't been populated yet (instead of surfacing a
        # cryptic Stripe error post-click).
        "stripe_price_id": price_id,
        "purchasable": bool(price_id),
    }


def _community_tier_payload(fields: Dict[str, Any]) -> Dict[str, Any]:
    """Bundle the three Paid tiers into one parent card."""
    mode = _stripe_mode()
    tiers: List[Dict[str, Any]] = []
    for code, level_label in (
        (community_svc.COMMUNITY_TIER_PAID_L1, "L1"),
        (community_svc.COMMUNITY_TIER_PAID_L2, "L2"),
        (community_svc.COMMUNITY_TIER_PAID_L3, "L3"),
    ):
        price = fields.get(f"{code}_price_eur_monthly")
        max_members = fields.get(f"{code}_max_members")
        media_gb = fields.get(f"{code}_media_gb")
        price_id = _resolve_community_tier_price(code)
        tiers.append({
            "tier_code": code,
            "level_label": level_label,
            "price_eur": price,
            "max_members": max_members,
            "media_gb": media_gb,
            "stripe_price_id": price_id,
            "purchasable": bool(price_id),
        })
    return {
        "sku": "community_tier",
        "name": "Community Paid Tier",
        "tagline": "Grow your community beyond the 25-member Free limit.",
        "billing_cycle": "monthly",
        "currency": "EUR",
        "tiers": tiers,
        "cta_label": "Upgrade a community",
        "stripe_mode": mode,
    }


def _steve_package_payload(fields: Dict[str, Any]) -> Dict[str, Any]:
    price_eur = fields.get("paid_steve_package_price_eur_monthly")
    pool = fields.get("paid_steve_package_monthly_credit_pool")
    price_id = _price_id_from_kb("community-tiers", "paid_steve_package_stripe_price_id")
    return {
        "sku": "steve_package",
        "name": "Steve Community Package",
        "tagline": "Give your whole community a shared Steve credit pool.",
        "price_eur": price_eur,
        "billing_cycle": "monthly",
        "currency": "EUR",
        "credit_pool": pool,
        "features": list(_STEVE_PACKAGE_FEATURE_BULLETS),
        "purchasable": False,  # deferred: live checkout ships in a later step
        "coming_soon": True,
        "stripe_mode": _stripe_mode(),
        "stripe_price_id": price_id,
    }


def _networking_payload(fields: Dict[str, Any]) -> Dict[str, Any]:
    price_eur = fields.get("paid_addon_price_eur_monthly")
    price_id = _price_id_from_kb("networking-page", "networking_page_stripe_price_id")
    return {
        "sku": "networking_package",
        "name": "Networking Package",
        "tagline": "Get your community discovered on the public directory.",
        "price_eur": price_eur,
        "billing_cycle": "monthly",
        "currency": "EUR",
        "features": list(_NETWORKING_FEATURE_BULLETS),
        "purchasable": False,  # deferred: live checkout ships in a later step
        "coming_soon": True,
        "stripe_mode": _stripe_mode(),
        "stripe_price_id": price_id,
    }


@subscriptions_bp.route("/api/kb/pricing", methods=["GET"])
def api_kb_pricing():
    """Return the four SKU cards the ``SubscriptionPlans`` page renders.

    Login-only (not admin-only — this is the public commerce surface).
    Internal KB fields (``flat_price_per_member_eur``, ``break_even_*``,
    cost weights, and the opposite mode's price IDs) are never
    published from here; only the fields explicitly copied into the
    helpers above are emitted.
    """
    if not _session_username():
        return jsonify({"success": False, "error": "Authentication required"}), 401

    user_tiers = _kb_field_map("user-tiers")
    community_tiers = _kb_field_map("community-tiers")
    networking = _kb_field_map("networking-page")

    payload = {
        "success": True,
        "stripe_mode": _stripe_mode(),
        "publishable_key_available": bool(_stripe_publishable_key()),
        "sku": {
            "premium": _premium_payload(user_tiers),
            "community_tier": _community_tier_payload(community_tiers),
            "steve_package": _steve_package_payload(community_tiers),
            "networking": _networking_payload(networking),
        },
    }
    return jsonify(payload)


# ── /api/stripe/create_checkout_session ─────────────────────────────────


def _user_email(username: str) -> Optional[str]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT email FROM users WHERE username = {ph}",
                (username,),
            )
            row = c.fetchone()
        except Exception:
            return None
    if not row:
        return None
    email = row["email"] if hasattr(row, "keys") else row[0]
    return str(email) if email else None


def _count_members(community_id: int) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT COUNT(*) FROM user_communities WHERE community_id = {ph}",
                (community_id,),
            )
            row = c.fetchone()
        except Exception:
            return 0
    if not row:
        return 0
    if hasattr(row, "keys"):
        return int(list(row.values())[0] or 0)
    if isinstance(row, (list, tuple)) and row:
        return int(row[0] or 0)
    return int(row or 0)


def _tier_member_cap(tier_code: str) -> Optional[int]:
    fields = _kb_field_map("community-tiers")
    value = fields.get(f"{tier_code}_max_members")
    try:
        cap = int(value)
        return cap if cap > 0 else None
    except (TypeError, ValueError):
        return None


def _preflight_premium(username: str) -> Optional[Tuple[Dict[str, Any], int]]:
    """Return ``(payload, status)`` if the upsell must be blocked, else None.

    Mirrors the enterprise-seat guard that used to live inline in the
    monolith — we don't let a user buy personal Premium on top of an
    Enterprise seat that already grants it.
    """
    try:
        seat = enterprise_membership.active_seat_for(username)
    except Exception:
        logger.exception("premium preflight: active_seat_for failed for %s", username)
        return None
    if not seat:
        return None
    if not seat.get("active"):
        return None
    return (
        {
            "success": False,
            "error": "You already have Premium through your Enterprise community.",
            "reason": "enterprise_seat_active",
            "community_id": seat.get("community_id"),
            "community_slug": seat.get("community_slug"),
        },
        409,
    )


def _preflight_community_tier(
    username: str,
    community_id: int,
    tier_code: str,
) -> Optional[Tuple[Dict[str, Any], int]]:
    """Owner + duplicate-sub + member-cap check for community-tier checkout."""
    if tier_code not in _COMMUNITY_TIER_PRICE_FIELDS:
        return (
            {"success": False, "error": "Unsupported community tier",
             "reason": "invalid_tier"},
            400,
        )
    if not community_svc.is_community_owner(username, community_id):
        return (
            {"success": False,
             "error": "Only the community owner can change billing.",
             "reason": "not_owner"},
            403,
        )
    if community_billing.has_active_subscription(community_id):
        return (
            {"success": False,
             "error": "This community already has an active subscription.",
             "reason": "already_subscribed"},
            409,
        )
    cap = _tier_member_cap(tier_code)
    current = _count_members(community_id)
    if cap is not None and current > cap:
        return (
            {"success": False,
             "error": (
                 f"This community has {current} members, which exceeds the "
                 f"{cap}-member cap for this tier. Pick a higher tier."
             ),
             "reason": "tier_too_small",
             "current_members": current,
             "tier_cap": cap},
            409,
        )
    return None


@subscriptions_bp.route("/api/communities/<int:community_id>/billing", methods=["GET"])
def api_community_billing(community_id: int):
    """Return the billing snapshot the EditGroup Billing panel renders.

    Owner-only. Surfaces the current tier, Stripe subscription status,
    current period end, and enough cap-vs-count math for the progress
    bar. Prices and Stripe IDs are deliberately NOT included here —
    that data belongs to ``/api/kb/pricing`` which is also login-only
    and already cached on the client.
    """
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    if not community_svc.is_community_owner(username, community_id):
        return jsonify({
            "success": False,
            "error": "Only the community owner can view billing.",
            "reason": "not_owner",
        }), 403

    state = community_billing.get_billing_state(community_id) or {}
    tier = state.get("tier") or community_svc.COMMUNITY_TIER_FREE
    member_count = _count_members(community_id)

    # Cap for the tier. Free communities read the owner's entitlement
    # (members_per_owned_community); paid tiers read the KB.
    cap: Optional[int] = None
    if tier in (community_svc.COMMUNITY_TIER_PAID_L1,
                community_svc.COMMUNITY_TIER_PAID_L2,
                community_svc.COMMUNITY_TIER_PAID_L3):
        cap = _tier_member_cap(tier)
    elif tier == community_svc.COMMUNITY_TIER_FREE:
        try:
            from backend.services.entitlements import resolve_entitlements
            ent = resolve_entitlements(username) or {}
            resolved = ent.get("members_per_owned_community")
            if isinstance(resolved, int) and resolved > 0:
                cap = resolved
        except Exception:
            cap = None

    return jsonify({
        "success": True,
        "community_id": community_id,
        "tier": tier,
        "member_count": member_count,
        "member_cap": cap,
        "subscription_status": state.get("subscription_status"),
        "current_period_end": state.get("current_period_end"),
        "has_stripe_customer": bool(state.get("stripe_customer_id")),
        "stripe_mode": _stripe_mode(),
    })


@subscriptions_bp.route("/api/stripe/create_checkout_session", methods=["POST"])
def api_stripe_create_checkout_session():
    """Create a Checkout session for the signed-in user.

    Accepts two ``plan_id`` shapes:

        plan_id='premium'           — personal monthly / yearly
        plan_id='community_tier'    — requires community_id + tier_code
                                       (paid_l1|paid_l2|paid_l3)
    """
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    stripe_mod = _stripe_client()
    if stripe_mod is None:
        return jsonify({"success": False, "error": "Stripe is not configured"}), 400

    payload = request.get_json(silent=True) or {}
    plan_id = str(payload.get("plan_id") or "").strip().lower()
    if plan_id not in ("premium", "community_tier"):
        return jsonify({"success": False, "error": "Unsupported plan"}), 400

    metadata: Dict[str, str] = {
        "sku": plan_id,
        "username": username or "",
        "plan_id": plan_id,
    }
    client_reference_id: Optional[str] = None
    price_id: str = ""

    if plan_id == "premium":
        billing_cycle = str(payload.get("billing_cycle") or "monthly").strip().lower()
        if billing_cycle not in {"monthly", "yearly"}:
            billing_cycle = "monthly"
        block = _preflight_premium(username)
        if block:
            body, status = block
            return jsonify(body), status
        price_id = _resolve_premium_price(billing_cycle)
        if not price_id:
            return jsonify({"success": False,
                            "error": "Pricing is not configured",
                            "reason": "price_missing"}), 400
        metadata["billing_cycle"] = billing_cycle
    else:  # community_tier
        try:
            community_id = int(payload.get("community_id") or 0)
        except (TypeError, ValueError):
            community_id = 0
        tier_code = community_svc._normalize_tier(payload.get("tier_code")) or ""
        if not community_id or not tier_code:
            return jsonify({"success": False,
                            "error": "community_id and tier_code are required",
                            "reason": "missing_params"}), 400
        block = _preflight_community_tier(username, community_id, tier_code)
        if block:
            body, status = block
            return jsonify(body), status
        price_id = _resolve_community_tier_price(tier_code)
        if not price_id:
            return jsonify({"success": False,
                            "error": "Pricing is not configured for this tier yet",
                            "reason": "price_missing",
                            "tier_code": tier_code}), 400
        metadata["community_id"] = str(community_id)
        metadata["tier_code"] = tier_code
        client_reference_id = f"community:{community_id}"

    email_value = _user_email(username)

    success_url = urljoin(request.host_url, "success?session_id={CHECKOUT_SESSION_ID}")
    cancel_path = "subscription_plans?status=cancelled"
    if plan_id == "community_tier" and metadata.get("community_id"):
        cancel_path = (
            f"subscription_plans?status=cancelled&community_id="
            f"{metadata['community_id']}"
        )
    cancel_url = urljoin(request.host_url, cancel_path)

    session_args: Dict[str, Any] = {
        "mode": "subscription",
        "line_items": [{"price": price_id, "quantity": 1}],
        "allow_promotion_codes": True,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": metadata,
        # Mirror the metadata onto the subscription object itself so
        # ``customer.subscription.updated`` / ``.deleted`` webhook events
        # can route back to the community without re-looking-up the
        # original Checkout Session.
        "subscription_data": {"metadata": metadata},
    }
    if email_value:
        session_args["customer_email"] = email_value
    if client_reference_id:
        session_args["client_reference_id"] = client_reference_id

    try:
        checkout_session = stripe_mod.checkout.Session.create(**session_args)
    except Exception as exc:
        logger.error(
            "Stripe checkout creation failed for %s (plan=%s): %s",
            username,
            plan_id,
            exc,
        )
        return jsonify({"success": False, "error": "Unable to start checkout"}), 500

    return jsonify({
        "success": True,
        "sessionId": checkout_session.get("id"),
        "url": checkout_session.get("url"),
    })
