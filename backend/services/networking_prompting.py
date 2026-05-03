"""Prompt policy for Steve networking responses."""

from __future__ import annotations

from typing import Any, Mapping


EXPERIENTIAL_GOAL_RESPONSE_RULE = """EXPERIENTIAL GOALS:
- If the user wants to personally do, learn, try, achieve, or get introduced into an activity, lead with members who have direct lived/practitioner experience doing that thing.
- People who work in the adjacent industry, invest in the sector, or know companies around it are broader-angle matches unless their roster evidence says they personally did the activity.
- For these asks, direct evidence in LifeCareer, Expertise, InferredContext, or UniqueFingerprint should beat generic industry proximity."""


def final_answer_policy_block(query_plan: Mapping[str, Any] | None = None) -> str:
    """Return reusable final-answer policy text.

    The rule is always safe to include because it only changes ordering when the
    user's request is experiential; otherwise it is inert guidance.
    """
    return EXPERIENTIAL_GOAL_RESPONSE_RULE
