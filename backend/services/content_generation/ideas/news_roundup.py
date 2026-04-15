"""Community feed idea: Steve posts a public news roundup for a topic."""

from __future__ import annotations

from typing import Any, Dict

from backend.services.community import fetch_community_names
from backend.services.content_generation.ideas.roundup_format import (
    collect_urls_from_sections,
    derive_sources_from_sections,
    filter_section_items,
    filter_sources,
    merge_source_links,
    render_sections_markdown,
    render_sources_section,
)
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


_NEWS_MIXED_OUTLET_GUIDANCE = (
    "On outlets that publish both news and opinion, prefer straight reporting: look for section labels (News vs Opinion), "
    "neutral headlines, and reporter-style bylines. Avoid op-eds, reviews, and clearly evaluative takes unless the item "
    "is labeled analysis and still reads as factual reporting."
)
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


def _legacy_body(topic: str, result: Dict[str, Any]) -> str:
    bullets = result.get("bullets") or []
    bullet_text = "\n".join(f"• {str(item).strip()}" for item in bullets if str(item).strip())
    intro = str(result.get("intro") or f"Here is Steve's latest news roundup on {topic}.").strip()
    closing = str(result.get("closing") or "Let me know if you want a deeper dive into any of these stories.").strip()
    body = f"Steve's public news roundup: {topic}\n\n{intro}"
    if bullet_text:
        body += f"\n\n{bullet_text}"
    body += f"\n\n{closing}"
    return body


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
            "You are Steve, writing a professional public news roundup for a community feed. "
            "Only use public, non-paywalled news sources from this allowlist: "
            f"{allowed_list}. "
            f"{_NEWS_MIXED_OUTLET_GUIDANCE} "
            "Return JSON with keys: hook, sections, cta, sources, source_links. "
            "hook: 1-2 natural, human-sounding sentences that set up the topic without hype, slang, or snark. "
            "sections: array of 3-5 objects, each with "
            '"title" (short section heading that fits THIS topic — e.g. Economy, Policy, World, Tech, Science, Sports, Infrastructure — pick labels that match the story set, not a generic laundry list) '
            'and "items" (array of 1-3 story objects per section). '
            "Each story object must have: "
            '"title" (short readable headline), '
            '"url" (full https URL from the allowlist), '
            '"outlet" (e.g. Reuters, BBC, AP), '
            '"published_date" (e.g. 14 Apr 2026 or March 2026), '
            '"why_it_matters" (exactly one clear sentence), '
            '"key_stat" (one striking number or fact, or empty string if none), '
            '"source_label" (short source line label for the Sources section, e.g. Portugal deficit cap). '
            "Keep the tone professional, concise, and natural. Avoid jokey asides, sarcasm, internet slang, or exaggerated personality. "
            "cta: one line inviting replies — e.g. a question or \"What are you seeing locally?\" "
            "Do not mention email newsletters or subscribing. "
            'sources: array of objects with "title", "outlet", "published_date", and "url" for the bottom Sources section. '
            "source_links: array of every article URL you used (must match allowlist)."
        ),
        user_prompt=(
            f"Topic: {topic}\n"
            "Write a community-friendly news update. Lead with the hook, then grouped sections. "
            "Every url in sections must appear in source_links. "
            "The final prose should read like a smart human briefing, not AI output. "
            "Do not cite paywalled sources. No XML, markdown emphasis markers, or citation tags in text fields."
        ),
        max_output_tokens=3200,
        temperature=0.35,
    )

    filtered_sections = filter_section_items(result.get("sections"), NEWS_PUBLIC_DOMAINS)
    structured_sources = filter_sources(result.get("sources"), NEWS_PUBLIC_DOMAINS)

    if filtered_sections:
        hook = str(result.get("hook") or "").strip()
        if not hook:
            hook = str(result.get("intro") or "").strip() or f"Here is what matters right now on {topic}."
        cta = str(result.get("cta") or "").strip()
        if not cta:
            cta = str(result.get("closing") or "").strip() or "What is your take on this?"
        section_md = render_sections_markdown(filtered_sections)
        if not structured_sources:
            structured_sources = derive_sources_from_sections(filtered_sections)
        sources_md = render_sources_section(structured_sources)
        parts = [
            f"Steve's public news roundup: {topic}",
            "",
            hook,
            "",
            section_md,
            "",
            cta,
        ]
        if sources_md:
            parts.extend(["", sources_md])
        body = "\n".join(parts)
        section_urls = collect_urls_from_sections(filtered_sections)
        source_urls = [source.get("url", "") for source in structured_sources]
        links = merge_source_links(result.get("source_links"), section_urls + source_urls, NEWS_PUBLIC_DOMAINS)
    else:
        body = _legacy_body(topic, result)
        if structured_sources:
            body = f"{body}\n\n{render_sources_section(structured_sources)}"
        links = filter_links(result.get("source_links") or [], NEWS_PUBLIC_DOMAINS)
        if not links:
            links = filter_links(extract_links(str(result)), NEWS_PUBLIC_DOMAINS)

    if not links:
        raise ValueError("No valid public news source links were returned")

    topic_meta["roundup_format"] = "structured" if filtered_sections else "legacy"

    return IdeaExecutionResult(
        delivery_channel="feed_post",
        content=format_response_links(body),
        source_links=links,
        meta={"topic": topic, **topic_meta},
    )
