"""User-facing ``/api/me/*`` endpoints.

Thin wrappers around :mod:`backend.services.entitlements` and
:mod:`backend.services.ai_usage` so the client can render:
    * the Manage Membership modal (Plan / AI Usage / Billing sub-pages)
    * `useEntitlements` hook for gating UI
    * soft-cap warning banners at 80% / 95%

Routes:
    GET  /api/me/entitlements
    GET  /api/me/ai-usage
    GET  /api/me/billing                 — current subscription summary
    GET  /api/me/payment-history         — paid Stripe invoice history
    POST /api/me/billing/portal          — create a Stripe Customer Portal session
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import urlencode, urljoin

from flask import Blueprint, jsonify, request, session

from backend.services import ai_usage, auth_session, session_identity, subscription_billing_ledger, user_billing
from backend.services import client_ui_flags, i18n, user_locale
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.entitlements import resolve_entitlements
from backend.services.feature_flags import entitlements_enforcement_enabled
from redis_cache import cache


me_bp = Blueprint("me", __name__)
logger = logging.getLogger(__name__)


@me_bp.after_request
def _no_store_user_scoped_responses(response):
    return auth_session.no_store(response)


def _session_username() -> str | None:
    return session_identity.valid_session_username(session)


# ── Privacy scrub ──────────────────────────────────────────────────────
#
# These fields are used internally for cost-attribution + the spend
# ceiling gate; they are never safe to return to the end user. Leaking
# them would let anyone reverse-engineer:
#   * the exact EUR budget of their plan  (monthly_spend_ceiling_eur*)
#   * the "Steve weight" applied to each surface (internal_weights)
#   * raw token and USD cost of their last month  (total_cost_usd, …)
# which would turn the gate into a free calculator for "what's the
# cheapest way to max out my plan".
#
# All three user-facing endpoints (/api/me/entitlements, /api/me/ai-usage,
# /api/me/billing) run payloads through these scrubbers before jsonify.

_ENT_INTERNAL_FIELDS = frozenset({
    "monthly_spend_ceiling_eur",
    "monthly_spend_ceiling_eur_special",
    "internal_weights",
})

_SUMMARY_INTERNAL_FIELDS = frozenset({
    "total_cost_usd",
    "total_tokens_in",
    "total_tokens_out",
})


def _scrub_entitlements(ent: Dict[str, Any]) -> Dict[str, Any]:
    """Return a shallow copy of ``ent`` with internal-only fields removed.

    We don't mutate the original so the gate checks still see the real
    values if someone downstream re-uses the dict.
    """
    if not isinstance(ent, dict):
        return {}
    return {k: v for k, v in ent.items() if k not in _ENT_INTERNAL_FIELDS}


def _scrub_month_summary(summary: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(summary, dict):
        return {}
    return {k: v for k, v in summary.items() if k not in _SUMMARY_INTERNAL_FIELDS}


def _pct(used: int | float, cap: int | float | None) -> float | None:
    """Return usage percentage rounded to 1 decimal, None if cap is unlimited."""
    if cap is None or cap == 0:
        return None
    try:
        return round(float(used) / float(cap) * 100.0, 1)
    except Exception:
        return None


def _build_usage(username: str, ent: Dict[str, Any]) -> Dict[str, Any]:
    """Compute current-period usage + near-cap flags against the entitlement caps."""
    monthly_steve = ai_usage.monthly_steve_count(username)
    daily = ai_usage.daily_count(username)
    whisper_min = ai_usage.whisper_minutes_this_month(username)

    steve_cap = ent.get("steve_uses_per_month")
    whisper_cap = ent.get("whisper_minutes_per_month")
    daily_cap = ent.get("ai_daily_limit")

    steve_pct = _pct(monthly_steve, steve_cap)
    whisper_pct = _pct(whisper_min, whisper_cap)
    daily_pct = _pct(daily, daily_cap)

    def _max_pct(*vals):
        nums = [v for v in vals if isinstance(v, (int, float))]
        return max(nums) if nums else 0.0

    max_pct = _max_pct(steve_pct, whisper_pct, daily_pct)

    summary = ai_usage.current_month_summary(username)

    return {
        "monthly_steve_used": monthly_steve,
        "monthly_steve_cap": steve_cap,
        "monthly_steve_pct": steve_pct,
        "daily_used": daily,
        "daily_cap": daily_cap,
        "daily_pct": daily_pct,
        "whisper_minutes_used": round(whisper_min, 2),
        "whisper_minutes_cap": whisper_cap,
        "whisper_minutes_pct": whisper_pct,
        "near_soft_cap": max_pct >= 80.0,
        "near_hard_cap": max_pct >= 95.0,
        "resets_at_monthly": summary.get("resets_at_monthly"),
        "resets_at_daily": summary.get("resets_at_daily"),
    }


@me_bp.route("/api/me/entitlements", methods=["GET"])
def me_entitlements():
    """Return the resolved entitlements + usage snapshot for the signed-in user."""
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    try:
        ent = resolve_entitlements(username)
    except Exception as err:
        # Fail closed — deny Steve rather than opening the gate.
        logger.exception("me_entitlements: resolve_entitlements failed for %s", username)
        return jsonify({
            "success": False,
            "error": "Could not resolve entitlements",
            "detail": str(err),
        }), 500

    try:
        usage = _build_usage(username, ent)
    except Exception:
        logger.exception("me_entitlements: usage build failed for %s", username)
        usage = {}

    return jsonify({
        "success": True,
        "entitlements": _scrub_entitlements(ent),
        "usage": usage,
        "enforcement_enabled": entitlements_enforcement_enabled(),
    })


# ── Locale preference ─────────────────────────────────────────────────
#
# Powers Account Settings → Language (and the upcoming client header
# wrapper). See ``docs/I18N_ROADMAP.md`` for the resolution chain.


@me_bp.route("/api/me/locale", methods=["GET"])
def me_locale_get():
    """Return the user's saved locale plus the locale used for *this* request."""
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    try:
        saved = user_locale.get_preferred_locale(username)
        active = user_locale.resolve_request_locale(request, username)
    except Exception:
        logger.exception("me_locale_get failed for %s", username)
        return jsonify({"success": False, "error": "Could not resolve locale"}), 500

    return jsonify({
        "success": True,
        "preferred_locale": saved,             # None until the user picks one
        "active_locale": active,               # what the server is using right now
        "available_locales": list(i18n.available_locales()),
        "default_locale": i18n.DEFAULT_LOCALE,
    })


