from __future__ import annotations

from types import SimpleNamespace

from backend.services import ai_usage
from backend.services.steve_model_config import (
    context_limit,
    estimate_call_cost_usd,
    estimate_response_cost_usd,
    get_steve_model_config,
    output_cap_for_surface,
    peer_context_limit,
    response_cached_input_tokens,
    response_usage_tokens,
)


def test_model_config_defaults_match_official_xai_grok_43_pricing():
    cfg = get_steve_model_config(credits_fields={}, hard_limit_fields={})

    assert cfg.model == "grok-4.3"
    assert cfg.input_usd_per_million == 1.25
    assert cfg.cached_input_usd_per_million == 0.20
    assert cfg.output_usd_per_million == 2.50
    assert cfg.tool_call_usd_per_1000 == 5.00
    assert cfg.max_output_tokens_dm == 1400
    assert cfg.max_output_tokens_feed == 1400
    assert cfg.max_context_messages_peer_dm == 60


def test_model_config_reads_kb_style_overrides():
    cfg = get_steve_model_config(
        credits_fields={
            "model_primary": "grok-4.3-latest",
            "model_primary_input_per_m_usd": "1.50",
            "model_primary_cached_input_per_m_usd": "0.25",
            "model_primary_output_per_m_usd": "3.00",
            "tool_call_per_1000_usd": "6.00",
        },
        hard_limit_fields={
            "max_output_tokens_dm": "1200",
            "max_output_tokens_feed": "1300",
            "max_output_tokens_group": "1600",
            "max_context_messages": "80",
        },
    )

    assert cfg.model == "grok-4.3-latest"
    assert cfg.input_usd_per_million == 1.50
    assert cfg.cached_input_usd_per_million == 0.25
    assert cfg.output_usd_per_million == 3.00
    assert cfg.tool_call_usd_per_1000 == 6.00
    assert cfg.max_output_tokens_dm == 1200
    assert cfg.max_output_tokens_feed == 1300
    assert cfg.max_output_tokens_group == 1600
    assert cfg.max_context_messages == 80


def test_model_config_reads_peer_dm_context_override():
    cfg = get_steve_model_config(
        credits_fields={},
        hard_limit_fields={"max_context_messages_peer_dm": "45"},
    )
    assert cfg.max_context_messages_peer_dm == 45


def test_peer_context_limit_reads_entitlements():
    assert peer_context_limit({"max_context_messages_peer_dm": 60}) == 60
    assert peer_context_limit({"max_context_messages_peer_dm": "40"}) == 40


def test_peer_context_limit_fallback_when_missing():
    assert peer_context_limit({}) == 10
    assert peer_context_limit(None) == 10
    assert peer_context_limit({}, fallback=60) == 60


def test_peer_context_limit_clamps_to_one():
    assert peer_context_limit({"max_context_messages_peer_dm": 0}) == 1
    assert peer_context_limit({"max_context_messages_peer_dm": -5}) == 1


def test_context_limit_unchanged():
    assert context_limit({"max_context_messages": 200}) == 200
    assert context_limit({}) == 200
    assert context_limit(None, fallback=100) == 100


def test_output_cap_for_surface_uses_resolved_entitlements():
    ent = {
        "max_output_tokens_dm": 1111,
        "max_output_tokens_feed": 1222,
        "max_output_tokens_group": 1333,
    }

    assert output_cap_for_surface(ent, ai_usage.SURFACE_DM, 600) == 1111
    assert output_cap_for_surface(ent, ai_usage.SURFACE_FEED, 600) == 1222
    assert output_cap_for_surface(ent, ai_usage.SURFACE_GROUP, 600) == 1333
    assert output_cap_for_surface({}, ai_usage.SURFACE_DM, 600) == 600


def test_response_cost_uses_cached_input_discount_when_reported():
    response = {
        "usage": {
            "input_tokens": 1_000_000,
            "output_tokens": 1_000_000,
            "input_tokens_details": {"cached_tokens": 400_000},
        }
    }

    assert response_usage_tokens(response) == (1_000_000, 1_000_000)
    assert response_cached_input_tokens(response) == 400_000
    assert estimate_response_cost_usd(response) == 3.33


def test_response_usage_tokens_supports_object_usage_shape():
    response = SimpleNamespace(
        usage=SimpleNamespace(
            prompt_tokens=12,
            completion_tokens=5,
            prompt_tokens_details=SimpleNamespace(cached_tokens=2),
        )
    )

    assert response_usage_tokens(response) == (12, 5)
    assert response_cached_input_tokens(response) == 2
    assert estimate_call_cost_usd(1_000_000, 1_000_000) == 3.75
