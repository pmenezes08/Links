"""Unit tests for KB-backed Steve networking AI controls."""

from __future__ import annotations

from backend.services.networking_ai_config import (
    DEFAULT_CONFIG,
    estimate_cost_usd,
    get_networking_ai_config,
    usage_tokens,
)


def _page(fields):
    return {
        "slug": "networking-ai",
        "fields": [
            {"name": name, "value": value}
            for name, value in fields.items()
        ],
    }


def test_networking_ai_config_defaults_without_page():
    config = get_networking_ai_config({})

    assert config.enabled is True
    assert config.weekly_prompts_per_user == 20
    assert config.planner_model == "grok-4-1-fast-reasoning"
    assert config.final_answer_model == "grok-4.3"
    assert config.kb_synthesis_model == "grok-4.3"


def test_networking_ai_config_accepts_allowed_models_and_caps():
    config = get_networking_ai_config(
        _page({
            "networking_ai_enabled": False,
            "weekly_prompts_per_user": 12,
            "planner_model": "grok-4.3",
            "final_answer_model": "grok-4.20-reasoning",
            "kb_synthesis_model": "grok-4.20-reasoning",
            "fallback_enabled": True,
            "fallback_model": "grok-4.20-multi-agent",
        })
    )

    assert config.enabled is False
    assert config.weekly_prompts_per_user == 12
    assert config.planner_model == "grok-4.3"
    assert config.final_answer_model == "grok-4.20-reasoning"
    assert config.kb_synthesis_model == "grok-4.20-reasoning"
    assert config.fallback_enabled is True
    assert config.fallback_model == "grok-4.20-multi-agent"


def test_networking_ai_config_rejects_invalid_models():
    config = get_networking_ai_config(
        _page({
            "planner_model": "grok-4-1-fast-non-reasoning",
            "final_answer_model": "made-up-model",
            "kb_synthesis_model": "grok-3-mini",
            "weekly_prompts_per_user": -10,
        })
    )

    assert config.planner_model == DEFAULT_CONFIG.planner_model
    assert config.final_answer_model == DEFAULT_CONFIG.final_answer_model
    assert config.kb_synthesis_model == DEFAULT_CONFIG.kb_synthesis_model
    assert config.weekly_prompts_per_user == 1


def test_usage_tokens_and_cost_estimate_support_responses_usage_shape():
    class Usage:
        input_tokens = 1000
        output_tokens = 200

    class Response:
        usage = Usage()

    config = get_networking_ai_config({})
    tokens_in, tokens_out = usage_tokens(Response())

    assert tokens_in == 1000
    assert tokens_out == 200
    assert estimate_cost_usd(config, "final", tokens_in, tokens_out) == 0.00175
