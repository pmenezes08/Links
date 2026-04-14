"""Community feed idea: Steve posts a public opinion roundup for a topic."""

from __future__ import annotations

from typing import Any, Dict

from backend.services.content_generation.llm import (
    OPINION_PUBLIC_DOMAINS,
    extract_links,
    filter_links,
    format_response_links,
    generate_web_search_json,
)
from backend.services.content_generation.types import IdeaDescriptor, IdeaExecutionResult, IdeaField


DESCRIPTOR = IdeaDescriptor(
    idea_id="public_opinion_roundup",
    title="Public Opinion Roundup",
    description="Steve posts public opinion pieces for a topic and clearly labels them as commentary.",
    target_type="community",
    delivery_channel="feed_post",
    surfaces=("community", "admin"),
    payload_fields=(
        IdeaField(
            name="topic",
            label="Topic",
            required=True,
            placeholder="The future of remote work",
            help_text="Steve will look for public opinion pieces on this topic.",
        ),
    ),
)


def execute(job: Dict[str, Any]) -> IdeaExecutionResult:
    payload = job.get("payload") or {}
    topic = str(payload.get("topic") or "").strip()
    if not topic:
        raise ValueError("A topic is required for opinion roundups")

    result = generate_web_search_json(
        system_prompt=(
            "You are Steve, writing an opinion roundup for a community feed. "
            "Only use curated public opinion sources from this allowlist: medium.com. "
            "Return JSON with keys: intro, bullets, closing, source_links. "
            "bullets must be an array of 2-4 short markdown bullet strings describing viewpoints, not facts."
        ),
        user_prompt=(
            f"Topic: {topic}\n"
            "Find opinion or commentary pieces from public Medium posts only. "
            "Label the content clearly as opinion, not breaking news."
        ),
    )
    links = filter_links(result.get("source_links") or [], OPINION_PUBLIC_DOMAINS)
    if not links:
        links = filter_links(extract_links(str(result)), OPINION_PUBLIC_DOMAINS)
    if not links:
        raise ValueError("No valid public opinion source links were returned")

    bullets = result.get("bullets") or []
    bullet_text = "\n".join(f"- {str(item).strip()}" for item in bullets if str(item).strip())
    intro = str(result.get("intro") or f"Here are a few public opinion takes on {topic}.").strip()
    closing = str(result.get("closing") or "These are viewpoints rather than straight reporting, so use them as perspective pieces.").strip()
    body = f"**Steve's opinion roundup: {topic}**\n\n{intro}"
    if bullet_text:
        body += f"\n\n{bullet_text}"
    body += f"\n\n_{closing}_"
    return IdeaExecutionResult(
        delivery_channel="feed_post",
        content=format_response_links(body),
        source_links=links,
        meta={"topic": topic},
    )

