"""Shared fixed-window rate limiter over the app cache (Redis in prod).

The platform has had no UGC rate limiting at all; this is the one primitive
every abuse-facing surface should reuse (reporting now; posting/messaging in
the moderation Phase 3). Fixed window on ``redis_cache.cache.incr`` — atomic
in Redis, best-effort in the in-process fallback.

Fail-open by design: when the cache is unavailable the action is allowed.
A limiter must degrade to "the feature works" rather than "nobody can
report content because Redis blipped".
"""

from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)


def allow(action: str, identity: str, *, max_events: int, window_seconds: int) -> bool:
    """True when ``identity`` may perform ``action`` in the current window.

    Counts the call (a denied call still consumes nothing extra — the
    counter only ticks past ``max_events`` while the window lasts).
    """
    if max_events <= 0 or window_seconds <= 0:
        return True
    identity = (identity or "").strip().lower()
    if not identity:
        return True
    try:
        from redis_cache import cache

        window = int(time.time() // window_seconds)
        key = f"rl:{action}:{identity}:{window}"
        count = cache.incr(key, ttl=window_seconds)
        if count is None:  # cache disabled/unreachable — fail open
            return True
        return int(count) <= max_events
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("rate_limit.allow failed for %s/%s: %s", action, identity, exc)
        return True
