"""Viewer-scoped Redis cache wrapper around ``post_detail_read``.

The cache stores the entire response body (``{"success": True, "post": ...}``
for community/general posts, or ``{"success": True, "post": ..., "group": ...,
"community_id": ...}`` for group posts) under a viewer-scoped, versioned key:

```
post_detail:v1:community:{post_id}:viewer:{username}
post_detail:v1:group:{post_id}:viewer:{username}
```

Viewer-scoping is required because the payload includes per-viewer flags
(``user_reaction``, ``is_starred``, ``is_community_starred``,
``is_community_admin``, ``can_edit``, ``can_delete``,
``can_toggle_community_key``). Sharing a single key across viewers would leak
or mis-report these.

TTL is intentionally tight (``CACHE_TTL_POST_DETAIL``, default 60s); the cache
is **not** the source of truth — it is a hot-window accelerator for the
repeat-open and SWR client patterns landing in PR 5. Explicit invalidation
runs at every mutation site (see ``docs/PRODUCT_JOURNEYS.md`` § post detail).
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Tuple

from redis_cache import (
    CACHE_TTL_POST_DETAIL,
    cache,
    post_detail_community_cache_key,
    post_detail_community_cache_pattern,
    post_detail_group_cache_key,
    post_detail_group_cache_pattern,
)

logger = logging.getLogger(__name__)


# --- Read paths --------------------------------------------------------------


def get_cached_community_post_detail(
    post_id: int, username: str
) -> Tuple[Dict[str, Any], int]:
    """Return ``(body, status)`` for ``/get_post``, going through cache.

    Cache misses fall through to ``read_community_post_detail``. Only
    successful 200 responses are cached; errors and not-found responses are
    served live so a transient failure does not pin the wrong shape for 60s.
    """
    from backend.services.post_detail_read import read_community_post_detail

    if not post_id:
        return read_community_post_detail(post_id, username)

    key = post_detail_community_cache_key(post_id, username)
    try:
        cached = cache.get(key)
    except Exception as e:
        logger.warning("post_detail cache get failed for %s: %s", key, e)
        cached = None
    if cached is not None:
        logger.debug("post_detail cache hit: %s", key)
        return cached, 200

    body, status = read_community_post_detail(post_id, username)
    if status == 200 and isinstance(body, dict) and body.get("success"):
        try:
            cache.set(key, body, CACHE_TTL_POST_DETAIL)
        except Exception as e:
            logger.warning("post_detail cache set failed for %s: %s", key, e)
    return body, status


def get_cached_group_post_detail(
    post_id: int, username: str
) -> Tuple[Dict[str, Any], int]:
    """Return ``(body, status)`` for ``/api/group_post``, going through cache."""
    from backend.services.post_detail_read import read_group_post_detail

    if not post_id:
        return read_group_post_detail(post_id, username)

    key = post_detail_group_cache_key(post_id, username)
    try:
        cached = cache.get(key)
    except Exception as e:
        logger.warning("post_detail cache get failed for %s: %s", key, e)
        cached = None
    if cached is not None:
        logger.debug("post_detail cache hit: %s", key)
        return cached, 200

    body, status = read_group_post_detail(post_id, username)
    if status == 200 and isinstance(body, dict) and body.get("success"):
        try:
            cache.set(key, body, CACHE_TTL_POST_DETAIL)
        except Exception as e:
            logger.warning("post_detail cache set failed for %s: %s", key, e)
    return body, status


# --- Invalidation ------------------------------------------------------------


def invalidate_post_detail(post_id: Optional[int], scope: str = "community") -> None:
    """Bust every viewer's cached blob for a single post.

    ``scope`` is one of ``"community"`` (also covers general/feed posts) or
    ``"group"``. Failures are logged and swallowed — a stale 60s window is
    acceptable; raising would block the underlying mutation.
    """
    if not post_id:
        return
    try:
        pattern = (
            post_detail_group_cache_pattern(post_id)
            if scope == "group"
            else post_detail_community_cache_pattern(post_id)
        )
        cache.delete_pattern(pattern)
        logger.debug("post_detail cache invalidated (%s): %s", scope, pattern)
    except Exception as e:
        logger.warning(
            "invalidate_post_detail failed for post_id=%s scope=%s: %s",
            post_id, scope, e,
        )


def invalidate_post_detail_viewer(
    post_id: Optional[int], username: str, scope: str = "community"
) -> None:
    """Bust the cached blob for a single ``(post_id, viewer)`` pair.

    Used for viewer-only changes (star toggle, viewer reaction) so we don't
    take out every other viewer's hot cache.
    """
    if not post_id or not username:
        return
    try:
        key = (
            post_detail_group_cache_key(post_id, username)
            if scope == "group"
            else post_detail_community_cache_key(post_id, username)
        )
        cache.delete(key)
        logger.debug("post_detail cache invalidated (%s, viewer): %s", scope, key)
    except Exception as e:
        logger.warning(
            "invalidate_post_detail_viewer failed for post_id=%s viewer=%s scope=%s: %s",
            post_id, username, scope, e,
        )
