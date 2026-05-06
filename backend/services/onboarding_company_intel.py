"""Onboarding helper: short company blurb via xAI web search (non-Steve surface)."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional, Tuple

from openai import OpenAI

logger = logging.getLogger(__name__)

XAI_API_KEY = os.getenv("XAI_API_KEY", "")
# Keep in sync with onboarding blueprint compose_bio model.
GROK_MODEL = os.getenv("ONBOARDING_GROK_MODEL", "grok-4.20-non-reasoning")


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


def fetch_company_intel_blurb(company: str, *, role: str = "") -> Tuple[str, Optional[Any]]:
    """Return ``(plain_text_intel, response_obj)`` for usage logging.

    ``response_obj`` is the xAI ``responses`` object on success, or ``None``
    when skipped or on error.
    """
    company_clean = (company or "").strip()
    if not company_clean or not XAI_API_KEY:
        return "", None

    client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
    role_hint = f"The member's stated role is: {role.strip()}.\n\n" if (role or "").strip() else ""
    system_prompt = (
        "You research organizations using web search. Write a short, factual company blurb for a "
        "professional networking profile. Rules: 2-4 sentences; neutral tone; only state facts "
        "that search results support; if the name is ambiguous or data is thin, stay generic and do "
        "not invent revenue, headcount, funding, dates, or locations; no investment advice; "
        "no hype; no hashtags or emojis. "
        'Return ONLY valid JSON: {"company_intel": "<plain text>"}'
    )
    user_prompt = (
        role_hint
        + f"Company or organization name: {company_clean}\n\n"
        + "Summarize what it is and does so another professional can understand context before connecting."
    )
    try:
        response = client.responses.create(
            model=GROK_MODEL,
            input=[
                {"role": "system", "content": system_prompt + "\nRespond with valid JSON only."},
                {"role": "user", "content": user_prompt},
            ],
            tools=[{"type": "web_search"}],
            max_output_tokens=500,
            temperature=0.3,
        )
        raw = (response.output_text or "").strip() if hasattr(response, "output_text") else ""
        data = _extract_json(raw)
        text = (data.get("company_intel") or "").strip()
        if not text:
            return "", response
        return text, response
    except Exception as exc:
        logger.warning("fetch_company_intel_blurb failed: %s", exc)
        return "", None


def usage_from_responses_api(response: Any) -> Tuple[int, int]:
    """Best-effort token counts from a ``responses.create`` result."""
    if response is None:
        return 0, 0
    u = getattr(response, "usage", None)
    if u is None:
        return 0, 0
    tin = getattr(u, "input_tokens", None) or getattr(u, "prompt_tokens", None) or 0
    tout = getattr(u, "output_tokens", None) or getattr(u, "completion_tokens", None) or 0
    try:
        return int(tin or 0), int(tout or 0)
    except Exception:
        return 0, 0


def usage_from_chat_completion(response: Any) -> Tuple[int, int]:
    """Token counts from ``chat.completions.create``."""
    u = getattr(response, "usage", None)
    if u is None:
        return 0, 0
    tin = getattr(u, "prompt_tokens", None) or getattr(u, "input_tokens", None) or 0
    tout = getattr(u, "completion_tokens", None) or getattr(u, "output_tokens", None) or 0
    try:
        return int(tin or 0), int(tout or 0)
    except Exception:
        return 0, 0
