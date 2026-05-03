"""KB-backed controls for Steve networking AI.

Only generative/reasoning stages are configurable. Retrieval infrastructure
such as embeddings, structured search, FAISS search, ranking, and context
assembly stays hard-coded and deterministic.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Tuple

logger = logging.getLogger(__name__)

KB_SLUG = "networking-ai"

MODEL_GROK_41_REASONING = "grok-4-1-fast-reasoning"
MODEL_GROK_43 = "grok-4.3"
MODEL_GROK_420_REASONING = "grok-4.20-reasoning"
MODEL_GROK_420_MULTI_AGENT = "grok-4.20-multi-agent"

PLANNER_MODELS = frozenset({
    MODEL_GROK_41_REASONING,
    MODEL_GROK_43,
    MODEL_GROK_420_REASONING,
})
FINAL_MODELS = frozenset({
    MODEL_GROK_43,
    MODEL_GROK_41_REASONING,
    MODEL_GROK_420_REASONING,
})
KB_SYNTHESIS_MODELS = frozenset({
    MODEL_GROK_43,
    MODEL_GROK_420_REASONING,
    MODEL_GROK_41_REASONING,
})
LARGE_CONTEXT_MODELS = frozenset({
    MODEL_GROK_420_REASONING,
    MODEL_GROK_43,
})
FALLBACK_MODELS = frozenset({
    MODEL_GROK_43,
    MODEL_GROK_420_REASONING,
    MODEL_GROK_420_MULTI_AGENT,
})


@dataclass(frozen=True)
class NetworkingAiConfig:
    enabled: bool = True
    weekly_prompts_per_user: int = 20
    planner_model: str = MODEL_GROK_41_REASONING
    final_answer_model: str = MODEL_GROK_43
    kb_synthesis_model: str = MODEL_GROK_43
    large_context_model: str = MODEL_GROK_420_REASONING
    fallback_model: str = MODEL_GROK_43
    fallback_enabled: bool = False
    use_large_context_model_after_tokens: int = 900_000
    planner_input_usd_per_million: float = 0.20
    planner_output_usd_per_million: float = 0.50
    final_input_usd_per_million: float = 1.25
    final_output_usd_per_million: float = 2.50
    kb_synthesis_input_usd_per_million: float = 1.25
    kb_synthesis_output_usd_per_million: float = 2.50


DEFAULT_CONFIG = NetworkingAiConfig()


def _field_map(page: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    fields = (page or {}).get("fields") or []
    out: Dict[str, Any] = {}
    for field in fields:
        if not isinstance(field, Mapping):
            continue
        name = str(field.get("name") or "").strip()
        if name:
            out[name] = field.get("value")
    return out


def _bool(fields: Mapping[str, Any], name: str, default: bool) -> bool:
    raw = fields.get(name)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    if raw is None:
        return default
    return bool(raw)


def _int(fields: Mapping[str, Any], name: str, default: int, *, minimum: int = 0) -> int:
    try:
        value = int(fields.get(name))
    except Exception:
        return default
    return max(minimum, value)


def _float(fields: Mapping[str, Any], name: str, default: float, *, minimum: float = 0.0) -> float:
    try:
        value = float(fields.get(name))
    except Exception:
        return default
    return max(minimum, value)


def _model(fields: Mapping[str, Any], name: str, default: str, allowed: frozenset[str]) -> str:
    value = str(fields.get(name) or "").strip()
    if value in allowed:
        return value
    if value:
        logger.warning("Ignoring unsupported networking AI model for %s: %s", name, value)
    return default


def get_networking_ai_config(page: Optional[Mapping[str, Any]] = None) -> NetworkingAiConfig:
    """Return the KB-backed networking AI config with safe defaults.

    Tests may pass *page* directly. Production reads the editable KB page.
    """
    if page is None:
        try:
            from backend.services import knowledge_base

            knowledge_base.ensure_tables()
            page = knowledge_base.get_page(KB_SLUG)
        except Exception as exc:
            logger.warning("Could not read %s KB page; using defaults: %s", KB_SLUG, exc)
            page = None

    fields = _field_map(page)
    defaults = DEFAULT_CONFIG
    return NetworkingAiConfig(
        enabled=_bool(fields, "networking_ai_enabled", defaults.enabled),
        weekly_prompts_per_user=_int(
            fields,
            "weekly_prompts_per_user",
            defaults.weekly_prompts_per_user,
            minimum=1,
        ),
        planner_model=_model(fields, "planner_model", defaults.planner_model, PLANNER_MODELS),
        final_answer_model=_model(
            fields,
            "final_answer_model",
            defaults.final_answer_model,
            FINAL_MODELS,
        ),
        kb_synthesis_model=_model(
            fields,
            "kb_synthesis_model",
            defaults.kb_synthesis_model,
            KB_SYNTHESIS_MODELS,
        ),
        large_context_model=_model(
            fields,
            "large_context_model",
            defaults.large_context_model,
            LARGE_CONTEXT_MODELS,
        ),
        fallback_model=_model(fields, "fallback_model", defaults.fallback_model, FALLBACK_MODELS),
        fallback_enabled=_bool(fields, "fallback_enabled", defaults.fallback_enabled),
        use_large_context_model_after_tokens=_int(
            fields,
            "use_large_context_model_after_tokens",
            defaults.use_large_context_model_after_tokens,
            minimum=1,
        ),
        planner_input_usd_per_million=_float(
            fields,
            "planner_input_usd_per_million",
            defaults.planner_input_usd_per_million,
        ),
        planner_output_usd_per_million=_float(
            fields,
            "planner_output_usd_per_million",
            defaults.planner_output_usd_per_million,
        ),
        final_input_usd_per_million=_float(
            fields,
            "final_input_usd_per_million",
            defaults.final_input_usd_per_million,
        ),
        final_output_usd_per_million=_float(
            fields,
            "final_output_usd_per_million",
            defaults.final_output_usd_per_million,
        ),
        kb_synthesis_input_usd_per_million=_float(
            fields,
            "kb_synthesis_input_usd_per_million",
            defaults.kb_synthesis_input_usd_per_million,
        ),
        kb_synthesis_output_usd_per_million=_float(
            fields,
            "kb_synthesis_output_usd_per_million",
            defaults.kb_synthesis_output_usd_per_million,
        ),
    )


def usage_tokens(response: Any) -> Tuple[Optional[int], Optional[int]]:
    """Extract input/output token counts from OpenAI-compatible responses."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return None, None

    def _get(*names: str) -> Optional[int]:
        for name in names:
            try:
                raw = getattr(usage, name)
            except Exception:
                raw = None
            if raw is None and isinstance(usage, Mapping):
                raw = usage.get(name)
            if raw is not None:
                try:
                    return int(raw)
                except Exception:
                    return None
        return None

    return _get("input_tokens", "prompt_tokens"), _get("output_tokens", "completion_tokens")


def estimate_cost_usd(
    config: NetworkingAiConfig,
    stage: str,
    tokens_in: Optional[int],
    tokens_out: Optional[int],
) -> Optional[float]:
    """Estimate provider cost for a stage from KB pricing fields."""
    if tokens_in is None and tokens_out is None:
        return None

    ti = float(tokens_in or 0)
    to = float(tokens_out or 0)
    if stage == "planner":
        in_rate = config.planner_input_usd_per_million
        out_rate = config.planner_output_usd_per_million
    elif stage == "kb_synthesis":
        in_rate = config.kb_synthesis_input_usd_per_million
        out_rate = config.kb_synthesis_output_usd_per_million
    else:
        in_rate = config.final_input_usd_per_million
        out_rate = config.final_output_usd_per_million
    return round((ti * in_rate + to * out_rate) / 1_000_000.0, 6)
