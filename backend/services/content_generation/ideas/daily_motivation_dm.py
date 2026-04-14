"""Member DM idea: Steve sends a motivational daily quote."""

from __future__ import annotations

import random
from typing import Any, Dict

from backend.services.content_generation.llm import XAI_API_KEY, generate_json
from backend.services.content_generation.types import IdeaDescriptor, IdeaExecutionResult, IdeaField


FALLBACK_QUOTES = (
    '"Small daily improvements are the key to staggering long-term results."',
    '"Momentum is built by showing up, especially on the ordinary days."',
    '"Progress rarely feels dramatic while it is happening, but it compounds fast."',
)


DESCRIPTOR = IdeaDescriptor(
    idea_id="daily_motivation_dm",
    title="Daily Motivation DM",
    description="Steve sends a short motivational quote and encouraging DM to a member.",
    target_type="member",
    delivery_channel="dm",
    surfaces=("admin",),
    payload_fields=(
        IdeaField(
            name="target_username",
            label="Member username",
            required=True,
            placeholder="stevefan123",
            help_text="The member who should receive the DM.",
        ),
        IdeaField(
            name="theme",
            label="Theme (optional)",
            required=False,
            placeholder="resilience, focus, confidence",
            help_text="Optional angle for the quote.",
        ),
    ),
)


def execute(job: Dict[str, Any]) -> IdeaExecutionResult:
    payload = job.get("payload") or {}
    target_username = str(job.get("target_username") or payload.get("target_username") or "").strip()
    if not target_username:
        raise ValueError("A target username is required for motivational DMs")

    theme = str(payload.get("theme") or "").strip()
    if not XAI_API_KEY:
        quote = random.choice(FALLBACK_QUOTES)
        content = f"{quote}\n\nSteve here, @{target_username}. Keep going - today's effort still counts."
        return IdeaExecutionResult(
            delivery_channel="dm",
            content=content,
            target_username=target_username,
            meta={"theme": theme},
        )

    response = generate_json(
        system_prompt=(
            "You are Steve sending a short motivational direct message. "
            "Be warm, concise, and encouraging. Avoid sounding robotic or overly intense."
        ),
        user_prompt=(
            f"Target member: @{target_username}\n"
            f"Theme: {theme or 'general encouragement'}\n"
            "Return JSON with one key: body. Include one short quote and one short encouragement paragraph."
        ),
        max_tokens=240,
        temperature=0.8,
    )
    body = str(response.get("body") or "").strip()
    if not body:
        body = f'{random.choice(FALLBACK_QUOTES)}\n\nSteve here, @{target_username}. Keep going - today still matters.'
    return IdeaExecutionResult(
        delivery_channel="dm",
        content=body,
        target_username=target_username,
        meta={"theme": theme},
    )

