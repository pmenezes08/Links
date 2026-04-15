"""Community feed idea: Steve posts a public opinion roundup for a topic."""

from __future__ import annotations

import re
from typing import Any, Dict, List

from backend.services.community import fetch_community_names
from backend.services.content_generation.ideas.roundup_format import (
    collect_urls_from_sections,
    default_min_publication_year,
    filter_section_items,
    md_link_title,
    merge_source_links,
    render_sections_markdown,
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

def _normalize_youtube_url_for_embed(url: str) -> str:
    """Canonical watch URL so the mobile app and feed can embed the player reliably."""
    u = (url or "").strip()
    if not u:
        return ""
    m = re.match(r"https?://(?:www\.)?youtu\.be/([a-zA-Z0-9_-]{11})", u, re.I)
    if m:
        return f"https://www.youtube.com/watch?v={m.group(1)}"
    return u


def _featured_video_embed_markdown(url: str) -> str:
    """Markdown link removed by client + iframe embed; do not duplicate in a SOURCES block."""
    u = _normalize_youtube_url_for_embed(url)
    if not u:
        return ""
    return f"[Watch on YouTube]({u})"


def _strip_opinion_cta_noise(text: str) -> str:
    """Drop model-appended Sources headings, bullets, or domain footnotes after the real CTA line."""
    if not (text or "").strip():
        return text
    lines = text.split("\n")
    out: List[str] = []
    for line in lines:
        low = line.strip().lower()
        if low.startswith("sources") or low.startswith("source:"):
            break
        if re.match(r"^[-•]\s*([a-z0-9.-]+\.[a-z]{2,})\s*$", low):
            break
        out.append(line)
    return "\n".join(out).strip()


_OPINION_MIXED_OUTLET_GUIDANCE = (
    "Prioritize opinion, analysis, commentary, reviews, and editorials. Use page cues: section labels "
    "(Opinion, Editorial, Op-Ed, Analysis), author-forward presentation, and evaluative tone in headlines. "
    "Prefer clearly labeled perspective over bare breaking-news wires from mixed outlets."
)

_OPINION_RECENCY = (
    "RECENCY (mandatory): For a written article, prefer publication within roughly the last 18–24 months "
    "(ideally the last 12 months); do not use pieces more than about three years old unless the topic is historical. "
    "Set published_date from the article page. "
    "For a YouTube-only piece, prefer a recent episode from roughly the last 12–18 months. "
    "Avoid undated archival republications of old work."
)

_OPINION_SINGLE_PIECE = (
    "STRUCTURE (mandatory): Exactly ONE opinion surface — choose ONE, never both. "
    "(A) One allowlisted written article in sections[0].items with featured_video_* fields empty; OR "
    "(B) One featured YouTube from the named shows (Lex Fridman, All-In, etc.) with sections empty or sections[0].items empty — "
    "treat a long-form episode like a single opinion piece. "
    "If web search finds both a strong article and a strong video, prefer the written article and leave featured_video_url empty. "
    "When Wired, The Verge, Ars Technica, MIT Technology Review, or similar have a strong piece, prefer them over Medium alone."
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
    description="Steve posts one recent opinion: either one written article or one curated discussion video — never both.",
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
        body_parts.append(_featured_video_embed_markdown(featured_video_url))

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
            f"{_OPINION_SINGLE_PIECE} "
            "Return JSON with keys: hook, featured_video_title, featured_video_url, featured_video_summary, "
            "sections, cta, sources, source_links. "
            "hook: 1-2 natural, human-sounding sentences that set up the discussion without hype, snark, or slang. "
            "VIDEO PATH: If you choose a YouTube episode as the single piece, set featured_video_* and use sections: [] "
            "or sections with empty items. Do not also fill sections with a written article. "
            "WRITTEN PATH: If you choose a written article, set featured_video_url to empty string and use sections with exactly one item. "
            "featured_video_*: only when VIDEO PATH — standard watch or youtu.be link (11-character video id). "
            "sections: when WRITTEN PATH, array of one object with "
            '"title" (e.g. The piece) and "items": array of exactly one story object. '
            "That story: title, url (https on allowlist), outlet, published_date, why_it_matters (one sentence), "
            "key_stat (optional), source_label (short label for validation only). "
            "Opinion tone: thoughtful, professional, and clearly labeled as perspective. Avoid jokey asides and exaggerated AI voice. "
            "cta: one engagement line only — a question or invitation. "
            "Do not mention subscribing, newsletters, or a Sources list. Do not append URLs, domain names, or footnotes to cta. "
            'sources: optional validation array — the feed does not render a Sources list. '
            "source_links: all URLs used (written article URL, or YouTube URL, never both). "
            "Do not put raw URLs inside hook/featured_video_summary text; URLs belong in url fields and source_links. "
            "Do not use markdown emphasis markers (** or *) in text fields — plain sentences only. "
            f"Written-source domains when using WRITTEN PATH (non-exhaustive): {written_allowlist}."
        ),
        user_prompt=(
            f"Topic: {topic}\n"
            "Pick ONE: either one recent allowlisted written opinion/analysis, OR one strong discussion video from the named shows — never both. "
            "If both exist, prefer the written article and omit the video. "
            "Written path: one item in sections[0].items; empty featured_video_url. "
            "Video path: fill featured_video_*; leave sections empty or items empty. "
            "Every url must appear in source_links. "
            "The cta must be only the discussion prompt — no Sources section, bullet lists, or domain footnotes after it. "
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

    # One piece only: written article XOR YouTube episode (never both in one post)
    if filtered_sections and featured_video_url:
        featured_video_url = ""
        featured_video_title = ""
        featured_video_summary = ""

    def _finalize_cta() -> str:
        raw = str(result.get("cta") or "").strip()
        if not raw:
            raw = str(result.get("closing") or "").strip() or "Where do you land on this?"
        return _strip_opinion_cta_noise(strip_feed_markdown_emphasis(raw))

    roundup_format = "legacy"
    body = ""

    if filtered_sections:
        hook = strip_feed_markdown_emphasis(str(result.get("hook") or "").strip())
        if not hook:
            hook = strip_feed_markdown_emphasis(
                str(result.get("intro") or "").strip() or f"One opinion piece worth reading on {topic}."
            )
        cta = _finalize_cta()
        section_md = render_sections_markdown(
            filtered_sections,
            link_after_opinion=True,
        )
        parts: List[str] = [
            f"Steve's opinion roundup: {topic}",
            "",
            hook,
            "",
            section_md,
            "",
            cta,
        ]
        body = "\n".join(parts)
        section_urls = collect_urls_from_sections(filtered_sections)
        links = merge_source_links(result.get("source_links"), section_urls, OPINION_PUBLIC_DOMAINS)
        roundup_format = "structured"

    elif featured_video_url:
        hook = strip_feed_markdown_emphasis(str(result.get("hook") or "").strip())
        if not hook:
            hook = strip_feed_markdown_emphasis(
                str(result.get("intro") or "").strip() or f"One discussion worth watching on {topic}."
            )
        cta = _finalize_cta()
        fv = _normalize_youtube_url_for_embed(featured_video_url)
        featured_video_url = fv
        safe_title = md_link_title(featured_video_title)
        parts = [
            f"Steve's opinion roundup: {topic}",
            "",
            hook,
            "",
            "THE PIECE",
            "",
            f"• {safe_title}",
        ]
        if featured_video_summary:
            parts.extend(["", strip_feed_markdown_emphasis(featured_video_summary)])
        parts.extend(["", _featured_video_embed_markdown(fv), "", cta])
        body = "\n".join(parts)
        links = merge_source_links(result.get("source_links"), [fv], OPINION_PUBLIC_DOMAINS)
        roundup_format = "video_only"

    else:
        bullets = result.get("bullets") or []
        has_bullets = any(str(b).strip() for b in bullets)
        fv_legacy = featured_video_url
        if has_bullets and fv_legacy:
            fv_legacy = ""
        body = _legacy_opinion_body(
            topic,
            result,
            featured_video_url=fv_legacy,
            featured_video_title=featured_video_title,
            featured_video_summary=featured_video_summary,
        )
        if not fv_legacy:
            featured_video_url = ""
            featured_video_title = ""
            featured_video_summary = ""
        else:
            featured_video_url = fv_legacy
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

    topic_meta["roundup_format"] = roundup_format

    return IdeaExecutionResult(
        delivery_channel="feed_post",
        content=format_response_links(body),
        source_links=ordered_links,
        append_sources=False,
        meta={"topic": topic, "featured_video_url": featured_video_url, **topic_meta},
    )
