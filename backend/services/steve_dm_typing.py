"""Short-lived typing indicators for Steve DM and group-chat replies."""

from __future__ import annotations

import logging

from redis_cache import cache, steve_dm_typing_key, steve_group_typing_key

logger = logging.getLogger(__name__)

DEFAULT_TYPING_TTL_SECONDS = 30


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
