from __future__ import annotations

from types import SimpleNamespace

from backend.services.steve_community_config import (
    estimate_call_cost_usd,
    get_paid_steve_package_config,
    response_usage_tokens,
)


def test_paid_steve_package_config_defaults_are_cost_safe():
    cfg = get_paid_steve_package_config({})

    assert cfg.monthly_credit_pool == 200
    assert cfg.monthly_provider_cost_ceiling_usd == 5.0
    assert cfg.provider_cost_reservation_usd == 0.03
    assert cfg.model == "grok-4.3"
    assert cfg.multi_agent_enabled is False
    assert cfg.web_search_default_enabled is False
    assert cfg.x_search_default_enabled is False
    assert cfg.external_search_explicit_only is True
    assert cfg.max_output_tokens == 1400


def test_paid_steve_package_config_parses_kb_overrides():
    cfg = get_paid_steve_package_config(
        {
            "paid_steve_package_monthly_credit_pool": "250",
            "paid_steve_package_monthly_provider_cost_ceiling_usd": "6.5",
            "paid_steve_package_web_search_default_enabled": "true",
            "paid_steve_package_recent_comments_limit": "4",
        }
    )

    assert cfg.monthly_credit_pool == 250
    assert cfg.monthly_provider_cost_ceiling_usd == 6.5
    assert cfg.web_search_default_enabled is True
    assert cfg.recent_comments_limit == 4


def test_response_usage_tokens_supports_responses_and_chat_shapes():
    assert response_usage_tokens({"usage": {"input_tokens": 12, "output_tokens": 5}}) == (12, 5)
    assert response_usage_tokens(SimpleNamespace(usage=SimpleNamespace(prompt_tokens=9, completion_tokens=3))) == (9, 3)
    assert response_usage_tokens({"usage": {"input_tokens": 8, "total_tokens": 11}}) == (8, 3)


def test_estimate_call_cost_usd_uses_package_rates():
    cfg = get_paid_steve_package_config(
        {
            "paid_steve_package_model_input_usd_per_million": 1.25,
            "paid_steve_package_model_output_usd_per_million": 2.50,
        }
    )

    assert estimate_call_cost_usd(1_000_000, 1_000_000, cfg) == 3.75
