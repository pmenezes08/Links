"""Secondary LLM round: attach hosted web_search / x_search when static policy returns none.

Runs only on turns that pass heuristic filters, skip platform/professional-only paths,
and are not profile-intent suppressions. Disabled via ``STEVE_TOOL_ROUTER_DISABLED=1``.
"""

from __future__ import annotations

import logging
import os
import re
import time
from typing import Any, Optional

from openai import OpenAI

from backend.services import ai_usage
from backend.services.onboarding_company_intel import _extract_json
from backend.services.steve_model_config import (
    estimate_response_cost_usd,
    get_steve_model_config,
    response_usage_tokens,
)
from backend.services.steve_tool_policy import (
    normalize_message_for_live_search_signals,
    steve_external_tool_suppressed_for_profile_intent,
    steve_tools_for_message,
    steve_x_search_requested,
)

logger = logging.getLogger(__name__)

XAI_API_KEY = os.getenv("XAI_API_KEY", "")
_ROUTER_MODEL = os.getenv("STEVE_TOOL_ROUTER_MODEL", "grok-4.20-non-reasoning")


_CASUAL_ONLY = re.compile(
    r"^(?:thanks|thank you|thx|ty|ok\.?|okay|k\.?|cool(?: bro)?|nice|got it|perfect|wow|yep|yeah|👍|🙏)\s*[!?.]*$",
    re.I,
)

_AMBIGUOUS_HINT = re.compile(
    r"("
    r"\bweb\b|www\.|\binternet\b|\bonline\b|"
    r"(?<![a-z])x(?![a-z])|twitter|x\.com|"
    r"\bcareer|\bjob(s| opening| postings?)?\b|\bhiring\b|"
    r"\bcompanies\b|\bcompany\b|\bemploy(er|ers)\b|\bopenings?\b|\broles?\b|"
    r"\bresearch\b|\bexplore\b|\bcheck\s+out\b|\bfind(ing)?\b|\bcompare\b|\bdiscover\b|\blook\s+up\b|"
    r"\bwhat is this\b|\bwhat's this\b|\bwhats this\b|"
    r"\bheadlines?\b|\bnews\b|\bcurrent\b"
    r")",
    re.I,
)


def steve_tool_router_ambiguous_public_web_intent(message: str) -> bool:
    """Heuristic: long enough + hints at public web/careers/social research (not a casual ping)."""
    raw = (message or "").strip()
    if len(raw) < 28:
        return False
    if _CASUAL_ONLY.match(raw):
        return False
    if re.fullmatch(r"@steve\b[\s,.!?]*", raw, re.I):
        return False
    text = normalize_message_for_live_search_signals(raw)
    if _AMBIGUOUS_HINT.search(text):
        return True
    if "?" in raw and len(raw) >= 48:
        return True
    return False


def _router_tools_from_flags(
    *,
    web_search: bool,
    x_search: bool,
    config: Any,
) -> list[dict[str, str]]:
    tools: list[dict[str, str]] = []
    attach_w = config is None or bool(getattr(config, "feed_attach_web_search_tool", True))
    attach_x = config is None or bool(getattr(config, "feed_attach_x_search_tool", True))
    if web_search and attach_w:
        tools.append({"type": "web_search"})
    if x_search and attach_x:
        tools.append({"type": "x_search"})
    return tools


_ROUTER_SYSTEM = """You classify a single user message to Steve (C-Point) for TOOL attachment only.

Return ONLY valid JSON: {"web_search": true|false, "x_search": true|false}

Rules:
- web_search true if they need/current public web facts: employers, careers pages, companies, products, docs, news, or general browsing beyond the app.
- x_search true only if they explicitly want X/Twitter/social posts, tweets, or what people say on X about a topic.

Both may be true if they clearly want both (e.g. "web and X").

FALSE for: pure C-Point app/support/pricing questions, chit-chat, thanks, or anything that only needs the in-app manual.
FALSE for looking up **other C-Point users** or anyone by name/handle to infer private details — never treat that as a reason for tools.

When uncertain, prefer false."""


def _call_router_llm(user_text: str) -> tuple[dict[str, bool], Any]:
    """Invoke small Grok call; return (flags dict, raw response for logging)."""
    if not XAI_API_KEY:
        return {"web_search": False, "x_search": False}, None  # type: ignore[return-value]

    client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
    clipped = (user_text or "")[:3500]
    response = client.responses.create(
        model=_ROUTER_MODEL,
        input=[
            {"role": "system", "content": _ROUTER_SYSTEM + "\nRespond with valid JSON only, no markdown."},
            {"role": "user", "content": f"User message:\n{clipped}"},
        ],
        max_output_tokens=120,
        temperature=0,
    )
    raw = (response.output_text or "").strip() if hasattr(response, "output_text") else ""
    data = _extract_json(raw)
    w = bool(data.get("web_search"))
    x = bool(data.get("x_search"))
    return {"web_search": w, "x_search": x}, response


def resolve_steve_hosted_tools(
    message: str,
    *,
    username: str,
    surface: str,
    platform_question: bool = False,
    professional_advice_question: bool = False,
    config: Any = None,
    community_id: Optional[int] = None,
) -> list[dict[str, str]]:
    """Static hosted-tool policy first; optional router when policy is empty and heuristics allow."""
    if platform_question or professional_advice_question:
        return []

    static = steve_tools_for_message(
        message,
        platform_question=False,
        professional_advice_question=False,
        config=config,
    )
    if static:
        return static

    text = message or ""
    if steve_external_tool_suppressed_for_profile_intent(text):
        return []
    if not steve_tool_router_ambiguous_public_web_intent(text):
        return []
    if os.environ.get("STEVE_TOOL_ROUTER_DISABLED", "").strip() in {"1", "true", "yes"}:
        return []

    started = time.perf_counter()
    try:
        flags, response = _call_router_llm(text)
        if not steve_x_search_requested(text):
            flags = {**flags, "x_search": False}
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        tools = _router_tools_from_flags(
            web_search=bool(flags.get("web_search")),
            x_search=bool(flags.get("x_search")),
            config=config,
        )
        if response is not None:
            try:
                tokens_in, tokens_out = response_usage_tokens(response)
                model_cfg = get_steve_model_config()
                ai_usage.log_usage(
                    username,
                    surface=surface,
                    request_type="steve_tool_router",
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    cost_usd=estimate_response_cost_usd(response, model_cfg),
                    response_time_ms=elapsed_ms,
                    community_id=community_id,
                    model=_ROUTER_MODEL,
                )
            except Exception as log_err:
                logger.warning("Steve tool router usage log failed: %s", log_err)
        logger.info(
            "Steve tool router: user=%s surface=%s web=%s x=%s tools=%s",
            username,
            surface,
            flags.get("web_search"),
            flags.get("x_search"),
            [t.get("type") for t in tools],
        )
        return tools
    except Exception as exc:
        logger.warning("Steve tool router failed (no tools): %s", exc)
        return []
