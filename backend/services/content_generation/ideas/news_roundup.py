"""Community feed idea: Steve posts a public news roundup for a topic."""

from __future__ import annotations

from typing import Any, Dict

from backend.services.content_generation.llm import (
    NEWS_PUBLIC_DOMAINS,
    extract_links,
    filter_links,
    format_response_links,
    generate_web_search_json,
)
from backend.services.content_generation.types import IdeaDescriptor, IdeaExecutionResult, IdeaField


DESCRIPTOR = IdeaDescriptor(
    idea_id="public_news_roundup",
    title="Public News Roundup",
    description="Steve posts the latest public news links and a short summary for a topic.",
    target_type="community",
    delivery_channel="feed_post",
    surfaces=("community", "admin"),
    payload_fields=(
        IdeaField(
            name="topic",
            label="Topic",
            required=True,
            placeholder="AI regulation in Europe",
            help_text="Steve will search public news sources for this topic.",
        ),
    ),
)


def execute(job: Dict[str, Any]) -> IdeaExecutionResult:
    payload = job.get("payload") or {}
    topic = str(payload.get("topic") or "").strip()
    if not topic:
        raise ValueError("A topic is required for news roundups")

    allowed_list = ", ".join(sorted(domain for domain in NEWS_PUBLIC_DOMAINS if not domain.startswith("www.")))
    result = generate_web_search_json(
        system_prompt=(
            "You are Steve, writing a concise community news roundup. "
            "Only use public, non-paywalled news sources from this allowlist: "
            f"{allowed_list}. "
            "Return JSON with keys: intro, bullets, closing, source_links. "
            "bullets must be an array of 2-4 short markdown bullet strings. "
            "source_links must be an array of the exact article URLs you used."
        ),
        user_prompt=(
            f"Topic: {topic}\n"
            "Write a community-friendly news update with clear takeaways. "
            "Do not mention any paywalled article. Include only public sources."
        ),
    )
    links = filter_links(result.get("source_links") or [], NEWS_PUBLIC_DOMAINS)
    if not links:
        links = filter_links(extract_links(str(result)), NEWS_PUBLIC_DOMAINS)
    if not links:
        raise ValueError("No valid public news source links were returned")

    bullets = result.get("bullets") or []
    bullet_text = "\n".join(f"- {str(item).strip()}" for item in bullets if str(item).strip())
    intro = str(result.get("intro") or f"Here is Steve's latest news roundup on {topic}.").strip()
    closing = str(result.get("closing") or "Let me know if you want a deeper dive into any of these stories.").strip()
    body = f"**Steve's public news roundup: {topic}**\n\n{intro}"
    if bullet_text:
        body += f"\n\n{bullet_text}"
    body += f"\n\n{closing}"
    return IdeaExecutionResult(
        delivery_channel="feed_post",
        content=format_response_links(body),
        source_links=links,
        meta={"topic": topic},
    )