@me_bp.route("/api/me/locale", methods=["PATCH", "POST"])
def me_locale_set():
    """Persist the user's locale choice from Account Settings.

    Request body: ``{"locale": "pt-PT"}`` to set, or ``{"locale": null}``
    to clear and fall back to the request-chain detection.
    """
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    payload = request.get_json(silent=True) or {}
    raw = payload.get("locale", "__missing__")
    if raw == "__missing__":
        return jsonify({"success": False, "error": "locale required"}), 400

    try:
        stored = user_locale.set_preferred_locale(username, raw)
    except ValueError as exc:
        return jsonify({
            "success": False,
            "error": "unsupported_locale",
            "detail": str(exc),
            "available_locales": list(i18n.available_locales()),
        }), 400
    except Exception:
        logger.exception("me_locale_set failed for %s", username)
        return jsonify({"success": False, "error": "Could not save locale"}), 500

    return jsonify({
        "success": True,
        "preferred_locale": stored,
        "available_locales": list(i18n.available_locales()),
    })


@me_bp.route("/api/me/ai-usage", methods=["GET"])
def me_ai_usage():
    """Detailed monthly AI usage breakdown for the Manage Membership → AI Usage tab."""
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    try:
        ent = resolve_entitlements(username)
        summary = ai_usage.current_month_summary(username)
        usage = _build_usage(username, ent)
    except Exception as err:
        logger.exception("me_ai_usage failed for %s", username)
        return jsonify({
            "success": False,
            "error": "Could not load AI usage",
            "detail": str(err),
        }), 500

    # Strip cost/weight fields before the payload leaves the server;
    # ``internal_weights`` is deliberately NOT surfaced here anymore —
    # see the scrubber comment at the top of this module.
    return jsonify({
        "success": True,
        "entitlements": _scrub_entitlements(ent),
        "usage": usage,
        "month_summary": _scrub_month_summary(summary),
    })


# ---------------------------------------------------------------------------
# Billing
# ---------------------------------------------------------------------------

def _stripe_client():
    """Return the configured ``stripe`` module, or ``None`` if Stripe is off.

    We avoid a hard import at module load to keep startup cheap when Stripe
    isn't used (tests, dev).
    """
    try:
        import stripe  # type: ignore
    except Exception:
        return None
    api_key = os.environ.get("STRIPE_API_KEY") or ""
    if not api_key or api_key == "sk_test_your_stripe_key":
        return None
    stripe.api_key = api_key
    return stripe


