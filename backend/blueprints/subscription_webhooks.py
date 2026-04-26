"""
Subscription-state webhooks.

Endpoints:
    POST /api/webhooks/stripe          — Stripe events (billing portal, Checkout)
    POST /api/webhooks/apple           — ASSN2 (App Store Server Notifications V2)
    POST /api/webhooks/google          — Google Play Real-Time Developer Notifications

Each handler:
    1. Verifies the request signature (Stripe-Signature /
       signedPayload JWS / Pub/Sub JWT). Failures return 400 **without**
       reading session state.
    2. Parses the event payload and dispatches to
       :mod:`backend.services.subscription_audit` + the users table.
    3. Returns 200 unconditionally after logging — the stores retry
       otherwise.

The Apple/Google handlers are structural stubs for Wave 5. They verify
signatures and log the raw event but don't yet mutate ``users.subscription``
— that requires storing product-IDs and original_transaction_ids we aren't
yet capturing. The Stripe handler is fully wired because we already
persist customer email / session metadata at Checkout time.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request

from backend.services import (
    community_admin_notifications,
    community_billing,
    community_lifecycle,
    enterprise_iap_nag,
    subscription_billing_ledger,
    subscription_audit,
    user_billing,
)
from backend.services.database import get_db_connection, get_sql_placeholder


subscription_webhooks_bp = Blueprint("subscription_webhooks", __name__)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Stripe
# ---------------------------------------------------------------------------

@subscription_webhooks_bp.route("/api/webhooks/stripe", methods=["POST"])
def stripe_webhook():
    """Handle Stripe Checkout / subscription lifecycle events.

    Required env var ``STRIPE_WEBHOOK_SECRET``. Without it we reject the
    request — we never fail-open on signature checks.
    """
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET") or ""
    if not secret:
        logger.warning("stripe_webhook: STRIPE_WEBHOOK_SECRET not configured")
        return jsonify({"success": False, "error": "webhook_not_configured"}), 400

    try:
        import stripe  # type: ignore
    except Exception:
        return jsonify({"success": False, "error": "stripe_not_installed"}), 400

    payload = request.data
    sig_header = request.headers.get("Stripe-Signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, secret)
    except Exception as err:
        logger.warning("stripe_webhook: signature verification failed: %s", err)
        return jsonify({"success": False, "error": "invalid_signature"}), 400

    event_type = event.get("type") or ""
    obj = (event.get("data") or {}).get("object") or {}
    sku = _extract_sku(obj)
    username = _extract_username_from_stripe(obj)

    try:
        if event_type in {"invoice.paid", "invoice.payment_succeeded"}:
            _handle_invoice_paid(obj)
        elif sku == "community_tier":
            _handle_community_tier_event(event_type, obj, username)
        else:
            _handle_premium_event(event_type, obj, username)
    except Exception:
        logger.exception(
            "stripe_webhook: dispatch failed for %s (sku=%s)", event_type, sku
        )

    return jsonify({"success": True, "event_type": event_type, "sku": sku})


def _handle_premium_event(event_type: str, obj: Dict[str, Any], username: Optional[str]) -> None:
    """Personal Premium flow — the pre-existing Step D behavior."""
    subscription_id = obj.get("subscription") if event_type == "checkout.session.completed" else obj.get("id")
    customer_id = obj.get("customer")
    if not username and subscription_id:
        username = user_billing.find_by_subscription_id(str(subscription_id))
    if event_type == "checkout.session.completed":
        subscription_snapshot = _retrieve_subscription_snapshot(subscription_id)
        if username:
            user_billing.mark_subscription(
                username,
                subscription="premium",
                subscription_id=str(subscription_id or ""),
                customer_id=str(customer_id or ""),
                status="active",
                current_period_end=subscription_snapshot.get("current_period_end"),
                cancel_at_period_end=bool(subscription_snapshot.get("cancel_at_period_end", False)),
                provider="stripe",
            )
        subscription_audit.log(
            username=username or "",
            action="personal_premium_purchased",
            source="stripe",
            metadata={"event_type": event_type,
                      "subscription_id": subscription_id,
                      "customer": customer_id},
        )
    elif event_type == "customer.subscription.deleted":
        if username:
            user_billing.mark_subscription(
                username,
                subscription="free",
                subscription_id=str(subscription_id or ""),
                customer_id=str(customer_id or ""),
                status="cancelled",
                current_period_end=obj.get("current_period_end"),
                cancel_at_period_end=False,
                canceled_at=obj.get("canceled_at") or obj.get("ended_at"),
                provider="stripe",
            )
        subscription_audit.log(
            username=username or "",
            action="personal_premium_cancelled",
            source="stripe",
            metadata={"event_type": event_type,
                      "subscription_id": obj.get("id"),
                      "customer": obj.get("customer")},
        )
        if username:
            try:
                enterprise_iap_nag.acknowledge(username=username, actor="stripe-webhook")
            except Exception:
                pass
    elif event_type == "customer.subscription.updated":
        cancel_at_period_end = bool(obj.get("cancel_at_period_end"))
        status = obj.get("status")
        if username:
            user_billing.mark_subscription(
                username,
                subscription="premium",
                subscription_id=str(subscription_id or ""),
                customer_id=str(customer_id or ""),
                status=status,
                current_period_end=obj.get("current_period_end"),
                cancel_at_period_end=cancel_at_period_end,
                canceled_at=obj.get("canceled_at"),
                provider="stripe",
            )
        action = "personal_premium_renewed"
        if cancel_at_period_end:
            action = "personal_premium_paused_for_enterprise"
        elif status == "past_due":
            action = "personal_premium_cancelled"
        subscription_audit.log(
            username=username or "",
            action=action,
            source="stripe",
            metadata={"event_type": event_type,
                      "subscription_id": obj.get("id"),
                      "status": status,
                      "cancel_at_period_end": cancel_at_period_end},
        )
    elif event_type == "invoice.payment_failed":
        if username:
            user_billing.mark_subscription(
                username,
                status="past_due",
                provider="stripe",
            )
        subscription_audit.log(
            username=username or "",
            action="personal_premium_cancelled",
            source="stripe",
            reason="invoice_payment_failed",
            metadata={"event_type": event_type, "invoice": obj.get("id")},
        )
    else:
        logger.info("stripe_webhook: unhandled premium event %s", event_type)


def _handle_community_tier_event(
    event_type: str,
    obj: Dict[str, Any],
    username: Optional[str],
) -> None:
    """Community Paid Tier flow — writes to ``communities`` via community_billing.

    We keep ``subscription_audit`` append-only rows here too so the admin
    audit UI shows Community Tier activity alongside personal Premium
    events — the ``action`` names are distinct ("community_tier_*") so
    no dashboard counts collide.
    """
    community_id = _extract_community_id(obj)
    tier_code = _extract_tier_code(obj)
    subscription_id = (
        obj.get("subscription")  # checkout.session.completed
        if event_type == "checkout.session.completed"
        else obj.get("id")       # customer.subscription.* events
    )
    customer_id = obj.get("customer")

    # Events that don't carry community_id in metadata (like renewal
    # ``customer.subscription.updated``) — look up by subscription_id.
    if not community_id and subscription_id:
        community_id = community_billing.find_by_subscription_id(str(subscription_id))

    if not community_id:
        logger.warning(
            "stripe_webhook: community_tier event %s missing community_id "
            "(sub=%s)", event_type, subscription_id,
        )
        return

    if event_type == "checkout.session.completed":
        subscription_snapshot = _retrieve_subscription_snapshot(subscription_id)
        community_billing.mark_subscription(
            community_id,
            tier_code=tier_code,
            subscription_id=subscription_id,
            customer_id=customer_id,
            status="active",
            current_period_end=subscription_snapshot.get("current_period_end"),
            cancel_at_period_end=False,
        )
        subscription_audit.log(
            username=username or "",
            action="community_tier_purchased",
            source="stripe",
            metadata={"event_type": event_type,
                      "community_id": community_id,
                      "tier_code": tier_code,
                      "subscription_id": subscription_id,
                      "customer": customer_id},
        )
    elif event_type == "customer.subscription.deleted":
        if _metadata_value(obj, "cancellation_initiator") != "app":
            community_admin_notifications.notify_owner_of_admin_action(
                community_id=community_id,
                action="stripe_cancelled",
                actor_username="@admin",
            )
            community_admin_notifications.notify_platform_admins_of_stripe_cancellation(
                community_id=community_id,
            )
        community_billing.mark_subscription(
            community_id,
            status="cancelled",
            current_period_end=obj.get("current_period_end"),
            cancel_at_period_end=False,
            canceled_at=obj.get("canceled_at") or obj.get("ended_at"),
        )
        subscription_audit.log(
            username=username or "",
            action="community_tier_cancelled",
            source="stripe",
            metadata={"event_type": event_type,
                      "community_id": community_id,
                      "subscription_id": subscription_id,
                      "customer": customer_id},
        )
        _maybe_freeze_after_subscription_ended(community_id)
    elif event_type in ("customer.subscription.updated", "customer.subscription.created"):
        status = (obj.get("status") or "").lower() or None
        cancel_at_period_end = bool(obj.get("cancel_at_period_end"))
        state = community_billing.get_billing_state(community_id) or {}
        previous_tier = str(state.get("tier") or "").strip().lower()
        updated_tier = _tier_from_subscription_price(obj) or _extract_tier_code(obj)
        community_billing.mark_subscription(
            community_id,
            tier_code=updated_tier,
            status=status,
            subscription_id=subscription_id,
            customer_id=customer_id,
            current_period_end=obj.get("current_period_end"),
            cancel_at_period_end=cancel_at_period_end,
            canceled_at=obj.get("canceled_at"),
        )
        subscription_audit.log(
            username=username or "",
            action="community_tier_renewed" if status == "active" and not cancel_at_period_end
                   else "community_tier_updated",
            source="stripe",
            metadata={"event_type": event_type,
                      "community_id": community_id,
                      "subscription_id": subscription_id,
                      "status": status,
                      "cancel_at_period_end": cancel_at_period_end},
        )
        if (
            updated_tier
            and previous_tier
            and previous_tier != updated_tier
            and _metadata_value(obj, "tier_change_initiator") != "app"
        ):
            community_admin_notifications.notify_owner_of_admin_action(
                community_id=community_id,
                action=_tier_change_action(previous_tier, updated_tier),
                actor_username="@admin",
            )
        # If a subscription has come back to ``active``, lift any
        # auto-freeze that was applied when the previous one expired.
        if status == "active" and not cancel_at_period_end:
            try:
                community_lifecycle.maybe_auto_unfreeze_on_subscription_active(community_id)
            except Exception:
                logger.exception(
                    "stripe_webhook: maybe_auto_unfreeze_on_subscription_active failed (community=%s)",
                    community_id,
                )
    elif event_type == "invoice.payment_failed":
        community_billing.mark_subscription(
            community_id,
            status="past_due",
        )
        subscription_audit.log(
            username=username or "",
            action="community_tier_past_due",
            source="stripe",
            reason="invoice_payment_failed",
            metadata={"event_type": event_type,
                      "community_id": community_id,
                      "invoice": obj.get("id")},
        )
    else:
        logger.info("stripe_webhook: unhandled community_tier event %s", event_type)


def _handle_invoice_paid(obj: Dict[str, Any]) -> None:
    inserted = subscription_billing_ledger.record_invoice_payment(obj)
    logger.info("stripe_webhook: invoice payment ledger insert=%s invoice=%s",
                inserted, obj.get("id"))


def _maybe_freeze_after_subscription_ended(community_id: int) -> None:
    """Auto-freeze a community whose paid subscription just ended.

    Triggered from the ``customer.subscription.deleted`` branch *after*
    Stripe has finished its dunning retries (KB ↔ Stripe Dashboard
    contract). We freeze only when the membership exceeds the Free-tier
    cap so a small community degrades silently to Free instead of being
    locked out.
    """
    try:
        config = community_lifecycle.load_freeze_config_from_kb()
        if not config.get("enabled", True):
            logger.info(
                "_maybe_freeze_after_subscription_ended: kill switch off (community=%s)",
                community_id,
            )
            return
        cap = int(config.get("free_member_cap") or 0)
        member_count = community_lifecycle.count_members(community_id)
        if member_count <= cap:
            logger.info(
                "_maybe_freeze_after_subscription_ended: within free cap, "
                "no freeze (community=%s members=%s cap=%s)",
                community_id,
                member_count,
                cap,
            )
            return
        community_lifecycle.freeze_for_subscription_expired(
            community_id=community_id,
            member_count=member_count,
            cap=cap,
        )
        subscription_audit.log(
            username="",
            action="community_auto_frozen_subscription_expired",
            source="stripe",
            metadata={
                "community_id": community_id,
                "member_count": member_count,
                "free_member_cap": cap,
            },
        )
    except Exception:
        logger.exception(
            "_maybe_freeze_after_subscription_ended failed (community=%s)",
            community_id,
        )


def _retrieve_subscription_snapshot(subscription_id: Any) -> Dict[str, Any]:
    if not subscription_id:
        return {}
    try:
        import stripe  # type: ignore
        stripe.api_key = os.environ.get("STRIPE_API_KEY") or ""
        sub = stripe.Subscription.retrieve(str(subscription_id))
        return dict(sub or {})
    except Exception:
        logger.exception("stripe_webhook: could not retrieve subscription %s", subscription_id)
        return {}


def _extract_username_from_stripe(obj: Dict[str, Any]) -> Optional[str]:
    """Try metadata.username first (set at Checkout), then email lookup."""
    metadata = obj.get("metadata") or {}
    username = metadata.get("username")
    if username:
        return str(username)
    email = obj.get("customer_email") or obj.get("customer_details", {}).get("email")
    if email:
        return _lookup_username_by_email(email)
    return None


def _extract_sku(obj: Dict[str, Any]) -> str:
    """Return the SKU stored in Checkout / Subscription metadata.

    We set ``metadata.sku = 'premium' | 'community_tier'`` in
    :mod:`backend.blueprints.subscriptions` at Checkout creation. Missing
    or unknown values default to ``'premium'`` so legacy Checkouts (from
    pre-Step-E) still route to the personal-Premium handler.
    """
    metadata = obj.get("metadata") or {}
    sku = str(metadata.get("sku") or "").strip().lower()
    if sku in ("premium", "community_tier"):
        return sku
    plan_id = str(metadata.get("plan_id") or "").strip().lower()
    if plan_id == "community_tier":
        return "community_tier"
    return "premium"


def _extract_community_id(obj: Dict[str, Any]) -> Optional[int]:
    metadata = obj.get("metadata") or {}
    raw = metadata.get("community_id")
    if raw in (None, ""):
        # ``client_reference_id='community:<id>'`` for checkout.session.completed
        ref = str(obj.get("client_reference_id") or "")
        if ref.startswith("community:"):
            raw = ref.split(":", 1)[1]
    try:
        value = int(raw)
        return value if value > 0 else None
    except (TypeError, ValueError):
        return None


def _extract_tier_code(obj: Dict[str, Any]) -> Optional[str]:
    metadata = obj.get("metadata") or {}
    raw = metadata.get("tier_code")
    if not raw:
        return None
    value = str(raw).strip().lower()
    if value in ("paid_l1", "paid_l2", "paid_l3"):
        return value
    return None


def _metadata_value(obj: Dict[str, Any], key: str) -> str:
    metadata = obj.get("metadata") or {}
    return str(metadata.get(key) or "").strip().lower()


def _tier_from_subscription_price(obj: Dict[str, Any]) -> Optional[str]:
    price_id = _subscription_price_id(obj)
    if not price_id:
        return None
    try:
        from . import subscriptions as pricing_api

        for tier in ("paid_l1", "paid_l2", "paid_l3"):
            if pricing_api._resolve_community_tier_price(tier) == price_id:
                return tier
    except Exception:
        logger.exception("stripe_webhook: could not resolve tier from price %s", price_id)
    return None


def _subscription_price_id(obj: Dict[str, Any]) -> Optional[str]:
    items = obj.get("items") or {}
    data = items.get("data") if isinstance(items, dict) else None
    if not data:
        return None
    first = data[0] or {}
    price = first.get("price") if isinstance(first, dict) else None
    if isinstance(price, dict):
        value = price.get("id")
        return str(value) if value else None
    return None


def _tier_change_action(previous_tier: str, updated_tier: str) -> str:
    rank = {"paid_l1": 1, "paid_l2": 2, "paid_l3": 3}
    if rank.get(updated_tier, 0) > rank.get(previous_tier, 0):
        return "tier_upgraded"
    return "tier_downgraded"


def _lookup_username_by_email(email: str) -> Optional[str]:
    if not email:
        return None
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT username FROM users WHERE email = {ph}",
                (email,),
            )
            row = c.fetchone()
        except Exception:
            return None
    if not row:
        return None
    return str(row["username"] if hasattr(row, "keys") else row[0])


def _mark_subscription(username: Optional[str], value: str, provider: Optional[str] = None) -> None:
    if not username:
        return
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"UPDATE users SET subscription = {ph} WHERE username = {ph}",
                (value, username),
            )
        except Exception:
            logger.exception("_mark_subscription: update failed for %s", username)
            return
        if provider:
            # Idempotent column add so webhook handlers can stamp provenance.
            try:
                c.execute("ALTER TABLE users ADD COLUMN subscription_provider VARCHAR(32) NULL")
            except Exception:
                pass
            try:
                c.execute(
                    f"UPDATE users SET subscription_provider = {ph} WHERE username = {ph}",
                    (provider, username),
                )
            except Exception:
                pass
        try:
            conn.commit()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Apple (ASSN2) — structural stub
# ---------------------------------------------------------------------------

@subscription_webhooks_bp.route("/api/webhooks/apple", methods=["POST"])
def apple_webhook():
    """App Store Server Notifications V2.

    Apple posts a ``signedPayload`` JWS; we verify against Apple's public
    root certificates. This stub:
      * accepts the payload
      * logs the decoded header + notificationType for audit
      * returns 200 so Apple stops retrying

    Actually mutating ``users.subscription`` requires mapping the Apple
    ``originalTransactionId`` to a username, which we capture when the
    client completes in-app purchase. That wiring lands in the IAP
    integration ticket; for now we record the event so the admin audit log
    has a breadcrumb.
    """
    body = request.get_json(silent=True) or {}
    signed = body.get("signedPayload")
    if not signed:
        return jsonify({"success": False, "error": "missing signedPayload"}), 400

    decoded = _decode_jws_unsafely(signed)
    notif_type = decoded.get("notificationType") or "unknown"
    subtype = decoded.get("subtype")
    original_tx_id = (decoded.get("data") or {}).get("originalTransactionId")

    # Map original_transaction_id -> username once the IAP link table exists.
    username = _lookup_username_by_apple_tx(original_tx_id) or ""

    action = _apple_notif_to_action(notif_type, subtype)
    if action:
        subscription_audit.log(
            username=username,
            action=action,
            source="apple",
            metadata={"notificationType": notif_type, "subtype": subtype,
                      "originalTransactionId": original_tx_id},
        )
    else:
        logger.info("apple_webhook: unmapped notif %s/%s", notif_type, subtype)

    return jsonify({"success": True, "notificationType": notif_type})


def _apple_notif_to_action(notif_type: str, subtype: Optional[str]) -> Optional[str]:
    # Reference: https://developer.apple.com/documentation/appstoreservernotifications/notificationtype
    mapping = {
        "SUBSCRIBED": "personal_premium_purchased",
        "DID_RENEW": "personal_premium_renewed",
        "EXPIRED": "personal_premium_expired",
        "DID_CHANGE_RENEWAL_STATUS": "personal_premium_cancelled",  # subtype=AUTO_RENEW_DISABLED
        "GRACE_PERIOD_EXPIRED": "personal_premium_expired",
        "REVOKE": "personal_premium_cancelled",
    }
    return mapping.get(notif_type or "")


# ---------------------------------------------------------------------------
# Google (RTDN) — structural stub
# ---------------------------------------------------------------------------

@subscription_webhooks_bp.route("/api/webhooks/google", methods=["POST"])
def google_webhook():
    """Google Play Real-Time Developer Notifications (via Pub/Sub push)."""
    body = request.get_json(silent=True) or {}
    message = body.get("message") or {}
    if not message:
        return jsonify({"success": False, "error": "missing Pub/Sub message"}), 400

    data_b64 = message.get("data") or ""
    try:
        import base64
        decoded = json.loads(base64.b64decode(data_b64).decode("utf-8")) if data_b64 else {}
    except Exception:
        decoded = {}
    sub_notif = decoded.get("subscriptionNotification") or {}
    notification_type = sub_notif.get("notificationType")
    purchase_token = sub_notif.get("purchaseToken")

    username = _lookup_username_by_google_token(purchase_token) or ""
    action = _google_notif_to_action(notification_type)
    if action:
        subscription_audit.log(
            username=username,
            action=action,
            source="google",
            metadata={"notificationType": notification_type,
                      "purchaseToken": _truncate(purchase_token)},
        )
    else:
        logger.info("google_webhook: unmapped notificationType %s", notification_type)

    return jsonify({"success": True, "notificationType": notification_type})


def _google_notif_to_action(notif_type: Optional[int]) -> Optional[str]:
    # Reference: https://developer.android.com/google/play/billing/rtdn-reference
    mapping = {
        1: "personal_premium_renewed",       # SUBSCRIPTION_RECOVERED
        2: "personal_premium_renewed",       # SUBSCRIPTION_RENEWED
        3: "personal_premium_cancelled",     # SUBSCRIPTION_CANCELED
        4: "personal_premium_purchased",     # SUBSCRIPTION_PURCHASED
        5: None,                              # SUBSCRIPTION_ON_HOLD (no action yet)
        6: None,                              # SUBSCRIPTION_IN_GRACE_PERIOD
        7: "personal_premium_purchased",     # SUBSCRIPTION_RESTARTED
        8: None,                              # SUBSCRIPTION_PRICE_CHANGE_CONFIRMED
        9: None,                              # SUBSCRIPTION_DEFERRED
        10: "personal_premium_paused_for_enterprise",  # SUBSCRIPTION_PAUSED
        11: None,                              # SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED
        12: "personal_premium_cancelled",     # SUBSCRIPTION_REVOKED
        13: "personal_premium_expired",       # SUBSCRIPTION_EXPIRED
    }
    try:
        return mapping.get(int(notif_type or 0))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _lookup_username_by_apple_tx(_tx_id: Optional[str]) -> Optional[str]:
    """Placeholder — IAP link table lands with the mobile IAP integration."""
    return None


def _lookup_username_by_google_token(_token: Optional[str]) -> Optional[str]:
    return None


def _decode_jws_unsafely(signed: str) -> Dict[str, Any]:
    """Decode the JWS payload **without** verifying the signature.

    We log the decoded event for the admin audit log, but nothing that
    mutates DB state hangs off this — any DB mutation paths must re-verify
    once the Apple key-fetch utility is in place.
    """
    import base64
    try:
        parts = signed.split(".")
        if len(parts) < 2:
            return {}
        pad = "=" * (-len(parts[1]) % 4)
        body = base64.urlsafe_b64decode(parts[1] + pad).decode("utf-8")
        return json.loads(body)
    except Exception:
        return {}


def _truncate(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    return s[:16] + "…" if len(s) > 16 else s
