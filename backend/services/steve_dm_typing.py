"""Short-lived typing indicators for Steve DM and group-chat replies."""

from __future__ import annotations

import logging
import threading
from typing import Optional

from redis_cache import cache, steve_dm_inflight_key, steve_dm_typing_key, steve_group_typing_key

logger = logging.getLogger(__name__)

DEFAULT_TYPING_TTL_SECONDS = 30
INFLIGHT_LOCK_TTL_SECONDS = 120
TYPING_HEARTBEAT_SECONDS = 10


def _set_flag(key: str, ttl: int = DEFAULT_TYPING_TTL_SECONDS) -> None:
    try:
        cache.set(key, "1", ttl)
    except Exception as exc:
        logger.warning("Steve typing flag set failed for %s: %s", key, exc)


def _delete_flag(key: str) -> None:
    try:
        cache.delete(key)
    except Exception as exc:
        logger.warning("Steve typing flag delete failed for %s: %s", key, exc)


def _has_flag(key: str) -> bool:
    try:
        return cache.get(key) is not None
    except Exception as exc:
        logger.warning("Steve typing flag read failed for %s: %s", key, exc)
        return False


def mark_dm_typing(sender: str, peer: str, ttl: int = DEFAULT_TYPING_TTL_SECONDS) -> None:
    """Mark Steve as typing in a 1:1 DM from both users' perspectives."""
    if not sender or not peer:
        return
    _set_flag(steve_dm_typing_key(sender, peer), ttl)
    _set_flag(steve_dm_typing_key(peer, sender), ttl)


def refresh_dm_typing(sender: str, peer: str, ttl: int = DEFAULT_TYPING_TTL_SECONDS) -> None:
    """Extend Steve typing indicators while a long-running reply is in progress."""
    mark_dm_typing(sender, peer, ttl=ttl)


def clear_dm_typing(sender: str, peer: str) -> None:
    """Clear Steve typing indicators for both sides of a 1:1 DM."""
    if not sender or not peer:
        return
    _delete_flag(steve_dm_typing_key(sender, peer))
    _delete_flag(steve_dm_typing_key(peer, sender))


def is_dm_typing(viewer: str, peer: str) -> bool:
    if not viewer or not peer:
        return False
    return _has_flag(steve_dm_typing_key(viewer, peer))


class DmTypingHeartbeat:
    """Background refresher so typing survives long xAI calls (> default TTL)."""

    def __init__(self, sender: str, peer: str) -> None:
        self._sender = sender
        self._peer = peer
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if not self._sender or not self._peer:
            return

        def _loop() -> None:
            while not self._stop.wait(TYPING_HEARTBEAT_SECONDS):
                refresh_dm_typing(self._sender, self._peer)

        self._thread = threading.Thread(target=_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()


def try_acquire_dm_inflight(user_a: str, user_b: str, ttl: int = INFLIGHT_LOCK_TTL_SECONDS) -> bool:
    """Return True if this thread acquired the in-flight lock."""
    key = steve_dm_inflight_key(user_a, user_b)
    try:
        if cache.get(key) is not None:
            return False
        cache.set(key, "1", ttl)
        return True
    except Exception as exc:
        logger.warning("Steve DM inflight lock acquire failed: %s", exc)
        return True


def release_dm_inflight(user_a: str, user_b: str) -> None:
    key = steve_dm_inflight_key(user_a, user_b)
    try:
        cache.delete(key)
    except Exception as exc:
        logger.warning("Steve DM inflight lock release failed: %s", exc)


def mark_group_typing(group_id: int, ttl: int = DEFAULT_TYPING_TTL_SECONDS) -> None:
    if group_id is None:
        return
    _set_flag(steve_group_typing_key(group_id), ttl)


def clear_group_typing(group_id: int) -> None:
    if group_id is None:
        return
    _delete_flag(steve_group_typing_key(group_id))


def is_group_typing(group_id: int) -> bool:
    if group_id is None:
        return False
    return _has_flag(steve_group_typing_key(group_id))
