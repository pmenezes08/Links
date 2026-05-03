"""Sanitized debug traces for Steve networking retrieval.

This module intentionally returns compact, JSON-safe diagnostics only. It does
not include raw prompts, API keys, cookies, or full member context.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence


DEFAULT_TEXT_LIMIT = 500
DEFAULT_LIST_LIMIT = 20
DEFAULT_DETAIL_LIMIT = 30
_SENSITIVE_KEY_PARTS = ("api_key", "secret", "cookie", "session", "token", "authorization", "system_prompt")


def _safe_text(value: Any, *, limit: int = DEFAULT_TEXT_LIMIT) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def _safe_number(value: Any) -> float | int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return round(value, 6)
    try:
        return round(float(value), 6)
    except Exception:
        return None


def _json_safe(value: Any, *, depth: int = 0, text_limit: int = DEFAULT_TEXT_LIMIT) -> Any:
    if depth > 4:
        return _safe_text(value, limit=160)
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return _safe_number(value)
    if isinstance(value, str):
        return _safe_text(value, limit=text_limit)
    if isinstance(value, set):
        return sorted(_safe_text(v, limit=120) for v in value)[:DEFAULT_LIST_LIMIT]
    if isinstance(value, (list, tuple)):
        return [_json_safe(v, depth=depth + 1, text_limit=text_limit) for v in value[:DEFAULT_LIST_LIMIT]]
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for key, item in list(value.items())[:DEFAULT_LIST_LIMIT]:
            safe_key = _safe_text(key, limit=80)
            if any(part in safe_key.lower() for part in _SENSITIVE_KEY_PARTS):
                out[safe_key] = "[redacted]"
                continue
            out[safe_key] = _json_safe(item, depth=depth + 1, text_limit=text_limit)
        return out
    return _safe_text(value, limit=text_limit)


def _candidate_details(
    usernames: Sequence[str] | None,
    details: Mapping[str, Mapping[str, Any]] | None,
    *,
    limit: int = DEFAULT_DETAIL_LIMIT,
) -> list[dict[str, Any]]:
    details = details or {}
    rows: list[dict[str, Any]] = []
    for rank, username in enumerate([str(u) for u in (usernames or []) if str(u).strip()][:limit], start=1):
        info = details.get(username) or {}
        rows.append(
            {
                "rank": rank,
                "username": username,
                "score": _safe_number(info.get("score")),
                "structured_score": _safe_number(info.get("structured_score")),
                "semantic_score": _safe_number(info.get("semantic_score")),
                "matched_dimensions": _json_safe(info.get("matched_dimensions") or []),
                "primary_hits": int(info.get("primary_hits") or 0),
                "secondary_hits": int(info.get("secondary_hits") or 0),
                "hard_hits": int(info.get("hard_hits") or 0),
                "hard_misses": int(info.get("hard_misses") or 0),
                "direct_evidence_hits": int(info.get("direct_evidence_hits") or 0),
                "adjacent_evidence_hits": int(info.get("adjacent_evidence_hits") or 0),
                "deprioritized_evidence_hits": int(info.get("deprioritized_evidence_hits") or 0),
                "best_chunk_type": _safe_text(info.get("best_chunk_type"), limit=80),
                "semantic_rank": info.get("semantic_rank"),
            }
        )
    return rows


def build_networking_debug_trace(
    *,
    query_plan: Mapping[str, Any] | None,
    dimension_plan: Mapping[str, Any] | None,
    retrieval_query: str,
    structured_ids: Sequence[str],
    structured_details: Mapping[str, Mapping[str, Any]],
    semantic_ids: Sequence[str],
    semantic_details: Mapping[str, Mapping[str, Any]],
    candidate_pool: Sequence[str],
    metadata_scores: Mapping[str, Mapping[str, Any]],
    ordered_usernames: Sequence[str],
    tiered_matches: Mapping[str, str],
    forced_usernames: Sequence[str],
    retrieval_policy: Mapping[str, Any],
    all_member_usernames: Sequence[str],
    model_used: str,
    recommended: Sequence[str],
    ai_response: str,
    planner_model: str = "",
) -> dict[str, Any]:
    """Build a compact JSON-safe trace for admin diagnostics."""
    qp = query_plan or {}
    dp = dimension_plan or {}
    ordered = [str(u) for u in ordered_usernames if str(u).strip()]
    return {
        "planner": {
            "model": _safe_text(planner_model, limit=100),
            "normalized_plan": _json_safe(qp),
            "intent_summary": _safe_text(qp.get("intent_summary")),
            "target": _safe_text(qp.get("target"), limit=200),
            "relationship_to_target": _safe_text(qp.get("relationship_to_target"), limit=200),
            "dimension_analysis": _json_safe(qp.get("dimension_analysis") or {}),
            "direct_evidence_query": _safe_text(qp.get("direct_evidence_query"), limit=700),
            "adjacent_evidence_query": _safe_text(qp.get("adjacent_evidence_query"), limit=700),
            "deprioritized_evidence_query": _safe_text(qp.get("deprioritized_evidence_query"), limit=700),
            "search_state_action": _safe_text(qp.get("search_state_action"), limit=40),
        },
        "retrieval": {
            "retrieval_query": _safe_text(retrieval_query, limit=900),
            "dimension_plan": _json_safe(dp),
            "structured_candidates": _candidate_details(structured_ids, structured_details),
            "semantic_candidates": _candidate_details(semantic_ids, semantic_details),
        },
        "fusion": {
            "candidate_pool": [str(u) for u in candidate_pool[:DEFAULT_DETAIL_LIMIT]],
            "metadata_scores": _json_safe(metadata_scores),
            "ordered_usernames": ordered[:DEFAULT_DETAIL_LIMIT],
            "tiered_matches": _json_safe({u: tiered_matches.get(u) for u in ordered[:DEFAULT_DETAIL_LIMIT]}),
            "forced_usernames": [str(u) for u in forced_usernames[:DEFAULT_LIST_LIMIT]],
        },
        "context": {
            "member_count": len(all_member_usernames or []),
            "retrieval_policy": _json_safe(retrieval_policy),
            "prompt_member_cap": retrieval_policy.get("prompt_member_cap"),
            "full_context_cap": retrieval_policy.get("full_context_cap"),
            "members_sent_to_final_model": ordered[: int(retrieval_policy.get("prompt_member_cap") or DEFAULT_DETAIL_LIMIT)],
        },
        "final_answer": {
            "model": _safe_text(model_used, limit=100),
            "recommended_usernames": [str(u) for u in recommended[:DEFAULT_LIST_LIMIT]],
            "response_preview": _safe_text(ai_response, limit=700),
        },
    }
