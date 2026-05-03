"""Reasoning planner helpers for Steve networking search."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable, Sequence

from backend.services.networking_ai_config import (
    DEFAULT_CONFIG,
    estimate_cost_usd,
    usage_tokens,
)
from backend.services.networking_retrieval import (
    KB_DIMENSIONS,
    NETWORKING_PLANNER_CONVERSATION_TURNS_SCAN,
    NETWORKING_PLANNER_PRIOR_USER_LINES,
    networking_planner_member_block,
    should_use_reasoning_planner,
)

logger = logging.getLogger(__name__)

ALLOWED_FACETS = (
    "geography",
    "industry",
    "roles",
    "company_builder",
    "traits",
    "interests",
    "experiences",
    "identity_life_stage",
)

PLANNER_SYSTEM_PROMPT = """You are a query planner for a private professional networking search assistant.
Return JSON only with keys:
- intent_summary
- target
- relationship_to_target
- dimension_analysis
- facets
- hard_constraints
- soft_constraints
- primary_dimensions
- secondary_dimensions
- hard_dimensions
- named_people
- search_rewrite
- direct_evidence_query
- adjacent_evidence_query
- deprioritized_evidence_query
- needs_clarification
- clarifying_question
- search_state_action

Facet keys may only be:
geography, industry, roles, company_builder, traits, interests, experiences, identity_life_stage

Dimension keys may only be:
Index, LifeCareer, GeographyCulture, Expertise, CompanyIntel, Opinions, Identity, Network, UniqueFingerprint, InferredContext, LifeInterests

Dimension reasoning policy:
- First identify the target of the request and the relationship the user wants to that target.
- Then assess every relevant KB dimension as primary, secondary, hard, or ignored for this exact request.
- Do not classify by a hardcoded domain taxonomy. Decide from what evidence would actually answer the user's ask.
- Primary dimensions are where decisive evidence is most likely to live.
- Secondary dimensions may contain helpful or adjacent evidence.
- Hard dimensions are required only when evidence in that dimension is necessary to satisfy the request.
- Ignored dimensions should not drive retrieval.

Rules:
- Preserve prior user intent for follow-up questions.
- If the user mentions a person explicitly (including a bare given name or full legal name that appears in Known members), include that string in named_people.
- Use hard_constraints only for facets the user clearly requires.
- Use soft_constraints for preferences.
- Use primary_dimensions for the main KB dimensions this query depends on.
- Use secondary_dimensions for adjacent or broader evidence dimensions.
- Use hard_dimensions only when a KB dimension is truly required to satisfy the ask.
- dimension_analysis must explain why each selected dimension is primary/secondary/hard/ignored.
- direct_evidence_query should describe concrete evidence that would make someone a direct match.
- adjacent_evidence_query should describe broader or weaker evidence that may still help.
- deprioritized_evidence_query should describe evidence that should not outrank direct matches.
- search_rewrite should combine the target, relationship, and direct evidence in a compact retrieval query.
- For sensitive life-stage / identity asks like parent, include them only when the user explicitly asked for them.
- Even when the ask is simple, still return target, relationship_to_target, dimension_analysis, primary_dimensions, secondary_dimensions, search_rewrite, and direct_evidence_query. Simple wording can still require nuanced dimension reasoning.
- search_state_action must be one of: clarify, retrieve, refine, close.
- Never mention internal reasoning. JSON only.

Examples:
- User: "I want people who know how to cook"
  Plan: target="cooking", relationship_to_target="direct personal capability", primary_dimensions=["LifeInterests","InferredContext"], secondary_dimensions=["UniqueFingerprint","Expertise","Identity"], direct_evidence_query="personally cooks cooking recipes culinary training chef hosts dinners weekly cooking", adjacent_evidence_query="food restaurants wine hospitality food industry", deprioritized_evidence_query="restaurant investor food tech without personal cooking evidence", search_state_action="retrieve"
- User: "I am looking for an angel investor to invest in C-Point"
  Plan: target="angel investment in C-Point", relationship_to_target="capital provider / direct investor", primary_dimensions=["LifeCareer","Expertise","CompanyIntel","InferredContext"], secondary_dimensions=["Network","UniqueFingerprint","Index"], direct_evidence_query="angel investor startup investor private investor key investor family office acquisition backer seed investor invested in companies", adjacent_evidence_query="finance venture capital banking startup fundraising advisor investor network", deprioritized_evidence_query="generic finance background without direct investing or backing evidence", search_state_action="retrieve"
