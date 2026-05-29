"""Shared Steve model, token-cap, and cost configuration.

All model prices in this module mirror the official xAI Grok 4.3 docs:
https://docs.x.ai/developers/models/grok-4.3 and
https://docs.x.ai/developers/pricing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional, Tuple

from backend.services import knowledge_base

logger = logging.getLogger(__name__)

OFFICIAL_XAI_PRICING_SOURCE = (
    "https://docs.x.ai/developers/models/grok-4.3 + "
    "https://docs.x.ai/developers/pricing"
)


@dataclass(frozen=True)
class SteveModelConfig:
    model: str = "grok-4.3"
    input_usd_per_million: float = 1.25
    cached_input_usd_per_million: float = 0.20
    output_usd_per_million: float = 2.50
    tool_call_usd_per_1000: float = 5.00
    max_output_tokens_dm: int = 1400
    max_output_tokens_feed: int = 1400
    max_output_tokens_group: int = 1500
    max_context_messages: int = 200
    max_context_messages_peer_dm: int = 60


def get_steve_model_config(
    *,
    credits_fields: Optional[dict[str, Any]] = None,
    hard_limit_fields: Optional[dict[str, Any]] = None,
) -> SteveModelConfig:
    """Return Steve model/cost settings from KB-backed fields.

    Missing or malformed values fall back to official xAI Grok 4.3 pricing and
    conservative token caps so a KB issue cannot make Steve unbounded.
    """

    defaults = SteveModelConfig()
    credits = credits_fields if credits_fields is not None else _field_map("credits-entitlements")
    hard_limits = hard_limit_fields if hard_limit_fields is not None else _field_map("hard-limits")

    return SteveModelConfig(
        model=_str(credits.get("model_primary"), defaults.model),
        input_usd_per_million=_float(
            credits.get("model_primary_input_per_m_usd"),
            defaults.input_usd_per_million,
            minimum=0,
        ),
        cached_input_usd_per_million=_float(
            credits.get("model_primary_cached_input_per_m_usd"),
            defaults.cached_input_usd_per_million,
            minimum=0,
        ),
        output_usd_per_million=_float(
            credits.get("model_primary_output_per_m_usd"),
            defaults.output_usd_per_million,
            minimum=0,
        ),
        tool_call_usd_per_1000=_float(
            credits.get("tool_call_per_1000_usd"),
            defaults.tool_call_usd_per_1000,
            minimum=0,
        ),
        max_output_tokens_dm=_int(
            hard_limits.get("max_output_tokens_dm"),
            defaults.max_output_tokens_dm,
            minimum=1,
        ),
        max_output_tokens_feed=_int(
            hard_limits.get("max_output_tokens_feed"),
            defaults.max_output_tokens_feed,
            minimum=1,
        ),
        max_output_tokens_group=_int(
            hard_limits.get("max_output_tokens_group"),
            defaults.max_output_tokens_group,
            minimum=1,
        ),
        max_context_messages=_int(
            hard_limits.get("max_context_messages"),
            defaults.max_context_messages,
            minimum=1,
        ),
        max_context_messages_peer_dm=_int(
            hard_limits.get("max_context_messages_peer_dm"),
            defaults.max_context_messages_peer_dm,
            minimum=1,
        ),
    )


def output_cap_for_surface(entitlements: Optional[dict[str, Any]], surface: str, fallback: int) -> int:
    """Read the resolved entitlement cap for a Steve surface."""

    key = {
        "dm": "max_output_tokens_dm",
        "feed": "max_output_tokens_feed",
        "group": "max_output_tokens_group",
    }.get(surface)
    if not key:
        return max(1, int(fallback or 1))
    value = (entitlements or {}).get(key)
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return max(1, int(fallback or 1))


def context_limit(entitlements: Optional[dict[str, Any]], fallback: int = 200) -> int:
    value = (entitlements or {}).get("max_context_messages")
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return max(1, int(fallback or 1))


def peer_context_limit(entitlements: Optional[dict[str, Any]], fallback: int = 10) -> int:
    """Context window for peer DMs (@Steve in a human-human DM).

    Defaults to the legacy ``PEER_DM_CONTEXT_LINES`` (10) when the KB
    field is missing, so a broken KB seed can never silently widen the
    window.
    """
    value = (entitlements or {}).get("max_context_messages_peer_dm")
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return max(1, int(fallback or 1))


def estimate_call_cost_usd(
    tokens_in: Optional[int],
    tokens_out: Optional[int],
    config: Optional[Any] = None,
    *,
    cached_input_tokens: Optional[int] = None,
) -> float:
    """Estimate xAI token cost using official per-million token prices."""

    cfg = config or get_steve_model_config()
    input_rate = _config_float(cfg, "input_usd_per_million", "model_input_usd_per_million", default=1.25)
    cached_rate = _config_float(cfg, "cached_input_usd_per_million", default=0.20)
    output_rate = _config_float(cfg, "output_usd_per_million", "model_output_usd_per_million", default=2.50)

    tin = max(0, int(tokens_in or 0))
    cached = min(tin, max(0, int(cached_input_tokens or 0)))
    uncached = tin - cached
    tout = max(0, int(tokens_out or 0))
    return round(
        (uncached / 1_000_000.0) * input_rate
        + (cached / 1_000_000.0) * cached_rate
        + (tout / 1_000_000.0) * output_rate,
        6,
    )


def response_usage_tokens(response: Any) -> Tuple[Optional[int], Optional[int]]:
    """Best-effort extraction for OpenAI-compatible Responses/Chat objects."""

    usage = _get(response, "usage")
    if not usage:
        return None, None
    tokens_in = (
        _get(usage, "input_tokens")
        or _get(usage, "prompt_tokens")
        or _get(usage, "input_tokens_details", "total_tokens")
    )
    tokens_out = (
        _get(usage, "output_tokens")
        or _get(usage, "completion_tokens")
        or _get(usage, "output_tokens_details", "total_tokens")
    )
    total = _get(usage, "total_tokens")
    if tokens_out is None and total is not None and tokens_in is not None:
        try:
            tokens_out = int(total) - int(tokens_in)
        except Exception:
            tokens_out = None
    return _optional_int(tokens_in), _optional_int(tokens_out)


def response_cached_input_tokens(response: Any) -> Optional[int]:
    """Extract cached prompt tokens when the provider reports them."""

    usage = _get(response, "usage")
    if not usage:
        return None
    cached = (
        _get(usage, "input_tokens_details", "cached_tokens")
        or _get(usage, "prompt_tokens_details", "cached_tokens")
        or _get(usage, "cached_input_tokens")
    )
    return _optional_int(cached)


def estimate_response_cost_usd(response: Any, config: Optional[Any] = None) -> float:
    tokens_in, tokens_out = response_usage_tokens(response)
    return estimate_call_cost_usd(
        tokens_in,
        tokens_out,
        config,
        cached_input_tokens=response_cached_input_tokens(response),
    )


def _field_map(slug: str) -> dict[str, Any]:
    try:
        page = knowledge_base.get_page(slug) or {}
    except Exception as exc:
        logger.warning("Could not load %s KB for Steve model config: %s", slug, exc)
        return {}
    out: dict[str, Any] = {}
    for field in page.get("fields") or []:
        name = field.get("name")
        if name:
            out[str(name)] = field.get("value")
    return out


def _float(raw: Any, default: float, *, minimum: Optional[float] = None) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = default
    if minimum is not None:
        value = max(minimum, value)
    return value


def _int(raw: Any, default: int, *, minimum: Optional[int] = None) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = default
    if minimum is not None:
        value = max(minimum, value)
    return value


def _str(raw: Any, default: str) -> str:
    text = str(raw or "").strip()
    return text or default


def _get(obj: Any, *path: str) -> Any:
    cur = obj
    for key in path:
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(key)
        else:
            cur = getattr(cur, key, None)
    return cur


def _optional_int(raw: Any) -> Optional[int]:
    if raw is None:
        return None
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return None


def _config_float(config: Any, *names: str, default: float) -> float:
    for name in names:
        value = getattr(config, name, None)
        if value is not None:
            try:
                return max(0.0, float(value))
            except (TypeError, ValueError):
                pass
    return default
