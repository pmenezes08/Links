"""Shared rate-limit primitive (backend/services/rate_limit.py).

Pure unit tests — the limiter is exercised against a stub cache, no MySQL
or Redis required. Covers the fixed-window count, the fail-open contract
when the cache is unavailable, and identity normalisation.
"""

from __future__ import annotations

import backend.services.rate_limit as rate_limit
import redis_cache


class _StubCache:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.counts = {}

    def incr(self, key, ttl=None):
        if self.fail:
            return None
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]


def test_allows_up_to_max_then_denies(monkeypatch):
    monkeypatch.setattr(redis_cache, "cache", _StubCache())
    results = [
        rate_limit.allow("report_post", "alice", max_events=3, window_seconds=3600)
        for _ in range(5)
    ]
    assert results == [True, True, True, False, False]


def test_identities_do_not_share_windows(monkeypatch):
    monkeypatch.setattr(redis_cache, "cache", _StubCache())
    assert rate_limit.allow("report_post", "alice", max_events=1, window_seconds=3600)
    assert not rate_limit.allow("report_post", "alice", max_events=1, window_seconds=3600)
    # bob's window is untouched by alice's spend
    assert rate_limit.allow("report_post", "bob", max_events=1, window_seconds=3600)


def test_identity_is_case_insensitive(monkeypatch):
    monkeypatch.setattr(redis_cache, "cache", _StubCache())
    assert rate_limit.allow("report_post", "Alice", max_events=1, window_seconds=3600)
    assert not rate_limit.allow("report_post", "alice", max_events=1, window_seconds=3600)


def test_fail_open_when_cache_unavailable(monkeypatch):
    monkeypatch.setattr(redis_cache, "cache", _StubCache(fail=True))
    for _ in range(10):
        assert rate_limit.allow("report_post", "alice", max_events=1, window_seconds=3600)


def test_blank_identity_and_degenerate_limits_allow():
    assert rate_limit.allow("report_post", "", max_events=1, window_seconds=3600)
    assert rate_limit.allow("report_post", "alice", max_events=0, window_seconds=3600)
    assert rate_limit.allow("report_post", "alice", max_events=1, window_seconds=0)
