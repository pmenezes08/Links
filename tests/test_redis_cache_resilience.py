"""Resilience tests for ``redis_cache.RedisCache``.

These cover the 2026-06-13 hardening of the Redis layer (commit follows the
bounded-connection-pool work):

  * a connection failure no longer condemns the whole process to no-cache for
    its lifetime — the client lazily reconnects, at most once per
    ``REDIS_RECONNECT_COOLDOWN`` (``_ensure_connected``);
  * while disabled, every op degrades to a safe cache-miss (``None`` / ``False``)
    rather than raising;
  * ``create_optimal_cache`` keeps returning a ``RedisCache`` when Redis is
    configured even if the initial connect failed, so a transient boot blip does
    NOT silently drop the instance onto a non-shared in-memory cache (which would
    split cache coherence across Cloud Run instances).

No Redis container is required: every test constructs a ``RedisCache`` directly
and patches ``connect`` / module globals, so this runs on a bare machine and in
CI regardless of Docker.
"""

from __future__ import annotations

import time

import pytest

import redis_cache


@pytest.fixture
def disabled_redis():
    """A RedisCache that is constructed without ever connecting.

    ``REDIS_ENABLED`` is False on test machines, so ``__init__`` skips
    ``connect()`` and the instance starts disabled with a pristine
    ``_last_connect_attempt`` of 0.0.
    """
    rc = redis_cache.RedisCache()
    rc.enabled = False
    return rc


def test_ensure_connected_fast_path_when_enabled():
    rc = redis_cache.RedisCache()
    rc.enabled = True
    # Already connected: no reconnection work, just a True.
    assert rc._ensure_connected() is True


def test_ensure_connected_respects_cooldown(monkeypatch, disabled_redis):
    rc = disabled_redis
    monkeypatch.setattr(redis_cache, "REDIS_RECONNECT_COOLDOWN", 30)
    calls = []

    def fake_connect():
        calls.append(time.time())
        rc.enabled = True

    monkeypatch.setattr(rc, "connect", fake_connect)

    # A reconnect was just attempted -> still inside the cooldown -> no retry.
    rc._last_connect_attempt = time.time()
    assert rc._ensure_connected() is False
    assert calls == []


def test_ensure_connected_reconnects_after_cooldown(monkeypatch, disabled_redis):
    rc = disabled_redis
    monkeypatch.setattr(redis_cache, "REDIS_RECONNECT_COOLDOWN", 30)
    calls = []

    def fake_connect():
        calls.append(time.time())
        rc.enabled = True

    monkeypatch.setattr(rc, "connect", fake_connect)

    # Last attempt is older than the cooldown -> exactly one reconnect, which
    # flips the client back to enabled.
    rc._last_connect_attempt = time.time() - 31
    assert rc._ensure_connected() is True
    assert len(calls) == 1

    # Now enabled again -> fast path, no further connect() calls.
    assert rc._ensure_connected() is True
    assert len(calls) == 1


def test_disabled_ops_degrade_to_miss(monkeypatch, disabled_redis):
    rc = disabled_redis
    # Keep it disabled for the duration of the asserts: long cooldown + a
    # just-now attempt timestamp so _ensure_connected never tries to reconnect.
    monkeypatch.setattr(redis_cache, "REDIS_RECONNECT_COOLDOWN", 3600)
    rc._last_connect_attempt = time.time()
    monkeypatch.setattr(rc, "connect", lambda: None)

    assert rc.get("k") is None
    assert rc.set("k", "v") is False
    assert rc.delete("k") is False
    assert rc.delete_pattern("k*") is False
    assert rc.flush_all() is False


def test_create_optimal_cache_keeps_redis_on_failed_connect(monkeypatch):
    """A failed initial connect must NOT downgrade to a per-instance MemoryCache."""
    monkeypatch.setattr(redis_cache, "REDIS_ENABLED", True)

    def fail_connect(self):
        self._last_connect_attempt = time.time()
        self.enabled = False

    monkeypatch.setattr(redis_cache.RedisCache, "connect", fail_connect)

    c = redis_cache.create_optimal_cache()
    assert isinstance(c, redis_cache.RedisCache)
    assert not isinstance(c, redis_cache.MemoryCache)


def test_create_optimal_cache_uses_memory_when_redis_not_configured(monkeypatch):
    monkeypatch.setattr(redis_cache, "REDIS_ENABLED", False)
    c = redis_cache.create_optimal_cache()
    assert isinstance(c, redis_cache.MemoryCache)