def _stripe_mode() -> str:
    key = (os.environ.get("STRIPE_API_KEY") or "").strip()
    return "live" if key.startswith("sk_live_") else "test"


def _unix_seconds(value: Any) -> Optional[int]:
    if value in (None, "", 0):
        return None
    if isinstance(value, (int, float)):
        ts = int(value)
        return ts // 1000 if ts > 1_000_000_000_000 else ts
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    text = str(value).strip()
    if not text:
        return None
    try:
        ts = int(text)
        return ts // 1000 if ts > 1_000_000_000_000 else ts
    except Exception:
        pass
    parsed_dt: Optional[datetime] = None
    try:
        parsed_dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                parsed_dt = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
                break
            except Exception:
                continue
    if not parsed_dt:
        return None
    if parsed_dt.tzinfo is None:
        parsed_dt = parsed_dt.replace(tzinfo=timezone.utc)
    return int(parsed_dt.timestamp())


def _subscription_from_billing_state(state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    sub_id = state.get("stripe_subscription_id")
    customer_id = state.get("stripe_customer_id")
    status = state.get("subscription_status")
    period_end = _unix_seconds(state.get("current_period_end"))
    if not any((sub_id, customer_id, status, period_end)):
        return None
    return {
        "customer_id": customer_id,
        "subscription_id": sub_id,
        "status": status,
        "cancel_at_period_end": bool(state.get("cancel_at_period_end")),
        "current_period_end": period_end,
        "trial_end": None,
        "price_amount_cents": None,
        "price_interval": None,
        "price_currency": None,
        "source": "local",
        "stripe_mode": state.get("stripe_mode") or _stripe_mode(),
    }


def _load_user_row(username: str) -> Optional[Dict[str, Any]]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT username, email, subscription, created_at FROM users WHERE username = {ph}",
                (username,),
            )
        except Exception:
            return None
        row = c.fetchone()
    if not row:
        return None
    return {
        "username": row["username"] if hasattr(row, "keys") else row[0],
        "email": (row["email"] if hasattr(row, "keys") else row[1]) or "",
        "subscription": (row["subscription"] if hasattr(row, "keys") else row[2]) or "free",
        "created_at": str(row["created_at"] if hasattr(row, "keys") else row[3]) if (row["created_at"] if hasattr(row, "keys") else row[3]) else None,
    }


