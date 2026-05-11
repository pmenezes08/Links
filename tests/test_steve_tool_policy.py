"""Tests for feed Steve web/X tool gating."""

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
