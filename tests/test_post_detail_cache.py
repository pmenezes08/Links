"""Tests for ``backend.services.post_detail_cache``.

Covers viewer-scoped key shape, hit/miss behaviour, error pass-through, and the
two invalidation helpers (full vs viewer-only). The underlying ``cache`` is the
in-memory ``MemoryCache`` shipped with ``redis_cache.py`` on test machines, so
no Redis container is required.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from redis_cache import (
    cache,
    post_detail_community_cache_key,
    post_detail_community_cache_pattern,
    post_detail_group_cache_key,
)


def _clear_post_detail_cache() -> None:
    try:
        cache.delete_pattern("post_detail:*")
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _isolate_cache():
    _clear_post_detail_cache()
    yield
    _clear_post_detail_cache()


def test_community_cache_key_is_viewer_scoped_and_lowercased():
    a = post_detail_community_cache_key(42, "Alice")
    b = post_detail_community_cache_key(42, "alice")
    c = post_detail_community_cache_key(42, "bob")
    assert a == b
    assert a != c
    assert "viewer:alice" in a
    assert "v2:community:42" in a


def test_group_cache_key_distinguishes_from_community():
    g = post_detail_group_cache_key(7, "alice")
    c = post_detail_community_cache_key(7, "alice")
    assert g != c
    assert "v2:group:7" in g


def test_cached_community_read_hits_cache_on_repeat():
    from backend.services import post_detail_cache

    body = {"success": True, "post": {"id": 1, "content": "hi"}}
    calls = {"n": 0}

    def fake_read(post_id, username):
        calls["n"] += 1
        return body, 200

    with patch(
        "backend.services.post_detail_read.read_community_post_detail",
        side_effect=fake_read,
    ):
        first_body, first_status = post_detail_cache.get_cached_community_post_detail(1, "alice")
        second_body, second_status = post_detail_cache.get_cached_community_post_detail(1, "alice")

    assert first_status == second_status == 200
    assert first_body == body
    assert second_body == body
    assert calls["n"] == 1


def test_cached_community_read_does_not_cache_errors():
    from backend.services import post_detail_cache

    calls = {"n": 0}

    def fake_read(post_id, username):
        calls["n"] += 1
        return {"success": False, "error": "Post not found"}, 404

    with patch(
        "backend.services.post_detail_read.read_community_post_detail",
        side_effect=fake_read,
    ):
        post_detail_cache.get_cached_community_post_detail(99, "alice")
        post_detail_cache.get_cached_community_post_detail(99, "alice")

    assert calls["n"] == 2


def test_invalidate_post_detail_busts_every_viewer():
    from backend.services import post_detail_cache

    body = {"success": True, "post": {"id": 5}}

    def fake_read(post_id, username):
        return body, 200

    with patch(
        "backend.services.post_detail_read.read_community_post_detail",
        side_effect=fake_read,
    ):
        post_detail_cache.get_cached_community_post_detail(5, "alice")
        post_detail_cache.get_cached_community_post_detail(5, "bob")

    assert cache.get(post_detail_community_cache_key(5, "alice")) is not None
    assert cache.get(post_detail_community_cache_key(5, "bob")) is not None

    post_detail_cache.invalidate_post_detail(5, scope="community")

    assert cache.get(post_detail_community_cache_key(5, "alice")) is None
    assert cache.get(post_detail_community_cache_key(5, "bob")) is None


def test_invalidate_post_detail_viewer_keeps_other_viewers():
    from backend.services import post_detail_cache

    body = {"success": True, "post": {"id": 11}}

    def fake_read(post_id, username):
        return body, 200

    with patch(
        "backend.services.post_detail_read.read_community_post_detail",
        side_effect=fake_read,
    ):
        post_detail_cache.get_cached_community_post_detail(11, "alice")
        post_detail_cache.get_cached_community_post_detail(11, "bob")

    post_detail_cache.invalidate_post_detail_viewer(11, "alice", scope="community")

    assert cache.get(post_detail_community_cache_key(11, "alice")) is None
    assert cache.get(post_detail_community_cache_key(11, "bob")) is not None


def test_group_cache_uses_group_pattern_for_invalidation():
    from backend.services import post_detail_cache

    body = {"success": True, "post": {"id": 21, "is_group_post": True}}

    def fake_read(post_id, username):
        return body, 200

    with patch(
        "backend.services.post_detail_read.read_group_post_detail",
        side_effect=fake_read,
    ):
        post_detail_cache.get_cached_group_post_detail(21, "alice")
        post_detail_cache.get_cached_group_post_detail(21, "bob")

    assert cache.get(post_detail_group_cache_key(21, "alice")) is not None
    post_detail_cache.invalidate_post_detail(21, scope="group")
    assert cache.get(post_detail_group_cache_key(21, "alice")) is None
    assert cache.get(post_detail_group_cache_key(21, "bob")) is None


def test_invalid_post_id_bypasses_cache():
    from backend.services import post_detail_cache

    calls = {"n": 0}

    def fake_read(post_id, username):
        calls["n"] += 1
        return {"success": False, "error": "Post ID is required"}, 400

    with patch(
        "backend.services.post_detail_read.read_community_post_detail",
        side_effect=fake_read,
    ):
        post_detail_cache.get_cached_community_post_detail(0, "alice")
        post_detail_cache.get_cached_community_post_detail(0, "alice")

    assert calls["n"] == 2
