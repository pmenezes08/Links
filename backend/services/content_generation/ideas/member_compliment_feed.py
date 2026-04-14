"""Community feed idea: Steve compliments a member with safe profile context."""

from __future__ import annotations

import random
from typing import Any, Dict, List, Optional

from backend.services.community import fetch_community_names
from backend.services.content_generation.llm import XAI_API_KEY, generate_json
from backend.services.content_generation.types import IdeaDescriptor, IdeaExecutionResult, IdeaField
from backend.services.database import get_db_connection
from backend.services.steve_knowledge_base import build_knowledge_context_for_steve


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

    if not XAI_API_KEY:
        content = (
            f"@{target_username}, wishing you a great day from Steve. "
            "Thanks for being part of this community and helping keep the energy positive."
        )
        return IdeaExecutionResult(
            delivery_channel="feed_post",
            content=content,
            meta={"target_username": target_username},
        )

    kb_context = build_knowledge_context_for_steve(target_username)
    response = generate_json(
        system_prompt=(
            "You are Steve writing a warm but non-creepy public compliment for a community member. "
            "Keep it short, positive, and safe. "
            "Only use clearly positive, non-sensitive facts from the provided profile context. "
            "Do not mention health, politics, religion, finances, family, or inferred private details."
        ),
        user_prompt=(
            f"Target member: @{target_username}\n"
            f"Community ID: {community_id}\n"
            f"Profile context:\n{kb_context or 'No additional knowledge base context available.'}\n\n"
            "Return JSON with one key: body."
        ),
        max_tokens=300,
        temperature=0.7,
    )
    body = str(response.get("body") or "").strip()
    if not body:
        body = f"@{target_username}, wishing you a great day from Steve. Glad you're part of this community."
    return IdeaExecutionResult(
        delivery_channel="feed_post",
        content=body,
        meta={"target_username": target_username},
    )

