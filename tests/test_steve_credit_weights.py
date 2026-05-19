"""Unit tests for KB-backed Steve credit debit math."""

from __future__ import annotations

from backend.services import steve_credit_weights as scw
from backend.services.ai_usage import SURFACE_DM, SURFACE_FEED


def test_dm_slim_no_tools_is_one_credit():
    deb, meta = scw.compute_credits_debited(
        surface=SURFACE_DM,
        request_type="steve_dm_reply",
        tokens_in=2000,
        tools_web_search=False,
        tools_x_search=False,
    )
    assert deb == 1.0
    assert meta["base"] == 1.0


def test_feed_heavy_with_tools_debits_more_than_dm():
    dm, _ = scw.compute_credits_debited(
        surface=SURFACE_DM,
        request_type="steve_dm_reply",
        tokens_in=2000,
    )
    feed, _ = scw.compute_credits_debited(
        surface=SURFACE_FEED,
        request_type="steve_post_reply",
        tokens_in=15000,
        tools_web_search=True,
        tools_x_search=True,
    )
    assert feed > dm


def test_tool_router_only_debits_router_addon():
    deb, meta = scw.compute_credits_debited(
        surface=SURFACE_FEED,
        request_type="steve_tool_router",
    )
    assert deb == 0.5
    assert meta.get("component") == "tool_router"


def test_feedback_path_zero_credits():
    deb, _ = scw.compute_credits_debited(
        surface=SURFACE_DM,
        request_type="steve_dm_feedback",
    )
    assert deb == 0.0


def test_dm_15k_input_is_standard_tier_not_heavy():
    """Typical billed DM context (~15k tokens) should be standard tier after KB recalibration."""
    deb, meta = scw.compute_credits_debited(
        surface=SURFACE_DM,
        request_type="steve_dm_reply",
        tokens_in=15334,
        tools_web_search=False,
        tools_x_search=False,
    )
    assert deb == 2.0
    assert meta["tier_weight"] == 2.0


def test_dm_news_web_only_credits():
    deb, meta = scw.compute_credits_debited(
        surface=SURFACE_DM,
        request_type="steve_dm_reply",
        tokens_in=17116,
        tools_web_search=True,
        tools_x_search=False,
    )
    assert deb == 2.5
    assert meta["addon_web"] == 0.5
    assert meta.get("addon_x", 0) == 0


def test_max_per_call_cap():
    rules = scw.load_credit_rules()
    rules = scw.CreditRules(
        surface_weights=rules.surface_weights,
        tier_slim_max=rules.tier_slim_max,
        tier_standard_max=rules.tier_standard_max,
        tier_slim=rules.tier_slim,
        tier_standard=rules.tier_standard,
        tier_heavy=rules.tier_heavy,
        addon_web=5.0,
        addon_x=5.0,
        addon_router=5.0,
        max_per_call=4.0,
    )
    deb, _ = scw.compute_credits_debited(
        surface=SURFACE_FEED,
        request_type="steve_reply",
        tokens_in=50000,
        tools_web_search=True,
        tools_x_search=True,
        router_pass_in_turn=True,
        rules=rules,
    )
    assert deb == 4.0
