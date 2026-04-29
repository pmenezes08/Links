"""Unit tests for platform activity digest intent + window parsing."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from backend.services.platform_activity_digest import (
    _digest_app_base_url,
    _digest_markdown_preserves_required_https_links,
    _digest_opener_line,
    _format_digest_markdown_from_payload,
    _https_feed_url,
    _https_group_chat_url,
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
        ("give me a quick rundown of the last 5 days here", True),
        ("what did I miss in the last 7 days here on the platform", True),
        ("remind me to call mom in 5 minutes", False),
        ("how are you?", False),
    ],
)
def test_digest_intent_detector(line, expect):
    assert message_looks_like_platform_digest_intent(line) is expect


def test_coerce_window_hours():
    assert coerce_window_hours(72) == 72
    assert coerce_window_hours(9999) is None


def test_digest_app_base_url_env():
    with patch.dict(os.environ, {"PUBLIC_BASE_URL": "https://custom.example.com"}, clear=False):
        assert _digest_app_base_url() == "https://custom.example.com"
    with patch.dict(os.environ, {"PUBLIC_BASE_URL": ""}, clear=False):
        assert _digest_app_base_url() == "https://app.c-point.co"


def test_https_urls_for_feed_and_group():
    with patch.dict(os.environ, {"PUBLIC_BASE_URL": "https://app.example.com"}, clear=False):
        assert _https_feed_url(12) == "https://app.example.com/community_feed_react/12"
        assert _https_group_chat_url(44) == "https://app.example.com/group_chat/44"


def test_digest_opener_has_snapshot_sentence():
    s = _digest_opener_line(72)
    assert "activity snapshot" in s.lower()
    assert "3 days" in s or "**3 days**" in s


def test_deterministic_digest_markdown_contains_full_https_links():
    payload = {
        "communities": [
            {
                "name": "Test Comm",
                "post_count_others": 3,
                "last_from_others_at": "2026-04-01T12:00:00+00:00",
                "recent_snippets": ["Hello world"],
                "feed_url_https": "https://app.example.com/community_feed_react/7",
            }
        ],
        "group_chats": [
            {
                "name": "Squad",
                "message_count_others": 2,
                "last_activity": "2026-04-02",
                "last_snippet": "Hey",
                "chat_url_https": "https://app.example.com/group_chat/99",
            }
        ],
    }
    md = _format_digest_markdown_from_payload(payload)
    assert "[Open feed](https://app.example.com/community_feed_react/7)" in md
    assert "[Open chat](https://app.example.com/group_chat/99)" in md
    assert "**Test Comm**" in md
    assert "**Squad**" in md
    assert _digest_markdown_preserves_required_https_links(md, payload)
    bad = md.replace("https://app.example.com/community_feed_react/7", "")
    assert not _digest_markdown_preserves_required_https_links(bad, payload)
