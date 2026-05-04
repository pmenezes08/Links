"""KB-backed snippets for onboarding copy and setup guidance."""

from __future__ import annotations

from typing import Any, Dict, Optional

from backend.services import knowledge_base as kb
from backend.services.entitlements import resolve_entitlements


def _field(page_slug: str, field_name: str, default: Any) -> Any:
    try:
        page = kb.get_page(page_slug)
    except Exception:
        page = None
    if not page:
        return default
    for f in page.get("fields") or []:
        if f.get("name") == field_name and "value" in f:
            return f["value"]
    return default


def _community_tier_hints() -> Dict[str, Any]:
    free_max = _field("community-tiers", "free_community_max_members", 25)
    paid_l1_max = _field("community-tiers", "paid_l1_max_members", 75)
    paid_l2_max = _field("community-tiers", "paid_l2_max_members", 150)
    paid_l3_max = _field("community-tiers", "paid_l3_max_members", 250)
    return {
        "free": {
            "label": "Free Community",
            "max_members": free_max,
        },
        "paid_l1": {
            "label": "Paid L1",
            "price_eur_monthly": _field("community-tiers", "paid_l1_price_eur_monthly", 25),
            "max_members": paid_l1_max,
            "min_members": int(free_max) + 1,
        },
        "paid_l2": {
            "label": "Paid L2",
            "price_eur_monthly": _field("community-tiers", "paid_l2_price_eur_monthly", 50),
            "max_members": paid_l2_max,
            "min_members": int(paid_l1_max) + 1,
        },
        "paid_l3": {
            "label": "Paid L3",
            "price_eur_monthly": _field("community-tiers", "paid_l3_price_eur_monthly", 80),
            "max_members": paid_l3_max,
            "min_members": int(paid_l2_max) + 1,
        },
        "enterprise": {
            "label": "Enterprise",
            "min_members": int(paid_l3_max) + 1,
            "pricing": "custom",
        },
    }


def build_onboarding_tier_hints(username: str) -> Dict[str, Any]:
    ent = resolve_entitlements(username) or {}
    free_media_gb = _field("community-tiers", "free_community_media_gb", 1)
    return {
        "communities_max": ent.get("communities_max"),
        "members_per_owned_community": ent.get("members_per_owned_community"),
        "free_community_media_gb": free_media_gb,
        "community_tiers": _community_tier_hints(),
        "can_use_steve": bool(ent.get("can_use_steve")),
    }
