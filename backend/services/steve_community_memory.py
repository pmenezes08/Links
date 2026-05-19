"""Firestore-backed compact memory for community-feed Steve."""

from __future__ import annotations

import logging
from typing import Any, Iterable, Optional

from backend.services import community as community_svc

logger = logging.getLogger(__name__)


def get_compact_community_memory(community_id: int) -> str:
    """Return a compact community memory block for Steve prompts.

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
        fs = _get_client()
        direct = fs.collection("steve_community_memory").document(str(root_id)).get()
        if direct.exists:
            text = _render_direct_memory(direct.to_dict() or {})
            if text:
                return text
        kb_doc = fs.collection("steve_knowledge_base").document(f"_network_{root_id}_CommunityIndex").get()
        if kb_doc.exists:
            text = _render_kb_memory(kb_doc.to_dict() or {})
            if text:
                return text
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


def _render_kb_memory(data: dict[str, Any]) -> str:
    content = data.get("content") or {}
    if isinstance(content, str):
        return f"Community memory summary: {content.strip()}" if content.strip() else ""
    if isinstance(content, dict):
        return _render_direct_memory(content)
    return ""


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
