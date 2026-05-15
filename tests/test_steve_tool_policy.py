"""Tests for Steve Grok hosted tool attachment intent policy."""

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


def test_live_news_explicit_gets_tools():
    cfg = SteveCommunityConfig()
    msg = "@admin @Steve what's the latest news"
    tools = steve_tools_for_message(msg, config=cfg)
    assert tools == [{"type": "web_search"}, {"type": "x_search"}]


def test_casual_chit_chat_no_tools_with_defaults():
    cfg = SteveCommunityConfig()
    assert steve_tools_for_message("@Steve hello thanks", config=cfg) == []
    assert steve_tools_for_message("quick ping", config=cfg) == []


def test_profile_about_user_suppresses_external_tools():
    cfg = SteveCommunityConfig()
    assert steve_tools_for_message("@Steve tell me about @alice career", config=cfg) == []
    assert steve_tools_for_message("who is john from our community?", config=cfg) == []


def test_profile_suppression_yields_when_news_also_requested():
    """Mixed wording: profile regex + sports/news heuristic still attaches."""
    cfg = SteveCommunityConfig()
    tools = steve_tools_for_message(
        "@Steve tell me about @bob AND what happened in Portugal news today?",
        config=cfg,
    )
    assert tools == [{"type": "web_search"}, {"type": "x_search"}]


def test_platform_manual_path_strips_tools_even_if_news_words():
    cfg = SteveCommunityConfig()
    assert (
        steve_tools_for_message("today's news", platform_question=True, config=cfg) == []
    )


def test_professional_advice_strips_tools():
    cfg = SteveCommunityConfig()
    assert (
        steve_tools_for_message(
            "My knee hurts badly after squatting yesterday",
            professional_advice_question=True,
            config=cfg,
        )
        == []
    )


def test_kb_default_when_explicit_only_off_attaches_without_phrases():
    cfg = replace(
        SteveCommunityConfig(),
        external_search_explicit_only=False,
        web_search_default_enabled=True,
    )
    assert steve_tools_for_message("@Steve hey there", config=cfg) == [
        {"type": "web_search"},
        {"type": "x_search"},
    ]


def test_kb_explicit_only_requires_signal():
    cfg = replace(
        SteveCommunityConfig(),
        external_search_explicit_only=True,
        web_search_default_enabled=True,
    )
    assert steve_tools_for_message("@Steve hello", config=cfg) == []


def test_kb_can_disable_web_tool_only_when_eligible():
    cfg = replace(SteveCommunityConfig(), feed_attach_web_search_tool=False)
    tools = steve_tools_for_message("latest headlines please", config=cfg)
    assert tools == [{"type": "x_search"}]


def test_kb_can_disable_x_tool_only_when_eligible():
    cfg = replace(SteveCommunityConfig(), feed_attach_x_search_tool=False)
    tools = steve_tools_for_message("breaking news roundup", config=cfg)
    assert tools == [{"type": "web_search"}]


def test_platform_intent_not_tripped_by_at_steve_for_casual_message():
    from backend.services.steve_platform_manual import is_platform_question

    assert not is_platform_question("@Steve hello thanks")


def test_careers_site_phrase_gets_tools_with_explicit_only():
    from backend.services.steve_platform_manual import is_platform_question

    cfg = SteveCommunityConfig()
    msg = "@Steve is there an OpenAI revenue ops role on their careers site?"
    assert not is_platform_question(msg)
    tools = steve_tools_for_message(
        msg,
        platform_question=is_platform_question(msg),
        config=cfg,
    )
    assert tools == [{"type": "web_search"}, {"type": "x_search"}]


def test_job_listing_signal_overrides_profile_suppression_when_mixed():
    cfg = SteveCommunityConfig()
    tools = steve_tools_for_message(
        "@Steve tell me about @alice and any open roles at Meta",
        config=cfg,
    )
    assert tools == [{"type": "web_search"}, {"type": "x_search"}]
