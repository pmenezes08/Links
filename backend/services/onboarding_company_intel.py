"""Onboarding helper: short company blurb via xAI web search, OpenAI Responses fallback."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, Optional, Tuple

from openai import OpenAI

logger = logging.getLogger(__name__)

XAI_API_KEY = os.getenv("XAI_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
# Keep in sync with onboarding blueprint compose_bio model.
GROK_MODEL = os.getenv("ONBOARDING_GROK_MODEL", "grok-4.3")
OPENAI_COMPANY_INTEL_MODEL = os.getenv("ONBOARDING_OPENAI_COMPANY_INTEL_MODEL", "gpt-5.5")
XAI_CHAT_BASE = "https://api.x.ai/v1"


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


def _intel_prompts(company_clean: str, role: str) -> Tuple[str, str]:
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
    return system_prompt, user_prompt


def _intel_text_from_response(response: Any) -> Optional[str]:
    raw = (response.output_text or "").strip() if hasattr(response, "output_text") else ""
    if not raw:
        return None
    try:
        data = _extract_json(raw)
    except Exception as exc:
        logger.debug("company_intel JSON parse failed: %s", exc)
        return None
    text = (data.get("company_intel") or "").strip()
    return text or None


def _fetch_via_xai(company_clean: str, role: str) -> Tuple[Optional[str], Optional[Any]]:
    if not XAI_API_KEY:
        return None, None
    system_prompt, user_prompt = _intel_prompts(company_clean, role)
    client = OpenAI(api_key=XAI_API_KEY, base_url=XAI_CHAT_BASE)
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
        return _intel_text_from_response(response), response
    except Exception as exc:
        logger.warning("company_intel xAI responses.create failed: %s", exc)
        return None, None


def _openai_responses_create_kwargs(
    system_prompt: str,
    user_prompt: str,
) -> Dict[str, Any]:
    return {
        "model": OPENAI_COMPANY_INTEL_MODEL,
        "input": [
            {"role": "system", "content": system_prompt + "\nRespond with valid JSON only."},
            {"role": "user", "content": user_prompt},
        ],
        "tools": [{"type": "web_search"}],
        "max_output_tokens": 500,
    }


def _fetch_via_openai_responses(company_clean: str, role: str) -> Tuple[Optional[str], Optional[Any]]:
    if not OPENAI_API_KEY:
        return None, None
    system_prompt, user_prompt = _intel_prompts(company_clean, role)
    client = OpenAI(api_key=OPENAI_API_KEY)
    base_kwargs = _openai_responses_create_kwargs(system_prompt, user_prompt)
    try:
        response = client.responses.create(**base_kwargs, temperature=0.3)
    except TypeError:
        response = client.responses.create(**base_kwargs)
    except Exception as exc:
        logger.warning("company_intel OpenAI responses.create failed: %s", exc)
        try:
            response = client.responses.create(**base_kwargs)
        except Exception as exc2:
            logger.warning("company_intel OpenAI responses.create retry failed: %s", exc2)
            return None, None
    return _intel_text_from_response(response), response


def fetch_company_intel_blurb(company: str, *, role: str = "") -> Tuple[str, Optional[Any], str]:
    """Return ``(plain_text_intel, response_obj, model_id_for_logging)``.

    Tries xAI ``responses.create`` + ``web_search`` first, then OpenAI Responses + ``web_search`` when
    xAI is unavailable or returns no usable blurb. ``response_obj`` is from the **successful** call;
    ``None`` if both fail. ``model_id_for_logging`` is the provider model id used on success, else ``""``.
    """
    company_clean = (company or "").strip()
    if not company_clean:
        return "", None, ""

    if XAI_API_KEY:
        text, resp = _fetch_via_xai(company_clean, role)
        if text:
            return text, resp, GROK_MODEL

    if OPENAI_API_KEY:
        text, resp = _fetch_via_openai_responses(company_clean, role)
        if text:
            return text, resp, OPENAI_COMPANY_INTEL_MODEL

    return "", None, ""


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
