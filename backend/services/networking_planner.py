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
- facets
- hard_constraints
- soft_constraints
- primary_dimensions
- secondary_dimensions
- hard_dimensions
- named_people
- search_rewrite
- needs_clarification
- clarifying_question

Facet keys may only be:
geography, industry, roles, company_builder, traits, interests, experiences, identity_life_stage

Dimension keys may only be:
Index, LifeCareer, GeographyCulture, Expertise, CompanyIntel, Opinions, Identity, Network, UniqueFingerprint, InferredContext

Dimension selection policy:
- Practitioner / goal-seeking asks ("I want to...", "help me...", "learn...", "achieve...", "find a mentor...") depend primarily on LifeCareer, Expertise, InferredContext, and UniqueFingerprint. Prefer people who have personally done the activity over people who merely work near the industry.
- Location asks depend primarily on GeographyCulture; use InferredContext and Index as secondary unless the ask is only current location.
- Trait / personality asks depend primarily on Identity and UniqueFingerprint; use Index as secondary.
- Company / industry asks depend primarily on Expertise, CompanyIntel, and LifeCareer.
- Opinion / belief asks depend primarily on Opinions and Expertise.
- Relationship, access, or community-connector asks depend primarily on Network; use Identity and Index as secondary.

Rules:
- Preserve prior user intent for follow-up questions.
- If the user mentions a person explicitly (including a bare given name or full legal name that appears in Known members), include that string in named_people.
- Use hard_constraints only for facets the user clearly requires.
- Use soft_constraints for preferences.
- Use primary_dimensions for the main KB dimensions this query depends on.
- Use secondary_dimensions for adjacent or broader evidence dimensions.
- Use hard_dimensions only when a KB dimension is truly required to satisfy the ask.
- search_rewrite should be a compact search query for retrieval.
- For sensitive life-stage / identity asks like parent, include them only when the user explicitly asked for them.
- If the ask is simple and single-facet, keep the JSON minimal.
- Never mention internal reasoning. JSON only.

Examples:
- User: "I want to fly a fighter jet and need someone who can help me achieve this dream"
  Plan: primary_dimensions=["LifeCareer","Expertise","InferredContext","UniqueFingerprint"], secondary_dimensions=["Index","GeographyCulture"], facets={"experiences":["pilot","commercial pilot","flying","aircraft","flight experience","gliding"]}, search_rewrite="pilot commercial pilot flying aircraft flight experience gliding aviation operations fighter jet mentor", hard_dimensions=["LifeCareer"]
- User: "Who lives in Lisbon?"
  Plan: primary_dimensions=["GeographyCulture"], secondary_dimensions=["Index"], facets={"geography":["Lisbon"]}, search_rewrite="Lisbon current location"
- User: "Who is goal-driven and collaborative?"
  Plan: primary_dimensions=["Identity","UniqueFingerprint"], secondary_dimensions=["Index"], facets={"traits":["goal-driven","collaborative"]}, search_rewrite="goal-driven collaborative traits values identity"
- User: "Who has strong opinions on AI regulation?"
  Plan: primary_dimensions=["Opinions","Expertise"], secondary_dimensions=["Index"], facets={"industry":["AI regulation"]}, search_rewrite="AI regulation opinions policy expertise"
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

    plan = {
        "facets": facets_out,
        "hard_constraints": _clean_constraints(raw_plan.get("hard_constraints")),
        "soft_constraints": _clean_constraints(raw_plan.get("soft_constraints")),
        "primary_dimensions": _clean_dimensions(raw_plan.get("primary_dimensions")),
        "secondary_dimensions": _clean_dimensions(raw_plan.get("secondary_dimensions")),
        "hard_dimensions": _clean_dimensions(raw_plan.get("hard_dimensions")),
        "named_people": named_people,
        "search_rewrite": str(raw_plan.get("search_rewrite") or "").strip()[:500],
        "needs_clarification": bool(raw_plan.get("needs_clarification")),
        "clarifying_question": str(raw_plan.get("clarifying_question") or "").strip()[:300],
    }
    return plan if (
        plan["facets"]
        or plan["primary_dimensions"]
        or plan["secondary_dimensions"]
        or plan["hard_dimensions"]
        or plan["named_people"]
        or plan["search_rewrite"]
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
