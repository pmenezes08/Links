"""Cross-platform billing ownership guards.

The billing rails are provider-specific (Stripe, App Store, Google Play), but
the business invariant is shared: one active owner controls a product scope
until that subscription is inactive.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from backend.services import community_billing, iap_links, user_billing
from backend.services.community import resolve_root_community_id


PROVIDER_STRIPE = "stripe"
PROVIDER_APPLE = "apple"
PROVIDER_GOOGLE = "google"

PRODUCT_PREMIUM = "premium"
PRODUCT_COMMUNITY_TIER = "community_tier"
PRODUCT_STEVE_PACKAGE = "steve_package"
PRODUCT_NETWORKING_PACKAGE = "networking_package"

DECISION_ALLOWED = "allowed"
DECISION_SAME_SUBSCRIPTION = "same_subscription"
DECISION_ALREADY_ACTIVE_SAME_PROVIDER = "already_active_same_provider"
DECISION_ALREADY_ACTIVE_OTHER_PROVIDER = "already_active_other_provider"
DECISION_MANAGED_BY_OTHER_PROVIDER = "managed_by_other_provider"
DECISION_MODE_MISMATCH = "mode_mismatch"
DECISION_NEEDS_RECONCILIATION = "needs_reconciliation"

ACTIVE_STATUSES = {"active", "trialing"}
STORE_ENV_LIVE = {"production", "prod", "live"}
STORE_ENV_TEST = {"sandbox", "xcode", "license_test", "test", "testing"}


@dataclass(frozen=True)
class BillingOwner:
    provider: str
    product_family: str
    scope_type: str
    scope_id: str
    status: str
    subscription_id: Optional[str] = None
    purchase_key: Optional[str] = None
    mode: Optional[str] = None
    source: str = "unknown"


@dataclass(frozen=True)
class OwnershipDecision:
    decision: str
    allowed: bool
    reason: str
    owner: Optional[BillingOwner] = None
    candidates: tuple[BillingOwner, ...] = ()

    def payload(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "reason": self.reason,
            "billing_ownership_decision": self.decision,
        }
        if self.owner:
            out.update({
                "billing_provider": self.owner.provider,
                "current_provider": self.owner.provider,
                "current_mode": self.owner.mode,
                "product_family": self.owner.product_family,
                "scope_type": self.owner.scope_type,
                "scope_id": self.owner.scope_id,
            })
        if self.candidates:
            out["billing_owner_candidates"] = [
                _owner_payload(candidate) for candidate in self.candidates
            ]
        return out


def check_premium(
    username: str,
    *,
    incoming_provider: str,
    incoming_mode: Optional[str] = None,
    incoming_id: Optional[str] = None,
) -> OwnershipDecision:
    incoming_provider = _provider(incoming_provider)
    incoming_mode = normalize_mode(incoming_mode, incoming_provider)
    candidates = active_premium_owners(username)
    return _decide(
        candidates,
        incoming_provider=incoming_provider,
        incoming_mode=incoming_mode,
        incoming_id=incoming_id,
        default_scope_type="user",
        default_scope_id=username,
        product_family=PRODUCT_PREMIUM,
    )


def check_community(
    community_id: int,
    *,
    product_family: str,
    incoming_provider: str,
    incoming_mode: Optional[str] = None,
    incoming_id: Optional[str] = None,
) -> OwnershipDecision:
    root_id, _ = resolve_root_community_id(int(community_id))
    incoming_provider = _provider(incoming_provider)
    incoming_mode = normalize_mode(incoming_mode, incoming_provider)
    candidates = active_community_owners(int(root_id))
    return _decide(
        candidates,
        incoming_provider=incoming_provider,
        incoming_mode=incoming_mode,
        incoming_id=incoming_id,
        default_scope_type="community",
        default_scope_id=str(root_id),
        product_family=product_family,
    )


def active_premium_owners(username: str) -> List[BillingOwner]:
    owners: List[BillingOwner] = []
    state = user_billing.get_billing_state(username) or {}
    provider = _provider(state.get("subscription_provider") or PROVIDER_STRIPE)
    status = _status(state.get("subscription_status"))
    subscription = str(state.get("subscription") or "").strip().lower()
    if status in ACTIVE_STATUSES or subscription in ("premium", "pro", "paid"):
        sub_id = _text(state.get("stripe_subscription_id"))
        owners.append(BillingOwner(
            provider=provider,
            product_family=PRODUCT_PREMIUM,
            scope_type="user",
            scope_id=username,
            status=status or "active",
            subscription_id=sub_id,
            purchase_key=sub_id if provider in (PROVIDER_APPLE, PROVIDER_GOOGLE) else None,
            mode=normalize_mode(state.get("stripe_mode"), provider),
            source="users",
        ))
    for link in iap_links.list_for_user(username):
        if str(link.get("sku") or "") != iap_links.SKU_PREMIUM:
            continue
        status = _status(link.get("status")) or "active"
        if status not in ACTIVE_STATUSES:
            continue
        provider = _provider(link.get("provider"))
        owners.append(BillingOwner(
            provider=provider,
            product_family=PRODUCT_PREMIUM,
            scope_type="user",
            scope_id=username,
            status=status,
            purchase_key=_text(link.get("purchase_key")),
            subscription_id=_text(link.get("purchase_key")),
            mode=normalize_mode(link.get("environment"), provider),
            source="iap_links",
        ))
    return _dedupe(owners)


def active_community_owners(root_community_id: int) -> List[BillingOwner]:
    owners: List[BillingOwner] = []
    state = community_billing.get_billing_state(int(root_community_id)) or {}
    provider = _provider(state.get("billing_provider") or PROVIDER_STRIPE)
    mode = normalize_mode(state.get("stripe_mode"), provider)
    tier_status = _status(state.get("subscription_status"))
    if state.get("stripe_subscription_id") and tier_status in ACTIVE_STATUSES:
        owners.append(BillingOwner(
            provider=provider,
            product_family=PRODUCT_COMMUNITY_TIER,
            scope_type="community",
            scope_id=str(root_community_id),
            status=tier_status,
            subscription_id=_text(state.get("stripe_subscription_id")),
            purchase_key=_text(state.get("stripe_subscription_id")) if provider != PROVIDER_STRIPE else None,
            mode=mode,
            source="communities",
        ))
    steve_status = _status(state.get("steve_package_subscription_status"))
    if (
        state.get("steve_package_stripe_subscription_id")
        and steve_status in ACTIVE_STATUSES
        # The synthetic 14-day package trial has no provider subscription
        # behind it, so it must not claim billing ownership (it would block
        # the owner from buying the real package via any provider).
        and not community_billing.is_synthetic_steve_package_trial(state)
    ):
        owners.append(BillingOwner(
            provider=provider,
            product_family=PRODUCT_STEVE_PACKAGE,
            scope_type="community",
            scope_id=str(root_community_id),
            status=steve_status,
            subscription_id=_text(state.get("steve_package_stripe_subscription_id")),
            mode=mode,
            source="communities.steve_package",
        ))
    for link in iap_links.list_for_community(int(root_community_id)):
        sku = str(link.get("sku") or "")
        if sku not in (iap_links.SKU_COMMUNITY_TIER, iap_links.SKU_STEVE_PACKAGE):
            continue
        status = _status(link.get("status")) or "active"
        if status not in ACTIVE_STATUSES:
            continue
        product_family = (
            PRODUCT_STEVE_PACKAGE
            if sku == iap_links.SKU_STEVE_PACKAGE
            else PRODUCT_COMMUNITY_TIER
        )
        provider = _provider(link.get("provider"))
        owners.append(BillingOwner(
            provider=provider,
            product_family=product_family,
            scope_type="community",
            scope_id=str(root_community_id),
            status=status,
            purchase_key=_text(link.get("purchase_key")),
            subscription_id=_text(link.get("purchase_key")),
            mode=normalize_mode(link.get("environment"), provider),
            source="iap_links",
        ))
    return _dedupe(owners)


def log_conflict(subscription_audit, *, username: str, action: str, decision: OwnershipDecision) -> None:
    if decision.allowed:
        return
    try:
        subscription_audit.log(
            username=username or "",
            action=action,
            source="billing_ownership",
            reason=decision.reason,
            metadata=decision.payload(),
        )
    except Exception:
        pass


def normalize_mode(value: Any, provider: str = PROVIDER_STRIPE) -> Optional[str]:
    text = str(value or "").strip().lower()
    provider = _provider(provider)
    if not text:
        return None
    if provider == PROVIDER_STRIPE:
        return "live" if text == "live" else "test"
    if text in STORE_ENV_LIVE:
        return "live"
    if text in STORE_ENV_TEST:
        return "test"
    return text


def _decide(
    candidates: List[BillingOwner],
    *,
    incoming_provider: str,
    incoming_mode: Optional[str],
    incoming_id: Optional[str],
    default_scope_type: str,
    default_scope_id: str,
    product_family: str,
) -> OwnershipDecision:
    incoming_id = _text(incoming_id)
    if not candidates:
        return OwnershipDecision(
            decision=DECISION_ALLOWED,
            allowed=True,
            reason=DECISION_ALLOWED,
        )

    same = _same_subscription(candidates, incoming_provider, incoming_id)
    if same:
        other_provider = [c for c in candidates if c.provider != incoming_provider]
        if other_provider:
            return OwnershipDecision(
                decision=DECISION_NEEDS_RECONCILIATION,
                allowed=False,
                reason=DECISION_NEEDS_RECONCILIATION,
                owner=same,
                candidates=tuple(candidates),
            )
        if incoming_mode and same.mode and incoming_mode != same.mode:
            return OwnershipDecision(
                decision=DECISION_MODE_MISMATCH,
                allowed=False,
                reason=DECISION_MODE_MISMATCH,
                owner=same,
                candidates=tuple(candidates),
            )
        return OwnershipDecision(
            decision=DECISION_SAME_SUBSCRIPTION,
            allowed=True,
            reason=DECISION_SAME_SUBSCRIPTION,
            owner=same,
            candidates=tuple(candidates),
        )

    provider_owners = [c for c in candidates if c.provider == incoming_provider]
    if provider_owners:
        owner = provider_owners[0]
        if incoming_mode and owner.mode and incoming_mode != owner.mode:
            return OwnershipDecision(
                decision=DECISION_MODE_MISMATCH,
                allowed=False,
                reason=DECISION_MODE_MISMATCH,
                owner=owner,
                candidates=tuple(candidates),
            )
        return OwnershipDecision(
            decision=DECISION_ALREADY_ACTIVE_SAME_PROVIDER,
            allowed=False,
            reason=DECISION_ALREADY_ACTIVE_SAME_PROVIDER,
            owner=owner,
            candidates=tuple(candidates),
        )

    owner = candidates[0]
    reason = (
        DECISION_MANAGED_BY_OTHER_PROVIDER
        if default_scope_type == "community"
        else DECISION_ALREADY_ACTIVE_OTHER_PROVIDER
    )
    return OwnershipDecision(
        decision=reason,
        allowed=False,
        reason=reason,
        owner=owner,
        candidates=tuple(candidates),
    )


def _same_subscription(candidates: List[BillingOwner], provider: str, incoming_id: Optional[str]) -> Optional[BillingOwner]:
    if not incoming_id:
        return None
    for candidate in candidates:
        if candidate.provider != provider:
            continue
        if incoming_id in (candidate.subscription_id, candidate.purchase_key):
            return candidate
    return None


def _dedupe(owners: List[BillingOwner]) -> List[BillingOwner]:
    seen = set()
    out: List[BillingOwner] = []
    for owner in owners:
        key = (owner.provider, owner.product_family, owner.scope_type, owner.scope_id, owner.subscription_id, owner.purchase_key)
        if key in seen:
            continue
        seen.add(key)
        out.append(owner)
    return out


def _owner_payload(owner: BillingOwner) -> Dict[str, Any]:
    return {
        "provider": owner.provider,
        "product_family": owner.product_family,
        "scope_type": owner.scope_type,
        "scope_id": owner.scope_id,
        "status": owner.status,
        "subscription_id": owner.subscription_id,
        "purchase_key": owner.purchase_key,
        "mode": owner.mode,
        "source": owner.source,
    }


def _provider(value: Any) -> str:
    text = str(value or "").strip().lower()
    return text or PROVIDER_STRIPE


def _status(value: Any) -> str:
    return str(value or "").strip().lower()


def _text(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None