- User: "Who lives in Lisbon?"
  Plan: target="Lisbon", relationship_to_target="current location", primary_dimensions=["GeographyCulture"], secondary_dimensions=["Index","InferredContext"], direct_evidence_query="currently lives in Lisbon based in Lisbon located in Lisbon", search_state_action="retrieve"
- User: "Who is goal-driven and collaborative?"
  Plan: target="goal-driven collaborative working style", relationship_to_target="traits and working style", primary_dimensions=["Identity","UniqueFingerprint"], secondary_dimensions=["Index","InferredContext"], direct_evidence_query="goal-driven collaborative traits values working style", search_state_action="retrieve"
"""


def extract_json_object(text: str) -> dict:
    text = (text or "").strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    try:
        data = json.loads(text[start : end + 1])
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def normalize_networking_query_plan(raw_plan: dict | None) -> dict | None:
    if not isinstance(raw_plan, dict):
        return None

    facets_in = raw_plan.get("facets") or {}
    facets_out: dict[str, list[str]] = {}
    for facet in ALLOWED_FACETS:
        values = facets_in.get(facet) if isinstance(facets_in, dict) else []
        if isinstance(values, str):
            values = [values]
        cleaned = []
        for value in values or []:
            s = str(value or "").strip()
            if s:
                cleaned.append(s[:120])
        if cleaned:
            facets_out[facet] = cleaned[:8]

    def _clean_dimensions(values):
        if isinstance(values, str):
            values = [values]
        return [dimension for dimension in (values or []) if dimension in KB_DIMENSIONS]

    def _clean_constraints(values):
        if isinstance(values, str):
            values = [values]
        return [facet for facet in (values or []) if facet in ALLOWED_FACETS]

    named_people = raw_plan.get("named_people") or []
    if isinstance(named_people, str):
        named_people = [named_people]
    named_people = [str(v).strip()[:120] for v in named_people if str(v).strip()][:6]

    def _clean_text(name: str, limit: int = 500) -> str:
        return str(raw_plan.get(name) or "").strip()[:limit]

    dimension_analysis_in = raw_plan.get("dimension_analysis") or {}
    dimension_analysis: dict[str, dict[str, str]] = {}
    if isinstance(dimension_analysis_in, dict):
        for dimension, value in dimension_analysis_in.items():
            if dimension not in KB_DIMENSIONS:
                continue
            if isinstance(value, str):
                priority = value.strip().lower()
                reason = ""
            elif isinstance(value, dict):
                priority = str(value.get("priority") or "").strip().lower()
                reason = str(value.get("reason") or "").strip()[:300]
            else:
                continue
            if priority in {"primary", "secondary", "hard", "ignored", "ignore"}:
                dimension_analysis[dimension] = {
                    "priority": "ignored" if priority == "ignore" else priority,
                    "reason": reason,
                }

    plan = {
        "intent_summary": _clean_text("intent_summary", 400),
        "target": _clean_text("target", 200),
        "relationship_to_target": _clean_text("relationship_to_target", 200),
        "dimension_analysis": dimension_analysis,
        "facets": facets_out,
        "hard_constraints": _clean_constraints(raw_plan.get("hard_constraints")),
        "soft_constraints": _clean_constraints(raw_plan.get("soft_constraints")),
        "primary_dimensions": _clean_dimensions(raw_plan.get("primary_dimensions")),
        "secondary_dimensions": _clean_dimensions(raw_plan.get("secondary_dimensions")),
        "hard_dimensions": _clean_dimensions(raw_plan.get("hard_dimensions")),
        "named_people": named_people,
        "search_rewrite": _clean_text("search_rewrite", 700),
        "direct_evidence_query": _clean_text("direct_evidence_query", 700),
        "adjacent_evidence_query": _clean_text("adjacent_evidence_query", 700),
        "deprioritized_evidence_query": _clean_text("deprioritized_evidence_query", 700),
        "needs_clarification": bool(raw_plan.get("needs_clarification")),
        "clarifying_question": str(raw_plan.get("clarifying_question") or "").strip()[:300],
        "search_state_action": _clean_text("search_state_action", 40)
        if _clean_text("search_state_action", 40) in {"clarify", "retrieve", "refine", "close"}
        else "retrieve",
    }
    if not plan["primary_dimensions"] and dimension_analysis:
        plan["primary_dimensions"] = [
            dimension for dimension, info in dimension_analysis.items() if info.get("priority") in {"primary", "hard"}
        ]
    if not plan["secondary_dimensions"] and dimension_analysis:
        plan["secondary_dimensions"] = [
            dimension for dimension, info in dimension_analysis.items() if info.get("priority") == "secondary"
        ]
    if not plan["hard_dimensions"] and dimension_analysis:
        plan["hard_dimensions"] = [
            dimension for dimension, info in dimension_analysis.items() if info.get("priority") == "hard"
        ]
    return plan if (
        plan["intent_summary"]
        or plan["target"]
        or plan["dimension_analysis"]
        or plan["facets"]
        or plan["primary_dimensions"]
        or plan["secondary_dimensions"]
        or plan["hard_dimensions"]
        or plan["named_people"]
        or plan["search_rewrite"]
        or plan["direct_evidence_query"]
    ) else None


def build_networking_planner_input(
    *,
    message: str,
    conversation_history: Any,
    member_rows: Sequence[Any],
    member_getter: Callable[[Any, int], Any],
) -> list[dict[str, str]]:
    recent_user_turns = []
    if isinstance(conversation_history, list):
        for turn in conversation_history[-NETWORKING_PLANNER_CONVERSATION_TURNS_SCAN:]:
            if not isinstance(turn, dict):
                continue
            if str(turn.get("role") or "").strip().lower() != "user":
                continue
            content = str(turn.get("content") or "").strip()
            if content:
                recent_user_turns.append(content)
    history_block = "\n".join(
        f"- {item}" for item in recent_user_turns[-NETWORKING_PLANNER_PRIOR_USER_LINES:]
    ) or "- (none)"
    member_block = networking_planner_member_block(member_rows, member_getter)
    return [
        {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Recent user turns:\n{history_block}\n\n"
                f"Current user message:\n{message}\n\n"
                f"Known members:\n{member_block}"
            ),
        },
    ]


def plan_networking_query(
    client,
    *,
    message: str,
    conversation_history: Any,
    member_rows: Sequence[Any],
    member_getter: Callable[[Any, int], Any],
    networking_ai_config=None,
    username: str | None = None,
    community_id=None,
) -> dict | None:
    """Run the optional reasoning planner and return a normalized plan."""
    if not should_use_reasoning_planner(message, conversation_history):
        return None
    networking_ai_config = networking_ai_config or DEFAULT_CONFIG
    planner_input = build_networking_planner_input(
        message=message,
        conversation_history=conversation_history,
        member_rows=member_rows,
        member_getter=member_getter,
    )
    try:
        t0 = time.time()
        response = client.responses.create(
            model=networking_ai_config.planner_model,
            input=planner_input,
            max_output_tokens=350,
            temperature=0.1,
        )
        response_time_ms = int((time.time() - t0) * 1000)
        try:
            from backend.services import ai_usage

            tokens_in, tokens_out = usage_tokens(response)
            ai_usage.log_usage(
                username or "unknown",
                surface=ai_usage.SURFACE_NETWORKING_STEVE,
                request_type="networking_planner",
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                cost_usd=estimate_cost_usd(
                    networking_ai_config,
                    "planner",
                    tokens_in,
                    tokens_out,
                ),
                response_time_ms=response_time_ms,
                community_id=community_id,
                model=networking_ai_config.planner_model,
            )
        except Exception as usage_err:
            logger.debug("Networking planner usage logging failed: %s", usage_err)
        planner_text = (response.output_text or "").strip() if hasattr(response, "output_text") else ""
        plan = normalize_networking_query_plan(extract_json_object(planner_text))
        if plan:
            logger.info(
                "Networking planner active facets=%s hard=%s named=%s",
                sorted((plan.get("facets") or {}).keys()),
                plan.get("hard_constraints") or [],
                plan.get("named_people") or [],
            )
        return plan
    except Exception:
        logger.warning("Networking planner failed; falling back to direct retrieval", exc_info=True)
        return None
