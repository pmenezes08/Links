from __future__ import annotations

from backend.services.steve_prompt_policy import (
    MODE_NEWS_CURRENT_EVENTS,
    MODE_QUICK_ANSWER,
    MODE_RECOMMENDATION,
    MODE_REVIEW_CRITIQUE,
    MODE_SUBSTANTIVE_ANALYSIS,
    classify_response_mode,
    context_includes_document_section,
    render_community_resource_system_appendix,
    render_response_policy_prompt,
    should_include_community_resources,
    should_include_community_resources_from_thread,
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
    assert should_include_community_resources("read the documents")
    assert should_include_community_resources("podes ler os documentos?")
    assert not should_include_community_resources("What do you think about this idea?")


def test_thread_activation_with_plurals_and_followups():
    assert should_include_community_resources_from_thread("read the documents")
    assert should_include_community_resources_from_thread("summarize the pdf")
    assert should_include_community_resources_from_thread("resumo do documento")
    assert should_include_community_resources_from_thread(
        "what do you think?",
        has_recent_docs=True,
        original_post="Can you read them?",
    )
    assert not should_include_community_resources_from_thread(
        "nice post!",
        has_recent_docs=False,
    )


def test_document_section_detection_and_conditional_system_prompt():
    assert context_includes_document_section("Community documents:\n- foo")
    assert context_includes_document_section("Group documents:\n- bar")
    assert not context_includes_document_section("Upcoming events in this community:\n- Meetup")

    with_docs = render_community_resource_system_appendix(includes_documents=True)
    without_docs = render_community_resource_system_appendix(includes_documents=False)
    assert "document excerpts" in with_docs
    assert "document excerpts" not in without_docs
    assert "could not be read" in with_docs
