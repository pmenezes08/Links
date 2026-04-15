"""LLM helpers for Steve content generation ideas."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence
from urllib.parse import urlparse

from openai import OpenAI

logger = logging.getLogger(__name__)

XAI_API_KEY = os.getenv("XAI_API_KEY", "")
GROK_MODEL_FAST = os.getenv("STEVE_CONTENT_MODEL", "grok-4-1-fast-non-reasoning")

# Tech, culture, analysis, fashion, music — US/Europe-oriented; bare + www for filter_links netloc match.
_EXPANDED_ROUNDUP_DOMAINS = frozenset(
    {
        "wired.com",
        "www.wired.com",
        "theverge.com",
        "www.theverge.com",
        "gizmodo.com",
        "www.gizmodo.com",
        "mashable.com",
        "www.mashable.com",
        "thenextweb.com",
        "www.thenextweb.com",
        "arstechnica.com",
        "www.arstechnica.com",
        "technologyreview.com",
        "www.technologyreview.com",
        "theregister.com",
        "www.theregister.com",
        "spectrum.ieee.org",
        "dazeddigital.com",
        "www.dazeddigital.com",
        "hypebeast.com",
        "www.hypebeast.com",
        "vogue.com",
        "www.vogue.com",
        "refinery29.com",
        "www.refinery29.com",
        "thecut.com",
        "www.thecut.com",
        "gq.com",
        "www.gq.com",
        "rollingstone.com",
        "www.rollingstone.com",
        "pitchfork.com",
        "www.pitchfork.com",
        "stereogum.com",
        "www.stereogum.com",
        "nme.com",
        "www.nme.com",
        "thequietus.com",
        "www.thequietus.com",
        "vulture.com",
        "www.vulture.com",
    }
)

NEWS_PUBLIC_DOMAINS = {
    "reuters.com",
    "www.reuters.com",
    "apnews.com",
    "www.apnews.com",
    "bbc.com",
    "www.bbc.com",
    "bbc.co.uk",
    "www.bbc.co.uk",
    "npr.org",
    "www.npr.org",
    "theguardian.com",
    "www.theguardian.com",
    "pbs.org",
    "www.pbs.org",
    "aljazeera.com",
    "www.aljazeera.com",
    "dw.com",
    "www.dw.com",
} | set(_EXPANDED_ROUNDUP_DOMAINS)

OPINION_PUBLIC_DOMAINS = {
    "medium.com",
    "www.medium.com",
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
} | set(_EXPANDED_ROUNDUP_DOMAINS)


def _require_client() -> OpenAI:
    if not XAI_API_KEY:
        raise RuntimeError("XAI_API_KEY is not configured")
    return OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")


def _extract_json(raw_text: str) -> Dict[str, Any]:
    text = (raw_text or "").strip()
    if not text:
        raise ValueError("Empty model response")
    try:
        return json.loads(text)
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in model response")
    return json.loads(text[start : end + 1])


def _clean_url(url: str) -> str:
    return (url or "").strip().rstrip(".,;:!?)]}")


def format_response_links(response_text: str) -> str:
    """Normalize markdown/bare links into frontend-friendly markdown."""
    if not response_text:
        return response_text

    # Grok web search may leak proprietary inline citation tags into output.
    # Strip them before we normalize markdown so feed posts stay readable.
    formatted = re.sub(
        r"<grok:render\b[^>]*>.*?</grok:render>",
        "",
        response_text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    formatted = re.sub(r"</?grok:[^>]+>", "", formatted, flags=re.IGNORECASE)

    def get_domain_display(url: str) -> str:
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            if domain.startswith("www."):
                domain = domain[4:]
            return domain or "link"
        except Exception:
            return "link"

    citation_pattern = r"\[\[(\d+)\]\]\((https?://[^)]+)\)"

    def replace_citation(match: re.Match[str]) -> str:
        url = _clean_url(match.group(2))
        return f"[{get_domain_display(url)}]({url})"

    formatted = re.sub(citation_pattern, replace_citation, formatted)
    std_md_pattern = r"\[([^\]]+)\]\((https?://[^)]+)\)"

    def clean_markdown_link(match: re.Match[str]) -> str:
        display = match.group(1)
        url = _clean_url(match.group(2))
        if re.match(r"^\d+$", display) or display.lower().startswith("source"):
            display = get_domain_display(url)
        return f"[{display}]({url})"

    formatted = re.sub(std_md_pattern, clean_markdown_link, formatted)
    formatted = re.sub(r"\)\[", ") [", formatted)

    bare_url_pattern = r'(?<!\]\()(?<!\()(https?://[^\s\)\]<>"]+)'

    def replace_bare_url(match: re.Match[str]) -> str:
        url = _clean_url(match.group(1))
        return f"[{get_domain_display(url)}]({url})"

    formatted = re.sub(bare_url_pattern, replace_bare_url, formatted)

    # Clean up spacing left behind after citation stripping.
    formatted = re.sub(r"[ \t]{2,}", " ", formatted)
    formatted = re.sub(r"\n{3,}", "\n\n", formatted)
    return formatted.strip()


def extract_links(text: str) -> List[str]:
    links = re.findall(r"https?://[^\s\]\)<>\"']+", text or "")
    cleaned = []
    seen = set()
    for link in links:
        normalized = _clean_url(link)
        if normalized and normalized not in seen:
            seen.add(normalized)
            cleaned.append(normalized)
    return cleaned


def filter_links(links: Iterable[str], allowed_domains: Sequence[str]) -> List[str]:
    allowed = {domain.lower() for domain in allowed_domains}
    results: List[str] = []
    seen = set()
    for link in links:
        normalized = _clean_url(link)
        try:
            domain = urlparse(normalized).netloc.lower()
        except Exception:
            domain = ""
        if not normalized or domain not in allowed or normalized in seen:
            continue
        seen.add(normalized)
        results.append(normalized)
    return results


def generate_json(system_prompt: str, user_prompt: str, *, max_tokens: int = 700, temperature: float = 0.6) -> Dict[str, Any]:
    client = _require_client()
    completion = client.chat.completions.create(
        model=GROK_MODEL_FAST,
        messages=[
            {"role": "system", "content": system_prompt + "\nRespond with valid JSON only."},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    content = completion.choices[0].message.content if completion.choices else ""
    return _extract_json(content or "")


def generate_web_search_json(
    system_prompt: str,
    user_prompt: str,
    *,
    max_output_tokens: int = 1200,
    temperature: float = 0.3,
) -> Dict[str, Any]:
    client = _require_client()
    response = client.responses.create(
        model=GROK_MODEL_FAST,
        input=[
            {"role": "system", "content": system_prompt + "\nRespond with valid JSON only."},
            {"role": "user", "content": user_prompt},
        ],
        tools=[{"type": "web_search"}],
        max_output_tokens=max_output_tokens,
        temperature=temperature,
    )
    raw = (response.output_text or "").strip() if hasattr(response, "output_text") else ""
    return _extract_json(raw)


def plan_timely_topic(
    *,
    roundup_kind: str,
    allowed_domains: Sequence[str],
    topic_seed: str = "",
    community_name: str = "",
    community_context_enabled: bool = True,
) -> Dict[str, Any]:
    """Pick one timely topic using public web search results."""
    cleaned_seed = str(topic_seed or "").strip()
    cleaned_community = str(community_name or "").strip()

    if not XAI_API_KEY:
        fallback_topic = cleaned_seed or (
            f"{cleaned_community} conversations" if cleaned_community else f"current {roundup_kind} discussions"
        )
        return {
            "topic": fallback_topic,
            "why_now": "Fallback topic selected because LLM search is unavailable.",
            "source_links": [],
        }

    allowed_list = ", ".join(
        sorted(domain for domain in allowed_domains if not domain.startswith("www."))
    )
    community_line = (
        f"Community context: {cleaned_community}\n"
        if community_context_enabled and cleaned_community
        else ""
    )
    seed_line = (
        f"Standing theme or seed: {cleaned_seed}\n"
        if cleaned_seed
        else "Standing theme or seed: choose a timely angle that fits the community context.\n"
    )
    result = generate_web_search_json(
        system_prompt=(
            f"You are planning one timely topic for Steve's {roundup_kind} roundup. "
            "Use current public web coverage to choose one concrete topic that feels timely and specific. "
            f"Only consider sources from this allowlist: {allowed_list}. "
            "Return JSON with keys: topic, why_now, source_links. "
            "topic should be short, concrete, and ready to place in a headline. "
            "why_now should be one short sentence. "
            "source_links should be an array of 1-4 exact URLs that justify the choice."
        ),
        user_prompt=(
            f"{seed_line}"
            f"{community_line}"
            "Pick a topic Steve can cover right now. Avoid vague evergreen labels such as 'technology news'."
        ),
        max_output_tokens=700,
        temperature=0.2,
    )
    topic = str(result.get("topic") or "").strip()
    if not topic:
        raise ValueError("Unable to choose an automatic topic right now")
    links = filter_links(result.get("source_links") or [], allowed_domains)
    if not links:
        links = filter_links(extract_links(str(result)), allowed_domains)
    return {
        "topic": topic,
        "why_now": str(result.get("why_now") or "").strip(),
        "source_links": links,
    }

