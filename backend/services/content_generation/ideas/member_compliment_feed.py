"""Community feed idea: Steve compliments a member with safe profile context."""

from __future__ import annotations

import random
import re
from typing import Any, Dict, List

from backend.services.community import fetch_community_names
from backend.services.content_generation.llm import XAI_API_KEY, generate_json
from backend.services.content_generation.types import IdeaDescriptor, IdeaExecutionResult, IdeaField
from backend.services.database import get_db_connection
from backend.services.steve_knowledge_base import (
    build_knowledge_context_for_steve,
    build_knowledge_context_slim,
)


DESCRIPTOR = IdeaDescriptor(
    idea_id="member_compliment_feed",
    title="Member Compliment Post",
    description="Steve posts a short community compliment for a member.",
    target_type="community",
    delivery_channel="feed_post",
    surfaces=("community", "admin"),
    payload_fields=(
        IdeaField(
            name="target_username",
            label="Member (optional)",
            required=False,
            placeholder="Leave blank for Steve to choose",
            help_text="If blank, Steve will choose a member from this community.",
        ),
    ),
)


def _community_member_usernames(community_id: int) -> List[str]:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            SELECT u.username
            FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            WHERE uc.community_id = ?
            ORDER BY u.username
            """,
            (community_id,),
        )
        rows = c.fetchall() or []
    usernames = []
    for row in rows:
        username = row["username"] if hasattr(row, "keys") else row[0]
        normalized = str(username or "").strip().lower()
        if normalized in {"", "steve", "admin", "system"}:
            continue
        usernames.append(str(username).strip())
    return usernames


def _community_name(community_id: int) -> str:
    with get_db_connection() as conn:
        names = fetch_community_names(conn.cursor(), [community_id])
    return str(names[0]).strip() if names else ""


def _fallback_body(target_username: str, community_name: str) -> str:
    community_label = community_name or "this community"
    return (
        f"@{target_username}, Steve hopes you have a great day. "
        f"Glad you're part of {community_label}."
    )


def _normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _fact_is_grounded(fact_used: str, kb_context: str) -> bool:
    normalized_fact = _normalize_text(fact_used)
    normalized_context = _normalize_text(kb_context)
    return bool(normalized_fact and len(normalized_fact) >= 8 and normalized_fact in normalized_context)


def _contains_internal_identifier(text: str) -> bool:
    return bool(
        re.search(r"\bcommunity\s*#?\d+\b", text or "", flags=re.IGNORECASE)
        or re.search(r"\binternal\s+id\b", text or "", flags=re.IGNORECASE)
    )


def _contains_unsupported_claim(text: str) -> bool:
    patterns = (
        r"\balways brightens\b",
        r"\bthe whole community\b",
        r"\beveryone (?:here )?(?:loves|appreciates|knows)\b",
        r"\byour presence\b",
        r"\bthanks for being awesome\b",
        r"\byou make .* better\b",
    )
    return any(re.search(pattern, text or "", flags=re.IGNORECASE) for pattern in patterns)


def _prompt_context_for_member(target_username: str) -> str:
    slim_context = build_knowledge_context_slim(target_username).strip()
    if slim_context:
        return slim_context[:900]
    full_context = build_knowledge_context_for_steve(target_username).strip()
    if not full_context:
        return ""
    return "\n".join(full_context.splitlines()[:12])[:1200]


def _grounded_rewrite(target_username: str, community_name: str, fact_used: str) -> str:
    community_label = community_name or "this community"
    return (
        f"@{target_username}, Steve appreciates this about you: {fact_used}. "
        f"Wishing you a great day in {community_label}."
    )


def execute(job: Dict[str, Any]) -> IdeaExecutionResult:
    community_id = int(job.get("community_id") or 0)
    if not community_id:
        raise ValueError("A community target is required")

    payload = job.get("payload") or {}
    candidates = _community_member_usernames(community_id)
    if not candidates:
        raise ValueError("No eligible members found in this community")

    requested_username = str(payload.get("target_username") or "").strip()
    if requested_username and requested_username not in candidates:
        raise ValueError("Selected member is not part of this community")
    target_username = requested_username or random.choice(candidates)
    community_name = _community_name(community_id)

    if not XAI_API_KEY:
        content = _fallback_body(target_username, community_name)
        return IdeaExecutionResult(
            delivery_channel="feed_post",
            content=content,
            meta={"target_username": target_username, "community_name": community_name},
        )

    kb_context = _prompt_context_for_member(target_username)
    response = generate_json(
        system_prompt=(
            "You are Steve writing a short, warm, public compliment for a community member. "
            "Use only explicit, positive, non-sensitive facts from the supplied profile context. "
            "Never mention internal IDs, numeric community identifiers, databases, or unsupported claims about social impact. "
            "Do not provide medical, legal, financial, tax, investment, regulatory, compliance, or mental-health advice. "
            "If the context is too weak for a grounded compliment, write a neutral greeting instead and leave fact_used empty. "
            "Start the message with the target @username. "
            "Return JSON with keys body and fact_used. "
            "fact_used must be either an exact short snippet copied from the provided profile context or an empty string."
        ),
        user_prompt=(
            f"Target member: @{target_username}\n"
            f"Community name: {community_name or 'Community unavailable'}\n"
            f"Profile context:\n{kb_context or 'No additional profile context available.'}\n\n"
            "Keep the compliment to one or two sentences."
        ),
        max_tokens=300,
        temperature=0.35,
    )
    body = str(response.get("body") or "").strip()
    fact_used = str(response.get("fact_used") or "").strip()

    if not body:
        body = _fallback_body(target_username, community_name)
    if not body.startswith(f"@{target_username}"):
        body = f"@{target_username}, {body.lstrip()}"

    fact_is_grounded = _fact_is_grounded(fact_used, kb_context)
    if _contains_internal_identifier(body):
        body = _fallback_body(target_username, community_name)
        fact_used = ""
        fact_is_grounded = False

    if fact_used and not fact_is_grounded:
        body = _fallback_body(target_username, community_name)
        fact_used = ""
        fact_is_grounded = False

    if _contains_unsupported_claim(body):
        if fact_is_grounded and fact_used:
            body = _grounded_rewrite(target_username, community_name, fact_used)
        else:
            body = _fallback_body(target_username, community_name)

    return IdeaExecutionResult(
        delivery_channel="feed_post",
        content=body,
        meta={
            "target_username": target_username,
            "community_name": community_name,
            "fact_used": fact_used if fact_is_grounded else "",
        },
    )

