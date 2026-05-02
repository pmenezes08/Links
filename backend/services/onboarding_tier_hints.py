"""KB-backed snippets for onboarding copy (free tier + Premium Steve)."""

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


def build_onboarding_tier_hints(username: str) -> Dict[str, Any]:
    ent = resolve_entitlements(username) or {}
    free_media_gb = _field("community-tiers", "free_community_media_gb", 1)
    return {
        "communities_max": ent.get("communities_max"),
        "members_per_owned_community": ent.get("members_per_owned_community"),
        "free_community_media_gb": free_media_gb,
        "can_use_steve": bool(ent.get("can_use_steve")),
    }
