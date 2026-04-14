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
}

OPINION_PUBLIC_DOMAINS = {
    "medium.com",
    "www.medium.com",
}


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

    formatted = re.sub(citation_pattern, replace_citation, response_text)
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

    return re.sub(bare_url_pattern, replace_bare_url, formatted)


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

