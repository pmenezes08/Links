"""Prompt policy for Steve networking responses."""

from __future__ import annotations

from typing import Any, Mapping


DIMENSION_REASONING_RESPONSE_RULE = """DIMENSION-EVIDENCE MATCHING:
- Follow the internal query plan's dimension analysis. Primary dimensions contain the decisive evidence for this specific ask; secondary dimensions are supporting or adjacent.
- Lead with members whose roster evidence satisfies the direct_evidence_query in primary or hard dimensions.
- Use adjacent_evidence_query only for broader-angle matches, and label those as broader if no direct evidence exists.
- Deprioritized evidence should never outrank direct evidence.
- Do not expose dimension names, internal plans, or scoring details to the user."""

SEARCH_LIFECYCLE_RESPONSE_RULE = """SEARCH CLOSURE:
- After giving recommendations, end with one short question asking whether this solved the search or whether the user wants you to refine it.
- If the user indicates they are satisfied, treat the search as closed and do not keep refining the same intent unless they ask.
- If the user corrects or narrows the ask, treat it as a refinement of the current search."""


def final_answer_policy_block(query_plan: Mapping[str, Any] | None = None) -> str:
    """Return reusable final-answer policy text.

    The rule is always safe to include because it instructs Steve to follow the
    generic planner contract without exposing internal dimension mechanics.
    """
    action = str((query_plan or {}).get("search_state_action") or "retrieve").strip().lower()
    lifecycle = SEARCH_LIFECYCLE_RESPONSE_RULE
    if action == "clarify":
        lifecycle = (
            "SEARCH CLOSURE:\n"
            "- If clarification is needed, ask one focused question and do not recommend people yet."
        )
    return f"{DIMENSION_REASONING_RESPONSE_RULE}\n\n{lifecycle}"
