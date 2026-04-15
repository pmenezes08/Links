"""Community feed idea: Steve posts a public news roundup for a topic."""

from __future__ import annotations

from typing import Any, Dict

from backend.services.community import fetch_community_names
from backend.services.content_generation.llm import (
    NEWS_PUBLIC_DOMAINS,
    extract_links,
    filter_links,
    format_response_links,
    generate_web_search_json,
    plan_timely_topic,
)
from backend.services.content_generation.types import IdeaDescriptor, IdeaExecutionResult, IdeaField
from backend.services.database import get_db_connection


DESCRIPTOR = IdeaDescriptor(
    idea_id="public_news_roundup",
    title="Public News Roundup",
    description="Steve posts the latest public news links and a short summary for a topic.",
    target_type="community",
    delivery_channel="feed_post",
    surfaces=("community", "admin"),
    payload_fields=(
        IdeaField(
            name="topic_mode",
            label="Topic mode",
            kind="select",
            required=False,
            help_text="Use manual for a fixed topic or auto so Steve picks a timely angle.",
            options=(
                {"value": "manual", "label": "Manual topic"},
                {"value": "auto", "label": "Auto topic"},
            ),
        ),
        IdeaField(
            name="topic",
            label="Topic",
            required=False,
            placeholder="AI regulation in Europe",
            help_text="Used when topic mode is manual.",
        ),
        IdeaField(
            name="topic_seed",
            label="Theme or seed",
            required=False,
            placeholder="European AI policy, startup funding, climate tech",
            help_text="Used when topic mode is auto so Steve can choose a timely news angle.",
        ),
    ),
)


def _community_name(community_id: int) -> str:
    if not community_id:
        return ""
    with get_db_connection() as conn:
        names = fetch_community_names(conn.cursor(), [community_id])
    return str(names[0]).strip() if names else ""


def _is_enabled(value: Any, *, default: bool = True) -> bool:
    if value is None or value == "":
        return default
    return str(value).strip().lower() not in {"0", "false", "no", "off"}


def execute(job: Dict[str, Any]) -> IdeaExecutionResult:
    payload = job.get("payload") or {}
    topic_mode = str(payload.get("topic_mode") or "manual").strip().lower() or "manual"
    if topic_mode not in {"manual", "auto"}:
        raise ValueError("Topic mode must be manual or auto")

    topic = str(payload.get("topic") or "").strip()
    topic_seed = str(payload.get("topic_seed") or "").strip()
    community_name = _community_name(int(job.get("community_id") or 0))
    topic_meta: Dict[str, Any] = {
        "topic_mode": topic_mode,
        "topic_seed": topic_seed,
        "community_name": community_name,
    }

    if topic_mode == "auto":
        plan = plan_timely_topic(
            roundup_kind="news",
            allowed_domains=NEWS_PUBLIC_DOMAINS,
            topic_seed=topic_seed,
            community_name=community_name,
            community_context_enabled=_is_enabled(payload.get("community_context_enabled"), default=True),
        )
        topic = str(plan.get("topic") or "").strip()
        topic_meta.update(
            {
                "auto_topic": topic,
                "auto_topic_why_now": str(plan.get("why_now") or "").strip(),
                "auto_topic_source_links": plan.get("source_links") or [],
            }
        )
    elif not topic:
        raise ValueError("A topic is required for news roundups when topic mode is manual")

    allowed_list = ", ".join(sorted(domain for domain in NEWS_PUBLIC_DOMAINS if not domain.startswith("www.")))
    result = generate_web_search_json(
        system_prompt=(
            "You are Steve, writing a concise community news roundup. "
            "Only use public, non-paywalled news sources from this allowlist: "
            f"{allowed_list}. "
            "Return JSON with keys: intro, bullets, closing, source_links. "
            "bullets must be an array of 2-4 short markdown bullet strings. "
            "Do not include citation tags, XML-like markup, inline source markers, or raw URLs in intro/bullets/closing. "
            "Keep each bullet to one short sentence focused on the key update. "
            "source_links must be an array of the exact article URLs you used."
        ),
        user_prompt=(
            f"Topic: {topic}\n"
            "Write a community-friendly news update with clear takeaways. "
            "Do not mention any paywalled article. Include only public sources. "
            "Keep the intro to 1-2 sentences and the closing to one short line."
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
        meta={"topic": topic, **topic_meta},
    )

