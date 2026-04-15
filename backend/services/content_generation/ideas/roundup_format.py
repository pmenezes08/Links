"""Shared rendering and validation for news/opinion roundup JSON from the LLM."""

from __future__ import annotations

from typing import Any, Dict, List, Sequence

from backend.services.content_generation.llm import filter_links


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
) -> List[Dict[str, Any]]:
    """Drop items whose URLs are not on the allowlist; drop empty sections."""
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
        if title and items_out:
            out.append({"title": title, "items": items_out})
    return out


def filter_sources(
    sources: Any,
    allowed_domains: Sequence[str],
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
        out.append(
            {
                "title": str(item.get("title") or "").strip(),
                "outlet": str(item.get("outlet") or "").strip(),
                "published_date": str(item.get("published_date") or "").strip(),
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


def format_story_item(item: Dict[str, Any]) -> str:
    title = md_link_title(item.get("title") or "")
    if not title:
        return ""
    parts: List[str] = [f"• {title}"]
    outlet = str(item.get("outlet") or "").strip()
    date = str(item.get("published_date") or "").strip()
    if outlet or date:
        parts[-1] += f" - {', '.join(part for part in [outlet, date] if part)}."
    wim = str(item.get("why_it_matters") or "").strip()
    if wim:
        parts.append(wim)
    stat = str(item.get("key_stat") or "").strip()
    if stat:
        parts.append(f"Key stat: {stat}")
    return " ".join(part for part in parts if part).strip()


def render_sections_markdown(sections: List[Dict[str, Any]]) -> str:
    blocks: List[str] = []
    for sec in sections:
        title = str(sec.get("title") or "").strip()
        items = sec.get("items") or []
        if not title or not items:
            continue
        inner: List[str] = [title]
        for it in items:
            block = format_story_item(it)
            if block:
                inner.append(block)
        if len(inner) > 1:
            blocks.append("\n\n".join(inner))
    return "\n\n".join(blocks)


def render_sources_section(sources: List[Dict[str, str]]) -> str:
    if not sources:
        return ""
    lines = ["Sources"]
    for source in sources:
        title = str(source.get("title") or "Source").strip()
        outlet = str(source.get("outlet") or "").strip()
        date = str(source.get("published_date") or "").strip()
        tail = ", ".join(part for part in [outlet, date] if part)
        if tail:
            lines.append(f"• {title} - {tail}")
        else:
            lines.append(f"• {title}")
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
