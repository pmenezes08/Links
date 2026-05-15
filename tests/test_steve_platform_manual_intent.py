"""Tests for platform-manual intent: @Steve invocation must not imply platform question."""

from backend.services.steve_platform_manual import (
    _platform_term_matches,
    detect_platform_manual_intent,
    is_platform_question,
    strip_steve_invocation_mentions,
)


def test_strip_steve_invocation_removes_mention_only():
    assert strip_steve_invocation_mentions("@Steve hi") == "hi"
    assert strip_steve_invocation_mentions("@steve hello there") == "hello there"
    assert strip_steve_invocation_mentions("  @Steve  x  ") == "x"


def test_plain_at_steve_is_not_platform_manual():
    assert not detect_platform_manual_intent("@Steve hello thanks")
    assert not is_platform_question("@Steve hello thanks")


def test_at_steve_product_question_still_platform():
    assert detect_platform_manual_intent("@Steve what is pricing")
    assert is_platform_question("@Steve what is pricing")


def test_at_steve_news_not_forced_platform():
    assert not detect_platform_manual_intent("@Steve give me today's news")
    assert not is_platform_question("@Steve give me today's news")


def test_at_steve_check_twitter_not_platform_without_cpoint():
    assert not detect_platform_manual_intent("@Steve check twitter")
    assert not is_platform_question("@Steve check twitter")


def test_cpoint_plus_twitter_is_platform():
    assert detect_platform_manual_intent("what is c-point's twitter handle")


def test_here_does_not_match_inside_there():
    assert not _platform_term_matches("is there a job posting?", "here")
    assert _platform_term_matches("what can i do here on c-point?", "here")


def test_what_is_steve_still_platform_without_at():
    assert detect_platform_manual_intent("what is Steve?")
