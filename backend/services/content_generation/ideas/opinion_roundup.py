"""Community feed idea: Steve posts a public opinion roundup for a topic."""

from __future__ import annotations

from typing import Any, Dict, List

from backend.services.community import fetch_community_names
from backend.services.content_generation.ideas.roundup_format import (
    collect_urls_from_sections,
    default_min_publication_year,
    derive_sources_from_sections,
    filter_section_items,
    filter_sources,
    md_link_title,
    merge_source_links,
    prepend_featured_youtube_source,
    render_sections_markdown,
    render_sources_section,
    strip_feed_markdown_emphasis,
    take_first_opinion_article,
)
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

FEATURED_VIDEO_SOURCES_CTA = (
    "Watch the full discussion via the YouTube link in SOURCES below."
)

_OPINION_MIXED_OUTLET_GUIDANCE = (
    "Prioritize opinion, analysis, commentary, reviews, and editorials. Use page cues: section labels "
    "(Opinion, Editorial, Op-Ed, Analysis), author-forward presentation, and evaluative tone in headlines. "
    "Prefer clearly labeled perspective over bare breaking-news wires from mixed outlets."
)

_OPINION_RECENCY = (
    "RECENCY (mandatory): Choose a written article originally published within roughly the last 18–24 months "
    "(prefer the last 12 months). Do not use pieces whose original publication is more than about three years old "
    "unless the topic is explicitly historical. Set published_date from the article page. "
    "Prefer outlets with a clear publication date; avoid undated archival republications of old work."
)

_OPINION_SINGLE_ARTICLE = (
    "STRUCTURE: Exactly one written opinion or analysis article on the allowlist — one URL, one perspective. "
    "Do not add multiple competing opinion pieces. Optional: one featured YouTube from the named shows when it adds value; "
    "that video is separate from the single written article. "
    "When Wired, The Verge, Ars Technica, MIT Technology Review, or similar have a comparable piece, prefer them over Medium alone."
)

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
    description="Steve posts one recent opinion or analysis article and an optional featured discussion video.",
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


