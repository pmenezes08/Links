"""Tests for feed Steve web/X tool attachment."""

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


def test_default_kb_always_attaches_web_and_x():
    cfg = SteveCommunityConfig()
    assert steve_tools_for_message("@admin @Steve what's the latest news", config=cfg) == [
        {"type": "web_search"},
        {"type": "x_search"},
    ]
    assert steve_tools_for_message("@Steve hello thanks", config=cfg) == [
        {"type": "web_search"},
        {"type": "x_search"},
    ]


def test_platform_question_does_not_strip_tools():
    cfg = SteveCommunityConfig()
    assert steve_tools_for_message("today's news", platform_question=True, config=cfg) == [
        {"type": "web_search"},
        {"type": "x_search"},
    ]


def test_legacy_kb_flags_do_not_change_which_tools_are_attached():
    """Former phrase/default/explicit-only gates no longer apply; both tools attach when allowed."""
    cfg = replace(
        SteveCommunityConfig(),
        external_search_explicit_only=False,
        web_search_default_enabled=False,
        x_search_default_enabled=False,
    )
    tools = steve_tools_for_message("@Steve what's the latest news", config=cfg)
    assert tools == [{"type": "web_search"}, {"type": "x_search"}]

    cfg2 = replace(
        SteveCommunityConfig(),
        external_search_explicit_only=False,
        web_search_default_enabled=True,
        x_search_default_enabled=False,
    )
    assert steve_tools_for_message("@Steve hello thanks", config=cfg2) == [
        {"type": "web_search"},
        {"type": "x_search"},
    ]

    cfg3 = replace(
        SteveCommunityConfig(),
        external_search_explicit_only=False,
        web_search_default_enabled=False,
        x_search_default_enabled=True,
    )
    assert steve_tools_for_message("quick ping", config=cfg3) == [
        {"type": "web_search"},
        {"type": "x_search"},
    ]


def test_kb_can_disable_web_tool_only():
    cfg = replace(SteveCommunityConfig(), feed_attach_web_search_tool=False)
    tools = steve_tools_for_message("latest headlines please", config=cfg)
    assert tools == [{"type": "x_search"}]


def test_kb_can_disable_x_tool_only():
    cfg = replace(SteveCommunityConfig(), feed_attach_x_search_tool=False)
    tools = steve_tools_for_message("latest headlines please", config=cfg)
    assert tools == [{"type": "web_search"}]
