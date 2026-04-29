"""Unit tests for platform activity digest intent + window parsing."""

from __future__ import annotations

import pytest

from backend.services.platform_activity_digest import (
    coerce_window_hours,
    message_looks_like_platform_digest_intent,
    parse_digest_window_hours_from_message,
)


@pytest.mark.parametrize(
    "phrase,expected_hours",
    [
        ("past 3 days what's up", 72),
        ("last 24 hours", 24),
        ("last 24h activity digest", 24),
        ("last 7 days on the platform", 168),
        ("past week recap", 168),
        ("last 5 days", 120),
        ("platform digest", 24),
    ],
)
def test_digest_window_phrases(phrase, expected_hours):
    assert parse_digest_window_hours_from_message(phrase) == expected_hours


@pytest.mark.parametrize(
    "line,expect",
    [
        ("Steve, give me a quick platform activity digest?", True),
        ("catch me up on communities", True),
        ("what happened on the platform today", True),
        ("remind me to call mom in 5 minutes", False),
        ("how are you?", False),
    ],
)
def test_digest_intent_detector(line, expect):
    assert message_looks_like_platform_digest_intent(line) is expect


def test_coerce_window_hours():
    assert coerce_window_hours(72) == 72
    assert coerce_window_hours(9999) is None
