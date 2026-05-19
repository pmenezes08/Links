from __future__ import annotations

from backend.services.steve_prompt_policy import (
    MODE_NEWS_CURRENT_EVENTS,
    MODE_QUICK_ANSWER,
    MODE_RECOMMENDATION,
    MODE_REVIEW_CRITIQUE,
    MODE_SUBSTANTIVE_ANALYSIS,
    classify_response_mode,
    render_response_policy_prompt,
    should_include_community_resources,
    should_include_user_profile,
)


def test_prompt_policy_keeps_casual_replies_lightweight():
    assert classify_response_mode("thanks!") == MODE_QUICK_ANSWER

    prompt = render_response_policy_prompt("thanks!", surface="dm")
    assert "For casual replies, stay conversational" in prompt
    assert "Do not add headings unless they help" in prompt


def test_prompt_policy_news_current_events_mode():
    assert classify_response_mode("Give me today's news") == MODE_NEWS_CURRENT_EVENTS
    assert classify_response_mode("What's the weather in Lisbon?") == MODE_NEWS_CURRENT_EVENTS

    prompt = render_response_policy_prompt("Latest headlines please", surface="feed")
    assert "news_current_events" in prompt
    assert "## Key developments" in prompt
    assert "RTP Notícias" in prompt or "RTP" in prompt


def test_prompt_policy_detects_substantive_requests():
    message = "How should we price this community product and what are the risks?"

    assert classify_response_mode(message) == MODE_RECOMMENDATION
    prompt = render_response_policy_prompt(message, surface="feed")

    assert "Think step-by-step internally" in prompt
    assert "do not reveal hidden chain-of-thought" in prompt
    assert "## Short Answer" in prompt
    assert "Use bullet points by default" in prompt


def test_prompt_policy_detects_review_and_analysis_modes():
    assert classify_response_mode("Review this proposal and identify blind spots") == MODE_REVIEW_CRITIQUE
    assert classify_response_mode("How does this architecture scale?") == MODE_SUBSTANTIVE_ANALYSIS


def test_context_injection_heuristics_are_deliberate():
    assert should_include_user_profile("Can you introduce me to @mary?")
    assert should_include_user_profile("I need career mentoring")
    assert should_include_user_profile("What communities am I in on C-Point?")
    assert should_include_user_profile("What do you know about me?")
    assert should_include_user_profile("List my communities")
    assert not should_include_user_profile("What is a good breakfast?")

    assert should_include_community_resources("Can you summarize the uploaded PDF?")
    assert should_include_community_resources("What events are in the calendar?")
    assert not should_include_community_resources("What do you think about this idea?")
