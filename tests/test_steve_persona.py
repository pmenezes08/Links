"""Persona enforcement: no forbidden service-desk phrases in shipped Steve prompts.

docs/STEVE_PERSONA.md marks these substrings as build-breaking. The community
feed shipped for months with a root prompt opening "You are Steve, a friendly
and warm AI assistant in the C.Point community app" because nothing guarded
the prompt strings — this suite is that guard.
"""

from __future__ import annotations

import pytest

from backend.services.steve_feed_prompt import (
    PERSONALITY_TONES,
    cap_profile_context,
    render_feed_persona_prompt,
    render_group_chat_personality_modifier,
)
from backend.services.steve_prompt_policy import (
    render_response_policy_prompt,
    render_thread_grounding_appendix,
)

# Substrings from docs/STEVE_PERSONA.md §Forbidden phrases, plus the brand
# misspelling CLAUDE.md forbids in user-facing copy.
FORBIDDEN_SUBSTRINGS = [
    "as an ai",
    "i'm an assistant",
    "your assistant",
    "ai assistant",
    "i'm a bot",
    "i'm a chatbot",
    "i'm here to help",
    "happy to help",
    "how may i help you today",
    "anything else i can do for you",
    "i apologise for the inconvenience",
    "as of my last update",
    "i don't have access to real-time information",
    "c.point",
]


def _assert_persona_clean(text: str, origin: str) -> None:
    lowered = (text or "").lower()
    for phrase in FORBIDDEN_SUBSTRINGS:
        assert phrase not in lowered, f"forbidden persona phrase {phrase!r} in {origin}"


@pytest.mark.parametrize("personality", sorted(PERSONALITY_TONES) + ["friendly", "unknown-key", ""])
def test_feed_persona_prompt_has_no_forbidden_phrases(personality):
    _assert_persona_clean(render_feed_persona_prompt(personality), f"feed prompt ({personality!r})")


def test_feed_persona_prompt_identity_is_member_not_assistant():
    prompt = render_feed_persona_prompt("friendly")
    assert "member of C-Point with extra reach" in prompt
    assert "never sycophantic" in prompt


def test_feed_persona_prompt_contains_anti_repetition_rules():
    prompt = render_feed_persona_prompt("friendly")
    assert "Never repeat a point you have already made in this thread" in prompt
    assert "Do not loop back to or re-reference earlier topics" in prompt
    assert "Vary how you open" in prompt


def test_feed_persona_prompt_makes_no_search_capability_claim():
    # Capability claims are appended per-turn from actual tool resolution.
    prompt = render_feed_persona_prompt("friendly")
    assert "You have access to real-time web search" not in prompt


@pytest.mark.parametrize("personality", sorted(PERSONALITY_TONES))
def test_group_chat_personality_modifier_clean_and_nonempty(personality):
    modifier = render_group_chat_personality_modifier(personality)
    assert modifier.strip(), f"tone modifier for {personality!r} is empty"
    _assert_persona_clean(modifier, f"group-chat modifier ({personality!r})")


def test_group_chat_personality_modifier_unknown_key_is_empty():
    assert render_group_chat_personality_modifier("unhinged") == ""
    assert render_group_chat_personality_modifier("") == ""


def test_thread_grounding_appendix_is_persona_clean():
    _assert_persona_clean(render_thread_grounding_appendix(), "thread grounding appendix")


@pytest.mark.parametrize("conversational", [True, False])
def test_response_policy_prompt_is_persona_clean(conversational):
    prompt = render_response_policy_prompt(
        "how should we structure the mentorship program?",
        surface="feed",
        conversational=conversational,
    )
    _assert_persona_clean(prompt, f"response policy (conversational={conversational})")


def test_cap_profile_context_cuts_at_line_boundary():
    text = "\n".join(f"- fact number {i}: something about the member" for i in range(100))
    capped = cap_profile_context(text, max_chars=300)
    assert len(capped) <= 300 + len("\n[…]")
    assert capped.endswith("[…]")
    # No mid-line truncation: every retained line is intact.
    for line in capped.splitlines()[:-1]:
        assert line.startswith("- fact number")


def test_cap_profile_context_short_text_untouched():
    assert cap_profile_context("short dossier", max_chars=1500) == "short dossier"
