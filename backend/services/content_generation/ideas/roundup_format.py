"""Shared rendering and validation for news/opinion roundup JSON from the LLM."""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.services.content_generation.job_schedule import (
    add_months_calendar,
    normalize_cadence,
    resolve_zone,
)
from backend.services.content_generation.llm import filter_links

logger = logging.getLogger(__name__)

_ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def extract_year_from_text(s: str) -> Optional[int]:
    """Best-effort year for recency checks (e.g. '14 Apr 2026', 'March 2023')."""
    if not (s or "").strip():
        return None
    m = re.search(r"\b(20\d{2}|19\d{2})\b", s.strip())
    if not m:
        return None
    y = int(m.group(1))
    cy = date.today().year
    if y < 1990 or y > cy + 1:
        return None
    return y


def is_stale_publication_date(published_date: str, *, min_year: int) -> bool:
    """True if we parsed a year and it is before min_year (unknown year → not stale)."""
    y = extract_year_from_text(published_date or "")
    if y is None:
        return False
    return y < min_year


def strip_feed_markdown_emphasis(text: str) -> str:
    """Remove raw markdown emphasis so the community feed does not show ** or *…*."""
    if not text:
        return text
    s = text.replace("**", "")
    s = re.sub(r"(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)", r"\1", s)
    return s


_CADENCE_LABELS: Dict[str, str] = {
    "daily": "daily",
    "weekly": "weekly",
    "biweekly": "bi-weekly",
    "bi-weekly": "bi-weekly",
    "monthly": "monthly",
}


def cadence_label(job: Dict[str, Any]) -> str:
    """Derive a human-readable frequency word from the job schedule."""
    schedule = job.get("schedule") or {}
    cadence = normalize_cadence(schedule.get("cadence"))
    return _CADENCE_LABELS.get(cadence, "")


def build_roundup_welcome(kind: str, topic: str, job: Dict[str, Any]) -> str:
    """Build the welcome header + segue that opens every roundup post.

    Returns two lines joined by two newlines (paragraph break):
      Welcome to your {weekly} {kind} roundup, brought to you by Steve!
      {segue about the topic}
    """
    freq = cadence_label(job)
    freq_part = f"your {freq}" if freq else "this"

    if kind == "news":
        header = f"Welcome to {freq_part} news update, brought to you by Steve! [FA_STAR]"
        segue = f"Today we will be discussing what is making headlines on {topic}. See what you think."
    else:
        header = f"Welcome to {freq_part} opinion roundup, brought to you by Steve! [FA_STAR]"
        segue = f"Today we will be discussing one perspective on {topic}. See what you think."
    return f"{header}\n\n{segue}"


def build_roundup_cta(question: str) -> str:
    """Wrap an LLM-generated question into a bold call-to-action.

    The **bold** prefix is intentional — the client renders it as <strong>.
    """
    q = (question or "").strip()
    if not q:
        q = "What do you think?"
    return f"**Leave a comment:** {q}"


def default_min_publication_year() -> int:
    """Drop items older than ~3 calendar years when year is parseable."""
    return date.today().year - 3


