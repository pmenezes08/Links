"""Unit tests for the community Steve pool per-surface breakdown."""

from __future__ import annotations

import backend.services.ai_usage as ai_usage


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def execute(self, sql, params):  # noqa: D401 - test stub
        self.sql = sql
        self.params = params

    def fetchall(self):
        return self._rows


class _FakeConn:
    def __init__(self, rows):
        self._rows = rows

    def cursor(self):
        return _FakeCursor(self._rows)

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


def test_breakdown_empty_without_community_id():
    assert ai_usage.community_monthly_steve_pool_breakdown(0) == {"chat_feed": 0, "voice_summaries": 0}
    assert ai_usage.community_monthly_steve_pool_breakdown(None) == {"chat_feed": 0, "voice_summaries": 0}


def test_breakdown_splits_voice_and_rolls_up_the_rest(monkeypatch):
    # dm/group/feed/post_summary roll into chat_feed; voice_summary is its own row.
    rows = [
        ("dm", 3),
        ("group", 2),
        ("feed", 1),
        ("post_summary", 1),
        ("voice_summary", 4),
    ]
    monkeypatch.setattr(ai_usage, "ensure_tables", lambda: None)
    monkeypatch.setattr(ai_usage, "_use_weighted_steve_credits", lambda: False)
    monkeypatch.setattr(ai_usage, "get_db_connection", lambda: _FakeConn(rows))

    out = ai_usage.community_monthly_steve_pool_breakdown(28)
    assert out == {"chat_feed": 7, "voice_summaries": 4}


def test_breakdown_rounds_weighted_credits_for_display(monkeypatch):
    # Weighted credits are display-rounded (round half-up) like the headline total.
    rows = [("dm", 2.4), ("feed", 1.2), ("voice_summary", 3.5)]
    monkeypatch.setattr(ai_usage, "ensure_tables", lambda: None)
    monkeypatch.setattr(ai_usage, "_use_weighted_steve_credits", lambda: True)
    monkeypatch.setattr(ai_usage, "get_db_connection", lambda: _FakeConn(rows))

    out = ai_usage.community_monthly_steve_pool_breakdown(28)
    # chat_feed = round(3.6) = 4 ; voice = round(3.5) = 4
    assert out == {"chat_feed": 4, "voice_summaries": 4}


def test_breakdown_fails_soft_on_db_error(monkeypatch):
    class _Boom:
        def __enter__(self):
            raise RuntimeError("db down")

        def __exit__(self, *_a):
            return False

    monkeypatch.setattr(ai_usage, "ensure_tables", lambda: None)
    monkeypatch.setattr(ai_usage, "_use_weighted_steve_credits", lambda: False)
    monkeypatch.setattr(ai_usage, "get_db_connection", lambda: _Boom())

    assert ai_usage.community_monthly_steve_pool_breakdown(28) == {"chat_feed": 0, "voice_summaries": 0}
