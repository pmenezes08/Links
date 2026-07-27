"""Firestore-backed compact memory for community-feed Steve.

Written by ``backend.services.steve_community_brain`` (cron synthesis).
Freshness is a hard contract: docs without a recent ``updatedAt`` are refused,
so memory degrades to *no memory*, never to *frozen memory* (the pre-2026-07
reader would have injected a stale blob forever; it also had a fallback to a
``_network_{id}_CommunityIndex`` KB doc that nothing ever wrote — removed).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from backend.services import community as community_svc

logger = logging.getLogger(__name__)

DEFAULT_FRESHNESS_DAYS = 14
DEFAULT_CARD_MAX_CHARS = 900


def is_memory_fresh(
    data: dict[str, Any],
    *,
    freshness_days: int = DEFAULT_FRESHNESS_DAYS,
    now: Optional[datetime] = None,
) -> bool:
    """True when the doc carries a parseable ``updatedAt`` within the window."""
    raw = str(data.get("updatedAt") or "").strip()
    if not raw:
        return False
    try:
        updated = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return False
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return (current - updated) <= timedelta(days=max(1, int(freshness_days)))


def get_compact_community_memory(community_id: int) -> str:
    """Return a compact, fresh community memory block for Steve prompts.

    MySQL remains canonical for posts, docs, links, events, and polls. This
    helper reads only synthesized memory from Firestore so prompts can feel
    community-aware without dumping every raw asset into each model call.
    """
    try:
        root_id, _ = community_svc.resolve_root_community_id(int(community_id))
    except Exception:
        root_id = community_id
    try:
        from backend.services.firestore_reads import USE_FIRESTORE_READS, _get_client

        if not USE_FIRESTORE_READS:
            return ""
        try:
            from backend.services.steve_community_brain import get_brain_config

            cfg = get_brain_config()
            freshness_days = cfg.freshness_days
            card_max_chars = cfg.card_max_chars
        except Exception:
            freshness_days = DEFAULT_FRESHNESS_DAYS
            card_max_chars = DEFAULT_CARD_MAX_CHARS
        fs = _get_client()
        direct = fs.collection("steve_community_memory").document(str(root_id)).get()
        if direct.exists:
            data = direct.to_dict() or {}
            if not is_memory_fresh(data, freshness_days=freshness_days):
                logger.debug("Steve community memory for %s is stale — skipping", root_id)
                return ""
            text = _render_direct_memory(data)
            if text:
                return text[: max(200, int(card_max_chars))]
    except Exception as exc:
        logger.debug("Could not load Steve community memory for %s: %s", community_id, exc)
    return ""


def _render_direct_memory(data: dict[str, Any]) -> str:
    parts = []
    summary = str(data.get("currentSummary") or data.get("summary") or "").strip()
    if summary:
        parts.append(f"Community memory summary: {summary}")
    for label, key in (
        ("Recurring topics", "topics"),
        ("Important links", "importantLinks"),
        ("Important documents", "importantDocs"),
        ("Upcoming events", "upcomingEventsSummary"),
        ("Active decisions", "activeDecisions"),
        ("Recent signals", "recentSignals"),
    ):
        rendered = _render_value(data.get(key))
        if rendered:
            parts.append(f"{label}: {rendered}")
    return "\n".join(parts).strip()


def _render_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        bits = []
        for key, raw in value.items():
            rendered = _render_value(raw)
            if rendered:
                bits.append(f"{key}: {rendered}")
        return "; ".join(bits)
    if isinstance(value, Iterable):
        return "; ".join(str(v).strip() for v in value if str(v).strip())
    return str(value).strip()