def parse_publication_date(published_date: str) -> Optional[date]:
    """Best-effort calendar date from LLM output (ISO first, then dateparser)."""
    s = (published_date or "").strip()
    if not s:
        return None
    m = _ISO_DATE_RE.search(s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    try:
        import dateparser

        parsed = dateparser.parse(
            s,
            settings={
                "PREFER_DAY_OF_MONTH": "first",
                "RETURN_AS_TIMEZONE_AWARE": False,
            },
        )
        if parsed:
            return parsed.date()
    except Exception:
        return None
    return None


def news_recency_min_date_for_job(
    job: Dict[str, Any],
    *,
    ref_utc: Optional[datetime] = None,
) -> Tuple[date, str, str]:
    """Earliest inclusive publication date for stories (local calendar + cadence). Returns (min_date, tz_name, cadence)."""
    schedule = job.get("schedule") or {}
    cadence = normalize_cadence(schedule.get("cadence"))
    tz_name = (job.get("timezone") or "UTC").strip() or "UTC"
    try:
        tz = resolve_zone(tz_name)
    except ValueError:
        tz = resolve_zone("UTC")
        tz_name = "UTC"

    if ref_utc is None:
        ref_utc = datetime.now(timezone.utc)
    elif ref_utc.tzinfo is None:
        ref_utc = ref_utc.replace(tzinfo=timezone.utc)
    today_local = ref_utc.astimezone(tz).date()

    if cadence == "daily":
        min_date = today_local - timedelta(days=2)
    elif cadence == "weekly":
        min_date = today_local - timedelta(days=7)
    elif cadence == "biweekly":
        min_date = today_local - timedelta(days=14)
    elif cadence == "monthly":
        min_date = add_months_calendar(today_local, -1)
    else:
        min_date = today_local - timedelta(days=7)
    return min_date, tz_name, cadence


def news_recency_prompt_clause(min_date: date, tz_name: str, cadence: str) -> str:
    """LLM instructions for public news roundup recency (matches job cadence)."""
    label = {
        "daily": "daily",
        "weekly": "weekly",
        "biweekly": "bi-weekly",
        "monthly": "monthly",
    }.get(cadence, "weekly")
    return (
        f"RECENCY ({label} cadence): Only include stories whose original publication date is on or after "
        f"{min_date.isoformat()} in timezone {tz_name}. "
        "Each story must set published_date to a real calendar day — prefer ISO YYYY-MM-DD or 'DD Mon YYYY' (e.g. 14 Apr 2026). "
        "Do not anchor the roundup on stories older than that window. "
        "Avoid month-only dates unless the story clearly falls inside the window."
    )


def md_link_title(text: str) -> str:
    """Avoid breaking markdown [text](url) when titles contain brackets."""
    return (text or "").replace("[", "(").replace("]", ")").strip() or "Link"


def collect_urls_from_sections(sections: Any) -> List[str]:
    urls: List[str] = []
    if not isinstance(sections, list):
        return urls
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        for item in sec.get("items") or []:
            if not isinstance(item, dict):
                continue
            u = str(item.get("url") or "").strip()
            if u:
                urls.append(u)
    return urls


def filter_section_items(
    sections: Any,
    allowed_domains: Sequence[str],
    *,
    min_publication_year: int | None = None,
    min_publication_date: date | None = None,
) -> List[Dict[str, Any]]:
    """Drop items whose URLs are not on the allowlist; drop empty sections.

    When min_publication_year is set, drop items with a parseable year strictly before
    that threshold. If that would empty a section, keep the pre-filter items (soft filter).

    When min_publication_date is set (news roundups), drop items with a parseable calendar date
    strictly before that threshold. Unparseable published_date values are kept (see prompt).
    """
    out: List[Dict[str, Any]] = []
    if not isinstance(sections, list):
        return out

    def _domain_ok(url: str) -> bool:
        return bool(filter_links([url], allowed_domains))

    for sec in sections:
        if not isinstance(sec, dict):
            continue
        title = str(sec.get("title") or "").strip()
        items_in: List[Any] = sec.get("items") or []
        items_out: List[Dict[str, Any]] = []
        for item in items_in:
            if not isinstance(item, dict):
                continue
            url = str(item.get("url") or "").strip()
            if not url or not _domain_ok(url):
                continue
            items_out.append(
                {
                    "title": str(item.get("title") or "").strip(),
                    "url": url,
                    "outlet": str(item.get("outlet") or "").strip(),
                    "published_date": str(item.get("published_date") or "").strip(),
                    "why_it_matters": str(item.get("why_it_matters") or "").strip(),
                    "key_stat": str(item.get("key_stat") or "").strip(),
                    "source_label": str(item.get("source_label") or "").strip(),
                }
            )
        if min_publication_year is not None and items_out:
            recent_only = [
                it
                for it in items_out
                if not is_stale_publication_date(it.get("published_date") or "", min_year=min_publication_year)
            ]
            if recent_only:
                items_out = recent_only
        if min_publication_date is not None and items_out:
            unparseable = 0
            day_filtered: List[Dict[str, Any]] = []
            for it in items_out:
                pd_raw = it.get("published_date") or ""
                pd = parse_publication_date(str(pd_raw))
                if pd is not None:
                    if pd < min_publication_date:
                        continue
                    day_filtered.append(it)
                else:
                    unparseable += 1
                    day_filtered.append(it)
            if unparseable:
                logger.warning(
                    "filter_section_items: %d item(s) with unparseable published_date kept (section=%r)",
                    unparseable,
                    title[:60],
                )
            items_out = day_filtered
        if title and items_out:
            out.append({"title": title, "items": items_out})
    return out


def filter_sources(
    sources: Any,
    allowed_domains: Sequence[str],
    *,
    min_publication_date: date | None = None,
) -> List[Dict[str, str]]:
    """Keep only valid structured sources from allowed domains."""
    out: List[Dict[str, str]] = []
    if not isinstance(sources, list):
        return out

    for item in sources:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url or not filter_links([url], allowed_domains):
            continue
        pub_raw = str(item.get("published_date") or "").strip()
        if min_publication_date is not None:
            pd = parse_publication_date(pub_raw)
            if pd is not None and pd < min_publication_date:
                continue
        out.append(
            {
                "title": str(item.get("title") or "").strip(),
                "outlet": str(item.get("outlet") or "").strip(),
                "published_date": pub_raw,
                "url": url,
            }
        )
    return out


def derive_sources_from_sections(sections: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    sources: List[Dict[str, str]] = []
    seen = set()
    for sec in sections:
        for item in sec.get("items") or []:
            url = str(item.get("url") or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            sources.append(
                {
                    "title": str(item.get("source_label") or item.get("title") or "").strip(),
                    "outlet": str(item.get("outlet") or "").strip(),
                    "published_date": str(item.get("published_date") or "").strip(),
                    "url": url,
                }
            )
    return sources


def prepend_featured_youtube_source(
    sources: List[Dict[str, str]],
    featured_url: str,
    featured_title: str,
) -> List[Dict[str, str]]:
    """Ensure the featured discussion video appears in Sources (clickable at bottom)."""
    if not (featured_url or "").strip():
        return sources
    url = str(featured_url).strip()
    for s in sources:
        if str(s.get("url") or "").strip() == url:
            return sources
    entry: Dict[str, str] = {
        "title": md_link_title(featured_title),
        "outlet": "YouTube",
        "published_date": "",
        "url": url,
    }
    return [entry] + list(sources)


def _source_display_label(title: str, outlet: str, published_date: str) -> str:
    """One line like: Title - Reuters, 14 Apr 2026 (used in Sources only, not body)."""
    label = md_link_title(title) or "Source"
    o = (outlet or "").strip()
    d = (published_date or "").strip()
    tail = ", ".join(part for part in [o, d] if part)
    if tail:
        return f"{label} - {tail}"
    return label


def format_story_item(item: Dict[str, Any]) -> str:
    """Body text only: headline + context. Outlet/date stay in Sources, not repeated here."""
    title = strip_feed_markdown_emphasis(md_link_title(item.get("title") or ""))
    if not title:
        return ""
    lines: List[str] = [f"• {title}"]
    wim = strip_feed_markdown_emphasis(str(item.get("why_it_matters") or "").strip())
    if wim:
        lines.append(wim)
    stat = strip_feed_markdown_emphasis(str(item.get("key_stat") or "").strip())
    if stat:
        lines.append(f"**Key stat:** {stat}")
    return "\n\n".join(line for line in lines if line).strip()


def _opinion_piece_link_label(url: str, outlet: str) -> str:
    """Short CTA label for a markdown link after each opinion item."""
    u = (url or "").strip().lower()
    if "youtu.be" in u or "youtube.com" in u:
        return "Watch on YouTube"
    o = (outlet or "").strip()
    if o:
        return f"Read on {o}"
    return "Read full piece"


def format_opinion_story_item(item: Dict[str, Any]) -> str:
    """Make the article *title* the clickable markdown link (saves space, reduces noise).
    No separate 'Read on Outlet' line."""
    title = strip_feed_markdown_emphasis(md_link_title(item.get("title") or ""))
    if not title:
        return ""
    url = str(item.get("url") or "").strip()
    if url:
        title_line = f"• [{title}]({url})"
    else:
        title_line = f"• {title}"
    lines: List[str] = [title_line]
    wim = strip_feed_markdown_emphasis(str(item.get("why_it_matters") or "").strip())
    if wim:
        lines.append(wim)
    stat = strip_feed_markdown_emphasis(str(item.get("key_stat") or "").strip())
    if stat:
        lines.append(f"**Key stat:** {stat}")
    return "\n\n".join(line for line in lines if line).strip()


def _section_heading_feed(title: str) -> str:
    """ALL CAPS section title; bold in feed (same pattern as **Leave a comment:**)."""
    t = strip_feed_markdown_emphasis(str(title or "").strip())
    if not t:
        return ""
    return f"**{t.upper()}**"


def take_first_opinion_article(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Single opinion: one section, one written article (first item)."""
    if not sections:
        return []
    for sec in sections:
        items = sec.get("items") or []
        if not items:
            continue
        title = str(sec.get("title") or "").strip() or "**The Article**"
        # Append outlet for "The Article by Wired.com" format
        if items and isinstance(items[0], dict):
            outlet = str(items[0].get("outlet") or items[0].get("source_label") or "").strip()
            if outlet:
                title = f"**The Article by {outlet}**"
        return [{"title": title, "items": [items[0]]}]
    return []


def render_sections_markdown(
    sections: List[Dict[str, Any]],
    *,
    link_after_opinion: bool = False,
) -> str:
    blocks: List[str] = []
    for sec in sections:
        title = str(sec.get("title") or "").strip()
        items = sec.get("items") or []
        if not title or not items:
            continue
        heading = _section_heading_feed(title)
        inner: List[str] = [heading]
        formatter = format_opinion_story_item if link_after_opinion else format_story_item
        for it in items:
            block = formatter(it)
            if block:
                inner.append(block)
        if len(inner) > 1:
            blocks.append("\n\n".join(inner))
    return "\n\n".join(blocks)


def render_sources_section(sources: List[Dict[str, str]]) -> str:
    """Bullet list of markdown links; label matches 'Title - Outlet, date' style."""
    if not sources:
        return ""
    lines = ["SOURCES"]
    for source in sources:
        title = str(source.get("title") or "Source").strip()
        outlet = str(source.get("outlet") or "").strip()
        date = str(source.get("published_date") or "").strip()
        url = str(source.get("url") or "").strip()
        label = _source_display_label(title, outlet, date)
        if url:
            lines.append(f"• [{label}]({url})")
        else:
            lines.append(f"• {label}")
    return "\n".join(lines)


def merge_source_links(
    declared: Any,
    section_urls: List[str],
    allowed_domains: Sequence[str],
) -> List[str]:
    combined: List[str] = []
    seen = set()
    for link in (declared or []) + section_urls:
        u = str(link).strip()
        if not u or u in seen:
            continue
        seen.add(u)
        combined.append(u)
    return filter_links(combined, allowed_domains)
