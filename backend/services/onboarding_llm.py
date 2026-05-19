"""Onboarding chat completions: xAI primary, OpenAI gpt-4o fallback."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, List

from openai import OpenAI

logger = logging.getLogger(__name__)

XAI_API_KEY = os.getenv("XAI_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
XAI_CHAT_BASE = "https://api.x.ai/v1"
ONBOARDING_OPENAI_FALLBACK_MODEL = "gpt-4o"


def extract_json_object_from_llm_text(raw: str) -> dict[str, Any]:
    """Parse JSON from model output; tolerate markdown fences and extra text."""
    text = (raw or "").strip()
    if not text:
        raise ValueError("Empty model response")
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object in model response")
    data = json.loads(text[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("JSON root must be an object")
    return data


def run_onboarding_chat_completion(
    messages: List[dict[str, Any]],
    *,
    max_tokens: int,
    temperature: float,
    primary_model: str,
) -> tuple[Any, str]:
    """
    Try xAI chat completions first when XAI_API_KEY is set; on failure try OpenAI gpt-4o.
    Returns (response, model_id_used).
    """
    last_exc: Exception | None = None

    if XAI_API_KEY:
        try:
            client = OpenAI(api_key=XAI_API_KEY, base_url=XAI_CHAT_BASE)
            response = client.chat.completions.create(
                model=primary_model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return response, primary_model
        except Exception as e:
            last_exc = e
            logger.warning("onboarding xAI chat completion failed: %s", e)

    if OPENAI_API_KEY:
        try:
            client = OpenAI(api_key=OPENAI_API_KEY)
            response = client.chat.completions.create(
                model=ONBOARDING_OPENAI_FALLBACK_MODEL,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return response, ONBOARDING_OPENAI_FALLBACK_MODEL
        except Exception as e:
            last_exc = e
            logger.warning("onboarding OpenAI fallback chat completion failed: %s", e)

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("No LLM API keys configured for onboarding chat (need XAI_API_KEY and/or OPENAI_API_KEY)")
