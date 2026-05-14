"""Tests for feed Steve web/X tool gating."""

from dataclasses import replace

from backend.services.steve_community_config import SteveCommunityConfig
from backend.services.steve_tool_policy import (
    normalize_message_for_live_search_signals,
    steve_external_search_requested,
    steve_tool_names_for_log,
    steve_tools_for_message,
)


def test_todays_news_variants_trigger():
    assert steve_external_search_requested("@Steve give me today's news")
    assert steve_external_search_requested("give me today's news")
    assert steve_external_search_requested("give me todays news")
    assert steve_external_search_requested("latest news please")
    assert steve_external_search_requested("Today's headlines?")
    assert steve_external_search_requested("news today")


def test_curly_apostrophe_normalized():
    assert steve_external_search_requested(f"today\u2019s news")


def test_normalize_collapses_smart_quotes():
    t = normalize_message_for_live_search_signals(f"today\u2019s")
    assert t == "today's"


def test_tool_log_summary():
    assert steve_tool_names_for_log(None) == "none"
    assert steve_tool_names_for_log([]) == "none"
    assert (
        steve_tool_names_for_log([{"type": "web_search"}, {"type": "x_search"}])
        == "web_search,x_search"
    )


def test_explicit_request_yields_web_and_x_with_default_kb_config():
    cfg = SteveCommunityConfig()
    msg = "@admin @Steve what's the latest news"
    tools = steve_tools_for_message(msg, config=cfg)
    assert tools == [{"type": "web_search"}, {"type": "x_search"}]


def test_platform_question_strips_tools():
    cfg = SteveCommunityConfig()
    assert (
        steve_tools_for_message("today's news", platform_question=True, config=cfg)
        == []
    )


def test_explicit_only_off_and_defaults_off_still_attaches_tools_on_phrase():
    """Regression: phrase widens explicit but defaults/explicit-only must not strip tools."""
    cfg = replace(
        SteveCommunityConfig(),
        external_search_explicit_only=False,
        web_search_default_enabled=False,
        x_search_default_enabled=False,
    )
    tools = steve_tools_for_message("@Steve what's the latest news", config=cfg)
    assert tools == [{"type": "web_search"}, {"type": "x_search"}]


def test_kb_can_disable_web_tool_only():
    cfg = replace(SteveCommunityConfig(), feed_attach_web_search_tool=False)
    tools = steve_tools_for_message("latest headlines please", config=cfg)
    assert tools == [{"type": "x_search"}]


def test_kb_can_disable_x_tool_only():
    cfg = replace(SteveCommunityConfig(), feed_attach_x_search_tool=False)
    tools = steve_tools_for_message("latest headlines please", config=cfg)
    assert tools == [{"type": "web_search"}]


def test_web_default_only_attaches_web_not_x_when_explicit_only_off():
    cfg = replace(
        SteveCommunityConfig(),
        external_search_explicit_only=False,
        web_search_default_enabled=True,
        x_search_default_enabled=False,
    )
    tools = steve_tools_for_message("@Steve hello thanks", config=cfg)
    assert tools == [{"type": "web_search"}]


def test_x_default_only_attaches_x_not_web_when_explicit_only_off():
    cfg = replace(
        SteveCommunityConfig(),
        external_search_explicit_only=False,
        web_search_default_enabled=False,
        x_search_default_enabled=True,
    )
    tools = steve_tools_for_message("quick ping", config=cfg)
    assert tools == [{"type": "x_search"}]
