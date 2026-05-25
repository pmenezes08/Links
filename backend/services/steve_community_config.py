"""KB-backed Steve Community package configuration and cost helpers."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

from backend.services import knowledge_base
from backend.services.steve_model_config import (
    estimate_call_cost_usd as _estimate_call_cost_usd,
    response_usage_tokens,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SteveCommunityConfig:
    monthly_credit_pool: int = 200
    monthly_provider_cost_ceiling_usd: float = 19.99
    provider_cost_reservation_usd: float = 0.03
    model: str = "grok-4.3"
    model_input_usd_per_million: float = 1.25
    model_output_usd_per_million: float = 2.50
    multi_agent_enabled: bool = False
    web_search_default_enabled: bool = False
    x_search_default_enabled: bool = False
    external_search_explicit_only: bool = True
    feed_attach_web_search_tool: bool = True
    feed_attach_x_search_tool: bool = True
    max_output_tokens: int = 1400
    recent_comments_limit: int = 24
    thread_chars_max: int = 12000
    doc_excerpt_chars_default: int = 2000
    doc_excerpt_chars_deep: int = 4000
    docs_limit: int = 10
    links_limit: int = 10
    events_limit: int = 10
    polls_limit: int = 5
    images_limit: int = 4
    context_degrade_before_block: bool = True


def _field_map() -> dict[str, Any]:
    try:
        page = knowledge_base.get_page("community-tiers") or {}
    except Exception as exc:
        logger.warning("Could not load community-tiers KB for Steve config: %s", exc)
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


def _bool(raw: Any, default: bool) -> bool:
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


def _str(raw: Any, default: str) -> str:
    text = str(raw or "").strip()
    return text or default


def get_paid_steve_package_config(fields: Optional[dict[str, Any]] = None) -> SteveCommunityConfig:
    """Return Steve Community package config from the in-app KB.

    Defaults are deliberately production-safe so a missing admin-edited field
    does not remove the cost circuit breaker.
    """
    f = fields if fields is not None else _field_map()
    defaults = SteveCommunityConfig()
    return SteveCommunityConfig(
        monthly_credit_pool=_int(f.get("paid_steve_package_monthly_credit_pool"), defaults.monthly_credit_pool, minimum=0),
        monthly_provider_cost_ceiling_usd=_float(
            f.get("paid_steve_package_monthly_provider_cost_ceiling_usd"),
            defaults.monthly_provider_cost_ceiling_usd,
            minimum=0,
        ),
        provider_cost_reservation_usd=_float(
            f.get("paid_steve_package_provider_cost_reservation_usd"),
            defaults.provider_cost_reservation_usd,
            minimum=0,
        ),
        model=_str(f.get("paid_steve_package_model"), defaults.model),
        model_input_usd_per_million=_float(
            f.get("paid_steve_package_model_input_usd_per_million"),
            defaults.model_input_usd_per_million,
            minimum=0,
        ),
        model_output_usd_per_million=_float(
            f.get("paid_steve_package_model_output_usd_per_million"),
            defaults.model_output_usd_per_million,
            minimum=0,
        ),
        multi_agent_enabled=_bool(f.get("paid_steve_package_multi_agent_enabled"), defaults.multi_agent_enabled),
        web_search_default_enabled=_bool(
            f.get("paid_steve_package_web_search_default_enabled"),
            defaults.web_search_default_enabled,
        ),
        x_search_default_enabled=_bool(
            f.get("paid_steve_package_x_search_default_enabled"),
            defaults.x_search_default_enabled,
        ),
        external_search_explicit_only=_bool(
            f.get("paid_steve_package_external_search_explicit_only"),
            defaults.external_search_explicit_only,
        ),
        feed_attach_web_search_tool=_bool(
            f.get("paid_steve_package_feed_attach_web_search_tool"),
            defaults.feed_attach_web_search_tool,
        ),
        feed_attach_x_search_tool=_bool(
            f.get("paid_steve_package_feed_attach_x_search_tool"),
            defaults.feed_attach_x_search_tool,
        ),
        max_output_tokens=_int(f.get("paid_steve_package_max_output_tokens"), defaults.max_output_tokens, minimum=1),
        recent_comments_limit=_int(
            f.get("paid_steve_package_recent_comments_limit"),
            defaults.recent_comments_limit,
            minimum=0,
        ),
        thread_chars_max=_int(
            f.get("paid_steve_package_thread_chars_max"),
            defaults.thread_chars_max,
            minimum=1000,
        ),
        doc_excerpt_chars_default=_int(
            f.get("paid_steve_package_doc_excerpt_chars_default"),
            defaults.doc_excerpt_chars_default,
            minimum=0,
        ),
        doc_excerpt_chars_deep=_int(
            f.get("paid_steve_package_doc_excerpt_chars_deep"),
            defaults.doc_excerpt_chars_deep,
            minimum=0,
        ),
        docs_limit=_int(f.get("paid_steve_package_docs_limit"), defaults.docs_limit, minimum=0),
        links_limit=_int(f.get("paid_steve_package_links_limit"), defaults.links_limit, minimum=0),
        events_limit=_int(f.get("paid_steve_package_events_limit"), defaults.events_limit, minimum=0),
        polls_limit=_int(f.get("paid_steve_package_polls_limit"), defaults.polls_limit, minimum=0),
        images_limit=_int(f.get("paid_steve_package_images_limit"), defaults.images_limit, minimum=0),
        context_degrade_before_block=_bool(
            f.get("paid_steve_package_context_degrade_before_block"),
            defaults.context_degrade_before_block,
        ),
    )


def estimate_call_cost_usd(
    tokens_in: Optional[int],
    tokens_out: Optional[int],
    config: Optional[SteveCommunityConfig] = None,
) -> float:
    """Backward-compatible wrapper around the shared Steve pricing helper."""

    return _estimate_call_cost_usd(tokens_in, tokens_out, config or get_paid_steve_package_config())
