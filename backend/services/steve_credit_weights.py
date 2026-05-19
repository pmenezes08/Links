"""KB-backed Steve credit debit math (personal allowance + community pool).

User-facing allowance stays ``steve_uses_per_month`` (e.g. 100). Each successful
Steve row stores ``credits_debited``; counters SUM debits instead of COUNT(*)
when :func:`backend.services.feature_flags.steve_weighted_credits_enabled` is on.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

from backend.services import ai_usage
from backend.services.entitlements import _kb_field_value

logger = logging.getLogger(__name__)

# Non-LLM or zero-cost Steve paths — do not debit personal/pool credits.
_ZERO_CREDIT_REQUEST_TYPES = frozenset(
    {
        "steve_dm_feedback",
        "steve_reminder_vault",
        "blocked:monthly_steve_cap",
        "blocked:daily_cap",
    }
)

_DEFAULT_RULES: Dict[str, Any] = {
    "internal_weights": {
        "dm": 1,
        "group": 3,
        "feed": 3,
        "post_summary": 2,
        "voice_summary": 2,
        "translation": 1,
        "networking_steve": 2,
    },
    "credit_tier_slim_max_tokens_in": 4000,
    "credit_tier_standard_max_tokens_in": 25000,
    "credit_tier_slim_weight": 1,
    "credit_tier_standard_weight": 2,
    "credit_tier_heavy_weight": 3,
    "credit_addon_web_search": 0.5,
    "credit_addon_x_search": 1.0,
    "credit_addon_tool_router": 0.5,
    "max_credits_per_call": 10.0,
}


@dataclass(frozen=True)
class CreditRules:
    surface_weights: Dict[str, float]
    tier_slim_max: int
    tier_standard_max: int
    tier_slim: float
    tier_standard: float
    tier_heavy: float
    addon_web: float
    addon_x: float
    addon_router: float
    max_per_call: float


def _float(v: Any, default: float) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _int(v: Any, default: int) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def load_credit_rules() -> CreditRules:
    weights = _kb_field_value("credits-entitlements", "internal_weights", None)
    if not isinstance(weights, dict) or not weights:
        weights = _DEFAULT_RULES["internal_weights"]
    return CreditRules(
        surface_weights={str(k): _float(v, 1.0) for k, v in weights.items()},
        tier_slim_max=_int(
            _kb_field_value(
                "credits-entitlements",
                "credit_tier_slim_max_tokens_in",
                _DEFAULT_RULES["credit_tier_slim_max_tokens_in"],
            ),
            _DEFAULT_RULES["credit_tier_slim_max_tokens_in"],
        ),
        tier_standard_max=_int(
            _kb_field_value(
                "credits-entitlements",
                "credit_tier_standard_max_tokens_in",
                _DEFAULT_RULES["credit_tier_standard_max_tokens_in"],
            ),
            _DEFAULT_RULES["credit_tier_standard_max_tokens_in"],
        ),
        tier_slim=_float(
            _kb_field_value(
                "credits-entitlements", "credit_tier_slim_weight", _DEFAULT_RULES["credit_tier_slim_weight"]
            ),
            _DEFAULT_RULES["credit_tier_slim_weight"],
        ),
        tier_standard=_float(
            _kb_field_value(
                "credits-entitlements",
                "credit_tier_standard_weight",
                _DEFAULT_RULES["credit_tier_standard_weight"],
            ),
            _DEFAULT_RULES["credit_tier_standard_weight"],
        ),
        tier_heavy=_float(
            _kb_field_value(
                "credits-entitlements", "credit_tier_heavy_weight", _DEFAULT_RULES["credit_tier_heavy_weight"]
            ),
            _DEFAULT_RULES["credit_tier_heavy_weight"],
        ),
        addon_web=_float(
            _kb_field_value(
                "credits-entitlements", "credit_addon_web_search", _DEFAULT_RULES["credit_addon_web_search"]
            ),
            _DEFAULT_RULES["credit_addon_web_search"],
        ),
        addon_x=_float(
            _kb_field_value(
                "credits-entitlements", "credit_addon_x_search", _DEFAULT_RULES["credit_addon_x_search"]
            ),
            _DEFAULT_RULES["credit_addon_x_search"],
        ),
        addon_router=_float(
            _kb_field_value(
                "credits-entitlements", "credit_addon_tool_router", _DEFAULT_RULES["credit_addon_tool_router"]
            ),
            _DEFAULT_RULES["credit_addon_tool_router"],
        ),
        max_per_call=_float(
            _kb_field_value(
                "credits-entitlements", "max_credits_per_call", _DEFAULT_RULES["max_credits_per_call"]
            ),
            _DEFAULT_RULES["max_credits_per_call"],
        ),
    )


def legacy_surface_weight(surface: str, rules: Optional[CreditRules] = None) -> float:
    r = rules or load_credit_rules()
    key = (surface or "").strip().lower()
    return r.surface_weights.get(key, 1.0)


def _tier_weight(tokens_in: Optional[int], rules: CreditRules) -> float:
    ti = int(tokens_in or 0)
    if ti <= rules.tier_slim_max:
        return rules.tier_slim
    if ti <= rules.tier_standard_max:
        return rules.tier_standard
    return rules.tier_heavy


def tools_flags_from_hosted_tools(tools: Optional[list]) -> Tuple[bool, bool]:
    web = False
    x_search = False
    for t in tools or []:
        if not isinstance(t, dict):
            continue
        typ = (t.get("type") or "").strip().lower()
        if typ == "web_search":
            web = True
        elif typ in ("x_search", "x"):
            x_search = True
    return web, x_search


def compute_credits_debited(
    *,
    surface: str,
    request_type: Optional[str] = None,
    tokens_in: Optional[int] = None,
    tools_web_search: bool = False,
    tools_x_search: bool = False,
    router_pass_in_turn: bool = False,
    rules: Optional[CreditRules] = None,
) -> Tuple[float, Dict[str, Any]]:
    """Return (credits, meta dict) for one successful Steve log row."""
    r = rules or load_credit_rules()
    rtype = (request_type or surface or "").strip().lower()

    if rtype in _ZERO_CREDIT_REQUEST_TYPES or rtype.startswith("blocked:"):
        return 0.0, {"reason": "zero_credit_request_type", "request_type": rtype}

    if rtype == "steve_tool_router":
        deb = min(r.max_per_call, r.addon_router)
        return round(deb, 2), {"component": "tool_router", "debit": deb}

    surf = (surface or "").strip().lower()
    surface_floor = legacy_surface_weight(surf, r)
    tier_w = _tier_weight(tokens_in, r)
    base = max(surface_floor, tier_w)
    addon = 0.0
    if tools_web_search:
        addon += r.addon_web
    if tools_x_search:
        addon += r.addon_x
    if router_pass_in_turn:
        addon += r.addon_router

    raw = base + addon
    deb = min(r.max_per_call, raw)
    meta = {
        "surface_floor": surface_floor,
        "tier_weight": tier_w,
        "base": base,
        "addon_web": r.addon_web if tools_web_search else 0,
        "addon_x": r.addon_x if tools_x_search else 0,
        "addon_router": r.addon_router if router_pass_in_turn else 0,
        "tokens_in": tokens_in,
    }
    return round(deb, 2), meta


def estimate_credits_debited(
    surface: str,
    *,
    heavy_tools: bool = False,
    include_router: bool = True,
) -> float:
    """Conservative pre-gate estimate before the main LLM call."""
    surf = (surface or "").strip().lower()
    if surf in (ai_usage.SURFACE_FEED, ai_usage.SURFACE_GROUP):
        tokens = 12000 if heavy_tools else 8000
        web = heavy_tools
        x_search = heavy_tools
    elif surf == ai_usage.SURFACE_POST_SUMMARY:
        tokens = 4000
        web = False
        x_search = False
    else:
        tokens = 2000
        web = False
        x_search = False

    deb, _ = compute_credits_debited(
        surface=surface,
        tokens_in=tokens,
        tools_web_search=web,
        tools_x_search=x_search,
        router_pass_in_turn=include_router and surf in (ai_usage.SURFACE_FEED, ai_usage.SURFACE_GROUP, ai_usage.SURFACE_DM),
    )
    return deb


def credits_meta_json(meta: Dict[str, Any]) -> str:
    try:
        return json.dumps(meta, separators=(",", ":"))[:500]
    except Exception:
        return "{}"


def display_credits_used(total: float) -> int:
    """User-facing X in 'X of 100' — round half-up to nearest int."""
    return int(round(total))
