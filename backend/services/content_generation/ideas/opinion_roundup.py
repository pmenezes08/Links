"""Community feed idea: Steve posts a public opinion roundup for a topic."""

from __future__ import annotations

from typing import Any, Dict, List

from backend.services.community import fetch_community_names
from backend.services.content_generation.llm import (
    OPINION_PUBLIC_DOMAINS,
    extract_links,
    filter_links,
    format_response_links,
    generate_web_search_json,
    plan_timely_topic,
)
from backend.services.content_generation.types import IdeaDescriptor, IdeaExecutionResult, IdeaField
from backend.services.database import get_db_connection

CURATED_VIDEO_SOURCES = (
    "The Diary of a CEO",
    "The Joe Rogan Experience",
    "Peter H. Diamandis",
    "Silicon Valley Girl",
    "60 Minutes",
    "Lex Fridman",
    "All-In Podcast",
    "TED",
    "Bloomberg Originals",
)


DESCRIPTOR = IdeaDescriptor(
    idea_id="public_opinion_roundup",
    title="Public Opinion Roundup",
    description="Steve posts opinion pieces and reputable YouTube discussion takeaways for a topic.",
    target_type="community",
    delivery_channel="feed_post",
    surfaces=("community", "admin"),
    payload_fields=(
        IdeaField(
            name="topic_mode",
            label="Topic mode",
            kind="select",
            required=False,
            help_text="Use manual for a fixed topic or auto so Steve picks a timely discussion.",
            options=(
                {"value": "manual", "label": "Manual topic"},
                {"value": "auto", "label": "Auto topic"},
            ),
        ),
        IdeaField(
            name="topic",
            label="Topic",
            required=False,
            placeholder="The future of remote work",
            help_text="Used when topic mode is manual.",
        ),
        IdeaField(
            name="topic_seed",
            label="Theme or seed",
            required=False,
            placeholder="Leadership, creator economy, longevity, AI at work",
            help_text="Used when topic mode is auto so Steve can choose a timely opinion angle.",
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
            roundup_kind="opinion",
            allowed_domains=OPINION_PUBLIC_DOMAINS,
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
        raise ValueError("A topic is required for opinion roundups when topic mode is manual")

    curated_list = ", ".join(CURATED_VIDEO_SOURCES)
    result = generate_web_search_json(
        system_prompt=(
            "You are Steve, writing an opinion roundup for a community feed. "
            "Use public opinion sources from Medium plus reputable YouTube discussions from this allowlist: "
            f"{curated_list}. "
            "Return JSON with keys: intro, featured_video_title, featured_video_url, featured_video_summary, bullets, closing, source_links. "
            "bullets must be an array of 2-4 short markdown bullet strings describing main takeaways or viewpoints, not hard news facts. "
            "Do not include citation tags, XML-like markup, inline source markers, or raw URLs in intro/bullets/closing/featured_video_summary. "
            "If no good YouTube discussion is available, return an empty featured_video_url."
        ),
        user_prompt=(
            f"Topic: {topic}\n"
            "Find a mix of public Medium commentary and, when available, one reputable YouTube discussion from the allowed shows. "
            "Label the content clearly as opinion/discussion, not breaking news. "
            "Keep the intro to 1-2 sentences, bullets short, and the closing to one short line. "
            "The featured video summary should explain what is discussed and why it matters."
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
    featured_video_url = str(result.get("featured_video_url") or "").strip()
    featured_video_title = str(result.get("featured_video_title") or "Featured discussion").strip()
    featured_video_summary = str(result.get("featured_video_summary") or "").strip()

    body_parts: List[str] = [f"**Steve's opinion roundup: {topic}**", intro]

    if featured_video_url:
        body_parts.append(f"**Featured discussion:** {featured_video_title}")
        body_parts.append(f"[Watch on YouTube]({featured_video_url})")
        if featured_video_summary:
            body_parts.append(featured_video_summary)

    if bullet_text:
        body_parts.append("**Key takeaways**")
        body_parts.append(bullet_text)

    body_parts.append(f"_{closing}_")
    body = "\n\n".join(part for part in body_parts if part)

    ordered_links: List[str] = []
    if featured_video_url:
        ordered_links.append(featured_video_url)
    for link in links:
        if link not in ordered_links:
            ordered_links.append(link)
    return IdeaExecutionResult(
        delivery_channel="feed_post",
        content=format_response_links(body),
        source_links=ordered_links,
        meta={"topic": topic, "featured_video_url": featured_video_url, **topic_meta},
    )