def _legacy_opinion_body(
    topic: str,
    result: Dict[str, Any],
    *,
    featured_video_url: str,
    featured_video_title: str,
    featured_video_summary: str,
) -> str:
    bullets = result.get("bullets") or []
    bullet_text = "\n".join(f"• {str(item).strip()}" for item in bullets if str(item).strip())
    intro = strip_feed_markdown_emphasis(
        str(result.get("intro") or f"Here is one public opinion piece worth reading on {topic}.").strip()
    )
    closing = strip_feed_markdown_emphasis(
        str(
            result.get("closing")
            or "This is perspective rather than straight reporting — use it as one angle to consider."
        ).strip()
    )

    body_parts: List[str] = [f"Steve's opinion roundup: {topic}", intro]

    if featured_video_url:
        body_parts.append(f"Featured discussion: {md_link_title(featured_video_title)}")
        if featured_video_summary:
            body_parts.append(strip_feed_markdown_emphasis(featured_video_summary))
        body_parts.append(FEATURED_VIDEO_SOURCES_CTA)

    if bullet_text:
        body_parts.append("KEY TAKEAWAYS")
        body_parts.append(bullet_text)

    body_parts.append(closing)
    return "\n\n".join(part for part in body_parts if part)


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
    written_allowlist = ", ".join(
        sorted(d for d in OPINION_PUBLIC_DOMAINS if not d.startswith("www.") and "youtube" not in d and "youtu.be" not in d)
    )
    result = generate_web_search_json(
        system_prompt=(
            "You are Steve, writing a professional opinion roundup for a community feed. "
            "Use public opinion sources: one written piece from this domain allowlist (Wired, The Verge, Medium, Ars Technica, "
            "MIT Technology Review, and other listed hosts — do not default to Medium alone when a stronger host matches). "
            f"Plus reputable YouTube discussions from these channel names when choosing a featured video: {curated_list}. "
            f"{_OPINION_MIXED_OUTLET_GUIDANCE} "
            f"{_OPINION_RECENCY} "
            f"{_OPINION_SINGLE_ARTICLE} "
            "Return JSON with keys: hook, featured_video_title, featured_video_url, featured_video_summary, "
            "sections, cta, sources, source_links. "
            "hook: 1-2 natural, human-sounding sentences that set up the discussion without hype, snark, or slang. "
            "featured_video_*: one optional YouTube from the allowlist; if none fits, use empty string for featured_video_url. "
            "sections: array of exactly one object with "
            '"title" (short section heading that fits the topic — e.g. The piece, Long read, Why it matters now) '
            'and "items": array of exactly one story object (the single written opinion article). '
            "That story: title, url (https on allowlist), outlet, published_date, why_it_matters (one sentence), "
            "key_stat (optional), source_label (short source line label for the Sources section). "
            "Opinion tone: thoughtful, professional, and clearly labeled as perspective. Avoid jokey asides and exaggerated AI voice. "
            "cta: one engagement line — question or invitation to share experience. Do not mention subscribing or newsletters. "
            'sources: array of objects with "title", "outlet", "published_date", and "url" for the bottom Sources section. '
            "Include the featured YouTube URL in sources and source_links when featured_video_url is set. "
            "source_links: all URLs used. "
            "Do not put raw URLs inside hook/featured_video_summary text; URLs belong in url fields and source_links. "
            "Do not use markdown emphasis markers (** or *) in text fields — plain sentences only. "
            f"Written-source domains (non-exhaustive): {written_allowlist}."
        ),
        user_prompt=(
            f"Topic: {topic}\n"
            "Use web search to find exactly one recent, high-quality opinion or analysis piece on the allowlist. "
            "Prefer publication within the last 12–18 months; avoid articles more than about three years old. "
            "Use at most one featured YouTube from the named shows when it adds value. "
            "Return exactly one item in sections[0].items. Every url must appear in source_links. "
            "The final prose should read like a smart human briefing, not AI output."
        ),
        max_output_tokens=3200,
        temperature=0.42,
    )

    featured_video_url = str(result.get("featured_video_url") or "").strip()
    if featured_video_url and not filter_links([featured_video_url], OPINION_PUBLIC_DOMAINS):
        featured_video_url = ""
    featured_video_title = str(result.get("featured_video_title") or "Featured discussion").strip()
    featured_video_summary = str(result.get("featured_video_summary") or "").strip()

    min_year = default_min_publication_year()
    filtered_sections = filter_section_items(
        result.get("sections"),
        OPINION_PUBLIC_DOMAINS,
        min_publication_year=min_year,
    )
    filtered_sections = take_first_opinion_article(filtered_sections)
    structured_sources = filter_sources(result.get("sources"), OPINION_PUBLIC_DOMAINS)

    if filtered_sections:
        hook = strip_feed_markdown_emphasis(str(result.get("hook") or "").strip())
        if not hook:
            hook = strip_feed_markdown_emphasis(
                str(result.get("intro") or "").strip() or f"One opinion piece worth reading on {topic}."
            )
        cta = strip_feed_markdown_emphasis(str(result.get("cta") or "").strip())
        if not cta:
            cta = strip_feed_markdown_emphasis(
                str(result.get("closing") or "").strip() or "Where do you land on this?"
            )
        section_md = render_sections_markdown(
            filtered_sections,
            link_after_opinion=True,
        )
        structured_sources = derive_sources_from_sections(filtered_sections)
        structured_sources = prepend_featured_youtube_source(
            structured_sources,
            featured_video_url,
            featured_video_title,
        )
        sources_md = render_sources_section(structured_sources)
        parts: List[str] = [
            f"Steve's opinion roundup: {topic}",
            "",
            hook,
            "",
        ]
        if featured_video_url:
            safe_title = md_link_title(featured_video_title)
            parts.extend(
                [
                    f"Featured discussion: {safe_title}",
                    "",
                ]
            )
            if featured_video_summary:
                parts.append(strip_feed_markdown_emphasis(featured_video_summary))
            parts.extend(
                [
                    "",
                    FEATURED_VIDEO_SOURCES_CTA,
                    "",
                ]
            )
        parts.append(section_md)
        parts.extend(["", cta])
        if sources_md:
            parts.extend(["", sources_md])
        body = "\n".join(parts)
        section_urls = collect_urls_from_sections(filtered_sections)
        source_urls = [source.get("url", "") for source in structured_sources]
        combined_urls = ([featured_video_url] if featured_video_url else []) + section_urls + source_urls
        links = merge_source_links(result.get("source_links"), combined_urls, OPINION_PUBLIC_DOMAINS)
    else:
        body = _legacy_opinion_body(
            topic,
            result,
            featured_video_url=featured_video_url,
            featured_video_title=featured_video_title,
            featured_video_summary=featured_video_summary,
        )
        sources_for_render = list(structured_sources) if structured_sources else []
        sources_for_render = prepend_featured_youtube_source(
            sources_for_render,
            featured_video_url,
            featured_video_title,
        )
        if sources_for_render:
            body = f"{body}\n\n{render_sources_section(sources_for_render)}"
        links = filter_links(result.get("source_links") or [], OPINION_PUBLIC_DOMAINS)
        if not links:
            links = filter_links(extract_links(str(result)), OPINION_PUBLIC_DOMAINS)

    if not links:
        raise ValueError("No valid public opinion source links were returned")

    ordered_links: List[str] = []
    if featured_video_url and featured_video_url in links:
        ordered_links.append(featured_video_url)
    for link in links:
        if link not in ordered_links:
            ordered_links.append(link)

    topic_meta["roundup_format"] = "structured" if filtered_sections else "legacy"

    return IdeaExecutionResult(
        delivery_channel="feed_post",
        content=format_response_links(body),
        source_links=ordered_links,
        meta={"topic": topic, "featured_video_url": featured_video_url, **topic_meta},
    )