def _owned_root_communities(username: str) -> Dict[int, str]:
    if not username:
        return {}
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                SELECT DISTINCT c.id, c.name
                FROM communities c
                LEFT JOIN user_communities uc ON uc.community_id = c.id
                LEFT JOIN users u ON u.id = uc.user_id
                WHERE c.parent_community_id IS NULL
                  AND (
                    LOWER(c.creator_username) = LOWER({ph})
                    OR (
                      LOWER(u.username) = LOWER({ph})
                      AND LOWER(COALESCE(uc.role, '')) = 'owner'
                    )
                  )
                """,
                (username, username),
            )
            rows = c.fetchall() or []
    except Exception:
        logger.exception("_owned_root_communities failed for %s", username)
        return {}
    out: Dict[int, str] = {}
    for row in rows:
        cid = row["id"] if hasattr(row, "keys") else row[0]
        name = row["name"] if hasattr(row, "keys") else row[1]
        try:
            out[int(cid)] = str(name or "")
        except Exception:
            continue
    return out


def _find_stripe_subscription(stripe_mod, email: str) -> Optional[Dict[str, Any]]:
    """Return a minimal summary of the newest active/trialing subscription for this email.

    We look up the customer by email (created via Checkout in
    ``/api/stripe/create_checkout_session``) — this is imperfect if the user
    has multiple Stripe customers under the same email, but it's good enough
    for MVP. A dedicated ``users.stripe_customer_id`` column will come with
    Wave 5's subscription audit work.
    """
    if not email:
        return None
    try:
        customers = stripe_mod.Customer.list(email=email, limit=5).get("data") or []
    except Exception:
        logger.exception("stripe.Customer.list failed")
        return None
    best_sub = None
    best_customer_id = None
    for customer in customers:
        cid = customer.get("id")
        if not cid:
            continue
        try:
            subs = stripe_mod.Subscription.list(customer=cid, status="all", limit=5).get("data") or []
        except Exception:
            continue
        for sub in subs:
            status = sub.get("status")
            if status not in ("active", "trialing", "past_due", "unpaid"):
                continue
            # Prefer the most recently created active/trialing sub.
            if best_sub is None or (sub.get("created") or 0) > (best_sub.get("created") or 0):
                best_sub = sub
                best_customer_id = cid
    if not best_sub:
        return None
    items = (best_sub.get("items") or {}).get("data") or []
    price = items[0].get("price") if items else None
    amount_cents = None
    interval = None
    currency = None
    if price:
        amount_cents = price.get("unit_amount")
        recurring = price.get("recurring") or {}
        interval = recurring.get("interval")
        currency = (price.get("currency") or "").upper()
    return {
        "customer_id": best_customer_id,
        "subscription_id": best_sub.get("id"),
        "status": best_sub.get("status"),
        "cancel_at_period_end": bool(best_sub.get("cancel_at_period_end")),
        "current_period_end": best_sub.get("current_period_end"),
        "trial_end": best_sub.get("trial_end"),
        "price_amount_cents": amount_cents,
        "price_interval": interval,
        "price_currency": currency,
    }


@me_bp.route("/api/me/billing", methods=["GET"])
def me_billing():
    """Summarize the signed-in user's billing state (plan + Stripe subscription).

    Returns enough info for the Manage Membership → Plan/Billing sub-pages:
    current tier, renewal date, cancel-at-period-end flag, amount, and a
    ``portal_available`` flag the client uses to show/hide the "Manage payment
    method" button. If Stripe isn't configured, the endpoint still returns
    tier info so the modal can render.
    """
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    user = _load_user_row(username) or {}
    ent = {}
    try:
        ent = resolve_entitlements(username) or {}
    except Exception:
        logger.exception("me_billing: resolve_entitlements failed for %s", username)

    stripe_mod = _stripe_client()
    stripe_configured = stripe_mod is not None
    billing_state = user_billing.get_billing_state(username) or {}
    provider = str(billing_state.get("subscription_provider") or "stripe").strip().lower()
    subscription = _subscription_from_billing_state(billing_state)
    if subscription is None and stripe_configured and user.get("email"):
        subscription = _find_stripe_subscription(stripe_mod, user["email"])
        if subscription:
            subscription["source"] = "stripe_email"
            subscription["stripe_mode"] = _stripe_mode()
    stored_mode = str(billing_state.get("stripe_mode") or _stripe_mode()).strip().lower()
    portal_available = bool(
        stripe_configured
        and provider == "stripe"
        and subscription
        and subscription.get("customer_id")
        and stored_mode == _stripe_mode()
    )

    return jsonify({
        "success": True,
        "plan": {
            "tier": ent.get("tier") or user.get("subscription") or "free",
            "subscription": user.get("subscription") or "free",
            "is_special": bool(ent.get("is_special")),
            "inherited_from": ent.get("inherited_from"),
            "subscription_provider": provider,
            "since": user.get("created_at"),
        },
        "stripe": {
            "configured": stripe_configured,
            "subscription": subscription,
            "portal_available": portal_available,
            "mode": _stripe_mode(),
        },
        "caps": {
            # monthly_spend_ceiling_eur deliberately omitted — see the
            # privacy scrub note at the top of this module.
            "steve_uses_per_month": ent.get("steve_uses_per_month"),
            "whisper_minutes_per_month": ent.get("whisper_minutes_per_month"),
            "communities_max": ent.get("communities_max"),
        },
    })


@me_bp.route("/api/me/payment-history", methods=["GET"])
def me_payment_history():
    """Return paid invoice history for the user and communities they own."""
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    owned_communities = _owned_root_communities(username)
    personal = subscription_billing_ledger.list_for_user(username, limit=50)
    community = subscription_billing_ledger.list_for_communities(
        list(owned_communities.keys()),
        limit=50,
    )
    payments = []
    for row in personal:
        payments.append({
            **row,
            "scope": "personal",
            "label": "Premium membership",
            "community_name": None,
        })
    for row in community:
        cid = row.get("community_id")
        payments.append({
            **row,
            "scope": "community",
            "label": owned_communities.get(int(cid or 0), "Community billing"),
            "community_name": owned_communities.get(int(cid or 0)),
        })

    payments.sort(key=lambda p: str(p.get("paid_at") or ""), reverse=True)
    return jsonify({
        "success": True,
        "payments": payments[:100],
    })


@me_bp.route("/api/me/billing/portal", methods=["POST"])
def me_billing_portal():
    """Open a Stripe Customer Portal session for the signed-in user.

    Returns ``{success, url}``. The client should ``window.location = url``.

    Supports two scopes:
      * Personal — no ``community_id`` query param; the user's own
        personal Premium subscription.
      * Community — ``?community_id=<id>`` (or JSON body ``community_id``)
        scopes the portal session to the community's own Stripe
        customer. Only the community owner may request this scope.
    """
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    stripe_mod = _stripe_client()
    if stripe_mod is None:
        return jsonify({"success": False, "error": "stripe_not_configured"}), 400

    body = request.get_json(silent=True) or {}
    community_id_raw = (
        request.args.get("community_id")
        or body.get("community_id")
    )
    try:
        community_id = int(community_id_raw) if community_id_raw else 0
    except (TypeError, ValueError):
        community_id = 0

    customer_id: Optional[str] = None
    if community_id:
        from backend.services import community as community_svc
        from backend.services import community_billing
        if not community_svc.is_community_owner(username, community_id):
            return jsonify({
                "success": False,
                "error": "Only the community owner can manage billing.",
                "reason": "not_owner",
            }), 403
        state = community_billing.get_billing_state(community_id) or {}
        provider = str(state.get("billing_provider") or "stripe").strip().lower()
        if provider in ("apple", "google"):
            return jsonify({
                "success": False,
                "error": "This community is managed through a mobile store.",
                "reason": "store_billing_active",
                "billing_provider": provider,
            }), 409
        stored_mode = str(state.get("stripe_mode") or _stripe_mode()).strip().lower()
        if stored_mode != _stripe_mode():
            return jsonify({
                "success": False,
                "error": "This community subscription belongs to a different Stripe mode.",
                "reason": "stripe_mode_mismatch",
                "billing_provider": provider,
                "stripe_mode": stored_mode,
                "current_stripe_mode": _stripe_mode(),
            }), 409
        customer_id = state.get("stripe_customer_id") or None
        if not customer_id:
            return jsonify({
                "success": False,
                "error": "This community has no Stripe subscription yet.",
                "reason": "no_customer",
            }), 404
    else:
        billing_state = user_billing.get_billing_state(username) or {}
        provider = str(billing_state.get("subscription_provider") or "stripe").strip().lower()
        if provider in ("apple", "google"):
            return jsonify({
                "success": False,
                "error": "This subscription is managed through a mobile store.",
                "reason": "store_billing_active",
                "billing_provider": provider,
            }), 409
        stored_mode = str(billing_state.get("stripe_mode") or _stripe_mode()).strip().lower()
        if stored_mode != _stripe_mode():
            return jsonify({
                "success": False,
                "error": "This subscription belongs to a different Stripe mode.",
                "reason": "stripe_mode_mismatch",
                "billing_provider": provider,
                "stripe_mode": stored_mode,
                "current_stripe_mode": _stripe_mode(),
            }), 409
        customer_id = billing_state.get("stripe_customer_id") or None
        if customer_id:
            pass
        else:
            user = _load_user_row(username) or {}
            email = user.get("email") or ""
            if not email:
                return jsonify({"success": False, "error": "No email on file"}), 400

            subscription = _find_stripe_subscription(stripe_mod, email)
            customer_id = (subscription or {}).get("customer_id")
            if not customer_id:
                return jsonify({"success": False, "error": "No Stripe customer found"}), 404

    return_path = str(body.get("return_path") or "/account_settings").strip() or "/account_settings"
    if not return_path.startswith("/"):
        return_path = "/account_settings"
    target = "community" if community_id else "personal"
    query = urlencode({
        "target": target,
        "id": str(community_id or ""),
        "return_path": return_path,
    })
    return_url = urljoin(request.host_url, f"billing_return?{query}")

    try:
        portal = stripe_mod.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
    except Exception as err:
        logger.exception("Stripe billing portal creation failed for %s", username)
        return jsonify({"success": False, "error": "Unable to open billing portal", "detail": str(err)}), 500

    return jsonify({"success": True, "url": portal.get("url")})


@me_bp.route("/api/me/communities-spotlight-tour-seen", methods=["POST"])
def mark_communities_spotlight_tour_seen():
    """Persist that the signed-in user finished the Communities page spotlight tour."""
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            client_ui_flags.ensure_user_ui_columns(c)
            c.execute(
                f"UPDATE users SET communities_spotlight_tour_seen = 1 WHERE username = {ph}",
                (username,),
            )
            conn.commit()
    except Exception as err:
        logger.exception("mark_communities_spotlight_tour_seen failed for %s: %s", username, err)
        return jsonify({"success": False, "error": "Could not save preference"}), 500
    try:
        cache.delete(f"profile:{username}")
    except Exception:
        pass
    return jsonify({"success": True})
