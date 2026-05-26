"""Steve DM in-flight lock prevents overlapping Grok turns."""

from __future__ import annotations

from backend.services.steve_dm_typing import release_dm_inflight, try_acquire_dm_inflight


def test_inflight_lock_serializes_two_attempts():
    release_dm_inflight("alice", "steve")
    assert try_acquire_dm_inflight("alice", "steve") is True
    assert try_acquire_dm_inflight("alice", "steve") is False
    release_dm_inflight("alice", "steve")
    assert try_acquire_dm_inflight("alice", "steve") is True
    release_dm_inflight("alice", "steve")
