"""Shared Apple / Google mobile subscription fulfillment.

The mobile clients complete purchases with StoreKit / Play Billing, then
post the store purchase identifier here. This service links the store
purchase to a C-Point account and grants the same entitlements the Stripe
webhooks grant for web purchases.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from backend.services import community as community_svc
from backend.services import community_billing, iap_links, knowledge_base
from backend.services import store_purchase_verify, subscription_audit, subscription_health, user_billing
from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)

WEB_APP_BILLING_URL = "https://app.c-point.co/subscription_plans"

DEFAULT_PRODUCT_IDS = {
    "premium_apple_product_id": "cpoint_premium_monthly",
    "premium_google_product_id": "cpoint_premium_monthly",
    "paid_l1_apple_product_id": "cpoint_community_l1_monthly",
    "paid_l2_apple_product_id": "cpoint_community_l2_monthly",
    "paid_l3_apple_product_id": "cpoint_community_l3_monthly",
    "paid_l1_google_product_id": "cpoint_community_l1_monthly",
    "paid_l2_google_product_id": "cpoint_community_l2_monthly",
    "paid_l3_google_product_id": "cpoint_community_l3_monthly",
    "paid_steve_package_apple_product_id": "cpoint_steve_community_monthly",
    "paid_steve_package_google_product_id": "cpoint_steve_community_monthly",
}

TIER_BY_PRODUCT_FIELD = {
    "paid_l1_apple_product_id": community_svc.COMMUNITY_TIER_PAID_L1,
    "paid_l2_apple_product_id": community_svc.COMMUNITY_TIER_PAID_L2,
    "paid_l3_apple_product_id": community_svc.COMMUNITY_TIER_PAID_L3,
    "paid_l1_google_product_id": community_svc.COMMUNITY_TIER_PAID_L1,
    "paid_l2_google_product_id": community_svc.COMMUNITY_TIER_PAID_L2,
    "paid_l3_google_product_id": community_svc.COMMUNITY_TIER_PAID_L3,
}


def config() -> Dict[str, Any]:
    user_fields = _kb_field_map("user-tiers")
    community_fields = _kb_field_map("community-tiers")
    enabled = _truthy(user_fields.get("iap_purchases_enabled"), default=False)
    web_url = str(
        user_fields.get("web_app_billing_url")
        or community_fields.get("web_app_billing_url")
        or WEB_APP_BILLING_URL
    ).strip()
    out: Dict[str, Any] = {
        "iap_purchases_enabled": enabled,
        "web_app_billing_url": web_url or WEB_APP_BILLING_URL,
        "apple": {
            "premium_product_id": _field(user_fields, "premium_apple_product_id"),
            "community_product_ids": {
                "paid_l1": _field(community_fields, "paid_l1_apple_product_id"),
                "paid_l2": _field(community_fields, "paid_l2_apple_product_id"),
                "paid_l3": _field(community_fields, "paid_l3_apple_product_id"),
            },
            "steve_product_id": _field(community_fields, "paid_steve_package_apple_product_id"),
        },
        "google": {
            "premium_product_id": _field(user_fields, "premium_google_product_id"),
            "community_product_ids": {
                "paid_l1": _field(community_fields, "paid_l1_google_product_id"),
                "paid_l2": _field(community_fields, "paid_l2_google_product_id"),
                "paid_l3": _field(community_fields, "paid_l3_google_product_id"),
            },
            "steve_product_id": _field(community_fields, "paid_steve_package_google_product_id"),
        },
    }
    return out


def confirm_purchase(
    *,
    provider: str,
    username: str,
    product_id: str,
    purchase_key: str,
    community_id: Optional[int] = None,
    signed_payload: Optional[str] = None,
    environment: Optional[str] = None,
    expires_at: Any = None,
) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """Confirm a store purchase and grant Premium or a community tier."""
    provider = (provider or "").strip().lower()
    username = (username or "").strip()
    product_id = (product_id or "").strip()
    purchase_key = (purchase_key or "").strip()
    if provider not in (iap_links.PROVIDER_APPLE, iap_links.PROVIDER_GOOGLE):
        return False, "invalid_provider", None
    if not username or not product_id or not purchase_key:
        return False, "missing_fields", None

    payload = decode_jws_payload(signed_payload or "")
    if payload:
        product_id = str(payload.get("productId") or product_id).strip()
        purchase_key = str(
            payload.get("originalTransactionId")
            or payload.get("transactionId")
            or purchase_key
        ).strip()
        environment = str(payload.get("environment") or environment or "").strip() or None
        expires_at = expires_at or _expires_from_payload(payload)

    product = _resolve_product(provider, product_id)
    if not product:
        return False, "unknown_product", None

    if not _grants_allowed(environment):
        return False, "iap_purchases_disabled", None

    verify_ok, verify_reason, verified_payload = store_purchase_verify.verify_confirm(
        provider=provider,
        product_id=product_id,
        purchase_key=purchase_key,
        signed_payload=signed_payload,
        environment=environment,
    )
    if not verify_ok:
        return False, verify_reason or "purchase_verification_failed", None
    if verified_payload:
        product_id = str(verified_payload.get("productId") or product_id).strip()
        purchase_key = str(
            verified_payload.get("originalTransactionId")
            or verified_payload.get("transactionId")
            or purchase_key
        ).strip()
        environment = (
            str(verified_payload.get("environment") or environment or "").strip()
            or environment
        )
        expires_at = expires_at or _expires_from_payload(verified_payload)

    existing = iap_links.find(provider, purchase_key)
    if existing and str(existing.get("username") or "").lower() != username.lower():
        return False, "purchase_owned_by_other_user", None

    if product["sku"] == iap_links.SKU_PREMIUM:
        return _grant_premium(
            provider=provider,
            username=username,
            product_id=product_id,
            purchase_key=purchase_key,
            environment=environment,
            expires_at=expires_at,
        )

    if product["sku"] == iap_links.SKU_STEVE_PACKAGE:
        if not community_id:
            return False, "community_id_required", None
        steve_error = _steve_preflight(username=username, community_id=int(community_id))
        if steve_error:
            return False, steve_error, None
        return _grant_steve_package(
            provider=provider,
            username=username,
            product_id=product_id,
            purchase_key=purchase_key,
            community_id=int(community_id),
            environment=environment,
            expires_at=expires_at,
        )

    if not community_id:
        return False, "community_id_required", None
    tier_code = product["tier_code"]
    preflight_error = _community_preflight(
        provider=provider,
        username=username,
        community_id=int(community_id),
        tier_code=tier_code,
    )
    if preflight_error:
        return False, preflight_error, None
    return _grant_community(
        provider=provider,
        username=username,
        product_id=product_id,
        purchase_key=purchase_key,
        community_id=int(community_id),
        tier_code=tier_code,
        environment=environment,
        expires_at=expires_at,
    )


def apply_store_lifecycle(
    *,
    provider: str,
    purchase_key: Optional[str],
    action: str,
    expires_at: Any = None,
) -> None:
    """Apply webhook lifecycle events to the linked user/community."""
    if not purchase_key:
        return
    link = iap_links.find(provider, purchase_key)
    if not link:
        return
    sku = link.get("sku")
    username = str(link.get("username") or "")
    if sku == iap_links.SKU_PREMIUM:
        if action in ("renewed", "purchased", "active"):
            user_billing.mark_subscription(
                username,
                subscription="premium",
                subscription_id=purchase_key,
                status="active",
                current_period_end=expires_at,
                cancel_at_period_end=False,
                provider=provider,
            )
        elif action in ("cancelled", "expired"):
            user_billing.mark_subscription(
                username,
                subscription="free",
                subscription_id=purchase_key,
                status=action,
                current_period_end=expires_at,
                cancel_at_period_end=False,
                provider=provider,
            )
        subscription_audit.log(
            username=username,
            action=f"personal_premium_{action}",
            source=provider,
            metadata={"purchase_key": purchase_key},
        )
        return

    if sku == iap_links.SKU_STEVE_PACKAGE:
        community_id = int(link.get("community_id") or 0)
        if not community_id:
            return
        if action in ("renewed", "purchased", "active"):
            community_billing.mark_steve_package_subscription(
                community_id,
                subscription_id=purchase_key,
                status="active",
                current_period_end=expires_at,
                cancel_at_period_end=False,
            )
        elif action in ("cancelled", "expired"):
            community_billing.mark_steve_package_subscription(
                community_id,
                status="cancelled",
                current_period_end=expires_at,
                cancel_at_period_end=False,
            )
        subscription_audit.log(
            username=username,
            action=f"steve_package_{action}",
            source=provider,
            metadata={"community_id": community_id, "purchase_key": purchase_key},
        )
        return

    community_id = int(link.get("community_id") or 0)
    if not community_id:
        return
    if action in ("renewed", "purchased", "active"):
        community_billing.mark_subscription(
            community_id,
            tier_code=str(link.get("tier_code") or ""),
            subscription_id=purchase_key,
            status="active",
            current_period_end=expires_at,
            cancel_at_period_end=False,
            provider=provider,
        )
    elif action in ("cancelled", "expired"):
        community_billing.mark_subscription(
            community_id,
            status=action,
            current_period_end=expires_at,
            cancel_at_period_end=False,
            provider=provider,
        )
    subscription_audit.log(
        username=username,
        action=f"community_tier_{action}",
        source=provider,
        metadata={"community_id": community_id, "purchase_key": purchase_key},
    )


def decode_jws_payload(signed: str) -> Dict[str, Any]:
    if not signed:
        return {}
    try:
        parts = signed.split(".")
        if len(parts) < 2:
            return {}
        pad = "=" * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(parts[1] + pad).decode("utf-8"))
    except Exception:
        return {}


def _grant_premium(
    *,
    provider: str,
    username: str,
    product_id: str,
    purchase_key: str,
    environment: Optional[str],
    expires_at: Any,
) -> Tuple[bool, str, Dict[str, Any]]:
    iap_links.upsert_link(
        provider=provider,
        purchase_key=purchase_key,
        username=username,
        sku=iap_links.SKU_PREMIUM,
        product_id=product_id,
        status="active",
        environment=environment,
        expires_at=expires_at,
    )
    user_billing.mark_subscription(
        username,
        subscription="premium",
        subscription_id=purchase_key,
        status="active",
        current_period_end=expires_at,
        cancel_at_period_end=False,
        provider=provider,
    )
    subscription_audit.log(
        username=username,
        action="personal_premium_purchased",
        source=provider,
        metadata={"product_id": product_id, "purchase_key": purchase_key},
    )
    return True, "ok", {"subscription": "premium", "provider": provider}


def _grant_community(
    *,
    provider: str,
    username: str,
    product_id: str,
    purchase_key: str,
    community_id: int,
    tier_code: str,
    environment: Optional[str],
    expires_at: Any,
) -> Tuple[bool, str, Dict[str, Any]]:
    iap_links.upsert_link(
        provider=provider,
        purchase_key=purchase_key,
        username=username,
        sku=iap_links.SKU_COMMUNITY_TIER,
        community_id=community_id,
        tier_code=tier_code,
        product_id=product_id,
        status="active",
        environment=environment,
        expires_at=expires_at,
    )
    community_billing.mark_subscription(
        community_id,
        tier_code=tier_code,
        subscription_id=purchase_key,
        status="active",
        current_period_end=expires_at,
        cancel_at_period_end=False,
        provider=provider,
    )
    subscription_audit.log(
        username=username,
        action="community_tier_purchased",
        source=provider,
        metadata={
            "community_id": community_id,
            "tier_code": tier_code,
            "product_id": product_id,
            "purchase_key": purchase_key,
        },
    )
    return True, "ok", {
        "subscription": "community_tier",
        "provider": provider,
        "community_id": community_id,
        "tier_code": tier_code,
    }


def _grant_steve_package(
    *,
    provider: str,
    username: str,
    product_id: str,
    purchase_key: str,
    community_id: int,
    environment: Optional[str],
    expires_at: Any,
) -> Tuple[bool, str, Dict[str, Any]]:
    iap_links.upsert_link(
        provider=provider,
        purchase_key=purchase_key,
        username=username,
        sku=iap_links.SKU_STEVE_PACKAGE,
        community_id=community_id,
        product_id=product_id,
        status="active",
        environment=environment,
        expires_at=expires_at,
    )
    community_billing.mark_steve_package_subscription(
        community_id,
        subscription_id=purchase_key,
        status="active",
        current_period_end=expires_at,
        cancel_at_period_end=False,
    )
    subscription_audit.log(
        username=username,
        action="steve_package_purchased",
        source=provider,
        metadata={
            "community_id": community_id,
            "product_id": product_id,
            "purchase_key": purchase_key,
        },
    )
    return True, "ok", {
        "subscription": "steve_package",
        "provider": provider,
        "community_id": community_id,
    }


def _steve_preflight(*, username: str, community_id: int) -> Optional[str]:
    """Return error code or None when Steve IAP purchase is allowed."""
    if not community_svc.is_community_owner(username, community_id):
        return "not_owner"
    root_id, is_root = community_svc.resolve_root_community_id(community_id)
    if not is_root or int(root_id) != int(community_id):
        return "not_root_community"
    if community_billing.has_active_steve_package(community_id):
        return "steve_package_already_active"
    state = community_billing.get_billing_state(community_id) or {}
    kb_fields = _kb_field_map("community-tiers")
    ent_incl = _truthy(kb_fields.get("enterprise_steve_package_included"), default=True)
    health = subscription_health.derive_community_subscription_health(
        state,
        enterprise_steve_package_included=ent_incl,
    )
    if health.get("steve_addon_eligible"):
        return None
    reason = str(health.get("steve_addon_reason") or "")
    if reason == "steve_already_active":
        return "steve_package_already_active"
    if reason == "enterprise_included":
        return "steve_package_redundant"
    if reason in ("tier_not_paid", "tier_subscription_inactive"):
        return "community_subscription_inactive"
    return "community_subscription_inactive"


def _community_preflight(
    *, provider: str, username: str, community_id: int, tier_code: str
) -> Optional[str]:
    root_id, is_root = community_svc.resolve_root_community_id(community_id)
    if not is_root or int(root_id) != int(community_id):
        return "not_root_community"
    if not community_svc.is_community_owner(username, community_id):
        return "not_owner"
    existing = iap_links.active_community_for_user(provider, username)
    if existing:
        existing_id = int(existing.get("community_id") or 0)
        if existing_id and existing_id != int(community_id):
            return "store_community_limit"
    state = community_billing.get_billing_state(community_id) or {}
    billing_provider = str(state.get("billing_provider") or "stripe").lower()
    if state.get("stripe_subscription_id") and billing_provider not in ("", provider):
        return f"{billing_provider}_billing_active"
    cap = _tier_member_cap(tier_code)
    members = _count_members(community_id)
    if cap is not None and members > cap:
        return "tier_too_small"
    return None


def _resolve_product(provider: str, product_id: str) -> Optional[Dict[str, str]]:
    cfg = config()
    provider_cfg = cfg.get(provider) or {}
    if product_id == provider_cfg.get("premium_product_id"):
        return {"sku": iap_links.SKU_PREMIUM}
    for tier_code, tier_product_id in (provider_cfg.get("community_product_ids") or {}).items():
        if product_id == tier_product_id:
            return {"sku": iap_links.SKU_COMMUNITY_TIER, "tier_code": tier_code}
    if product_id == provider_cfg.get("steve_product_id"):
        return {"sku": iap_links.SKU_STEVE_PACKAGE}
    return None


def _kb_field_map(slug: str) -> Dict[str, Any]:
    try:
        page = knowledge_base.get_page(slug) or {}
    except Exception:
        return {}
    out: Dict[str, Any] = {}
    for f in page.get("fields") or []:
        name = f.get("name")
        if name:
            out[str(name)] = f.get("value")
    return out


def _field(fields: Dict[str, Any], name: str) -> str:
    return str(fields.get(name) or DEFAULT_PRODUCT_IDS.get(name) or "").strip()


def _truthy(raw: Any, *, default: bool = False) -> bool:
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    text = str(raw).strip().lower()
    if text in ("1", "true", "yes", "on"):
        return True
    if text in ("0", "false", "no", "off", ""):
        return False
    return bool(raw)


def _grants_allowed(environment: Optional[str]) -> bool:
    env = (environment or "").strip().lower()
    if env in ("sandbox", "xcode", "test", "license_test"):
        return True
    return bool(config().get("iap_purchases_enabled"))


def _tier_member_cap(tier_code: str) -> Optional[int]:
    fields = _kb_field_map("community-tiers")
    try:
        cap = int(fields.get(f"{tier_code}_max_members") or 0)
    except (TypeError, ValueError):
        return None
    return cap if cap > 0 else None


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
    return int(row[0] if isinstance(row, (list, tuple)) else row or 0)


def _expires_from_payload(payload: Dict[str, Any]) -> Optional[str]:
    for key in ("expiresDate", "expires_date", "expiryTimeMillis"):
        raw = payload.get(key)
        if raw in (None, ""):
            continue
        try:
            timestamp = int(raw)
            if timestamp > 1_000_000_000_000:
                timestamp = timestamp // 1000
            return datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime(
                "%Y-%m-%d %H:%M:%S"
            )
        except Exception:
            continue
    return None
