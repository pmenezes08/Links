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
                    "published_date": str(item.get("published_date") or "").strip(),
                    "why_it_matters": str(item.get("why_it_matters") or "").strip(),
                    "key_stat": str(item.get("key_stat") or "").strip(),
                    "steve_note": str(item.get("steve_note") or "").strip(),
                }
            )
        if title and items_out:
            out.append({"title": title, "items": items_out})
    return out


def format_story_item(item: Dict[str, Any]) -> str:
    title = md_link_title(item.get("title") or "")
    url = str(item.get("url") or "").strip()
    if not url:
        return ""
    parts: List[str] = [f"**[{title}]({url})**"]
    date = str(item.get("published_date") or "").strip()
    if date:
        parts.append(f"_{date}_")
    wim = str(item.get("why_it_matters") or "").strip()
    if wim:
        parts.append(f"**Why it matters:** {wim}")
    stat = str(item.get("key_stat") or "").strip()
    if stat:
        parts.append(f"**Key stat:** {stat}")
    note = str(item.get("steve_note") or "").strip()
    if note:
        parts.append(f"_Steve: {note}_")
    return "\n".join(parts)


def render_sections_markdown(sections: List[Dict[str, Any]]) -> str:
    blocks: List[str] = []
    for sec in sections:
        title = str(sec.get("title") or "").strip()
        items = sec.get("items") or []
        if not title or not items:
            continue
        inner: List[str] = [f"## {title}"]
        for it in items:
            block = format_story_item(it)
            if block:
                inner.append(block)
        if len(inner) > 1:
            blocks.append("\n\n".join(inner))
    return "\n\n".join(blocks)


def normalize_image_prompts(raw: Any, *, max_items: int = 2) -> List[str]:
    if raw is None:
        return []
    if isinstance(raw, str) and raw.strip():
        return [raw.strip()[:500]]
    if not isinstance(raw, list):
        return []
    out: List[str] = []
    for x in raw:
        s = str(x).strip()
        if s:
            out.append(s[:500])
        if len(out) >= max_items:
            break
    return out


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
