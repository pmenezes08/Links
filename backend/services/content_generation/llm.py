"""LLM helpers for Steve content generation ideas."""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
from contextlib import contextmanager
from typing import Any, Dict, Iterable, List, Optional, Sequence, Union
from urllib.parse import urlparse

from openai import OpenAI

logger = logging.getLogger(__name__)

# ── Usage metering ───────────────────────────────────────────────────────
#
# These helpers are shared by content generation AND the Steve Builder.
# Metering is CONTEXT-GATED: a caller that owns the spend (content-gen's
# execute_job, the builder's chat/plan routes and build worker) wraps its work
# in ``usage_context(...)`` and every paid call inside logs one real-token row
# (tokens_in/out + cost_usd) to ai_usage_log. No context → no row here, so a
# caller that logs its own rows can't double-count. This closes the gap that
# let ~4.6k web-search grok calls burn credits invisibly (July 2026 xAI credit
# exhaustion) and the follow-up gap where builder LLM spend carried no
# tokens/cost at all.

_USAGE_CTX: contextvars.ContextVar[Optional[Dict[str, Any]]] = contextvars.ContextVar(
    "content_gen_usage_ctx", default=None
)


@contextmanager
def usage_context(*, username: str, request_type: str, community_id: Optional[int] = None,
                  surface: Optional[str] = None):
    """Attribute all paid LLM calls inside this block to one actor/job.

    ``surface`` overrides the default ``content_gen`` ai_usage surface so
    other metered callers (the Steve Builder's chat / plan / build pipeline)
    reuse the same context-gated metering without mislabelling their rows.
    Contexts nest: an inner context (e.g. the vision judge inside a build)
    wins for the calls it wraps, then the outer one is restored.
    """
    token = _USAGE_CTX.set(
        {
            "username": username,
            "request_type": request_type,
            "community_id": community_id,
            "surface": surface,
        }
    )
    try:
        yield
    finally:
        _USAGE_CTX.reset(token)


def _usage_tokens(usage: Any) -> tuple:
    """Extract (tokens_in, tokens_out) from any provider usage shape."""
    if usage is None:
        return None, None

    def _get(*names):
        for name in names:
            val = getattr(usage, name, None)
            if val is None and isinstance(usage, dict):
                val = usage.get(name)
            if val is not None:
                try:
                    return int(val)
                except Exception:
                    return None
        return None

    return (
        _get("input_tokens", "prompt_tokens"),
        _get("output_tokens", "completion_tokens"),
    )


def _log_llm_usage(response: Any, *, model: str, tools_web_search: bool = False) -> None:
    """Log one ai_usage row for a completed upstream call — only when a
    usage context is active. Never raises."""
    ctx = _USAGE_CTX.get()
    if not ctx:
        return
    try:
        from backend.services import ai_usage

        tokens_in, tokens_out = _usage_tokens(getattr(response, "usage", None))
        cost_usd = None
        if tokens_in is not None or tokens_out is not None:
            try:
                from backend.services.steve_model_config import estimate_model_cost_usd

                cost_usd = estimate_model_cost_usd(model, tokens_in, tokens_out)
            except Exception:
                cost_usd = None
        ai_usage.log_usage(
            ctx["username"],
            surface=ctx.get("surface") or ai_usage.SURFACE_CONTENT_GEN,
            request_type=ctx["request_type"],
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost_usd,
            community_id=ctx.get("community_id"),
            model=model,
            tools_web_search=tools_web_search,
        )
    except Exception:
        logger.warning("content-gen usage logging failed", exc_info=True)

XAI_API_KEY = os.getenv("XAI_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
GROK_MODEL_FAST = os.getenv("STEVE_CONTENT_MODEL", "grok-4.20-non-reasoning")

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


def _is_openai_model(model: str) -> bool:
    """OpenAI models (gpt-*, o-series) route to OpenAI; everything else to xAI."""
    m = (model or "").lower()
    return m.startswith("gpt") or m.startswith("o1") or m.startswith("o3") or m.startswith("o4")


def _is_anthropic_model(model: str) -> bool:
    """Anthropic Claude models (claude-*) route to the Anthropic SDK."""
    return (model or "").lower().startswith("claude")


def _strip_markdown_json_fence(raw_text: str) -> str:
    """If the model wrapped JSON in a markdown fence, extract the inner body."""
    text = (raw_text or "").strip()
    if not text or "```" not in text:
        return text
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return text


def _extract_json(raw_text: str) -> Dict[str, Any]:
    text = _strip_markdown_json_fence(raw_text)
    text = text.strip()
    if not text:
        raise ValueError("Empty model response")
    try:
        return json.loads(text)
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        _log_bad_json_payload(raw_text)
        raise ValueError("No JSON object found in model response")
    try:
        return json.loads(text[start : end + 1])
    except Exception:
        _log_bad_json_payload(raw_text)
        raise ValueError("No JSON object found in model response") from None


def _log_bad_json_payload(raw_text: str) -> None:
    raw = raw_text or ""
    prefix = raw[:240].replace("\n", "\\n")
    logger.warning(
        "content_generation_llm: could not parse JSON (len=%s prefix=%r)",
        len(raw),
        prefix,
    )


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


def _apply_output_cap(requested: int, caps: Optional[Dict[str, Any]]) -> int:
    """Return the lower of the caller's request and any entitlement cap.

    Callers pass ``caps`` through from ``resolve_entitlements()`` so that
    Free / Trial / Premium / Special users get their surface-specific
    ceiling enforced centrally without sprinkling the logic everywhere.
    """
    try:
        req = int(requested)
    except Exception:
        req = 700
    if not caps:
        return req
    for key in ("max_output_tokens", "max_output_tokens_feed", "max_output_tokens_group"):
        val = caps.get(key)
        if isinstance(val, int) and val > 0:
            req = min(req, val)
    return max(1, req)


def generate_json(
    system_prompt: str,
    user_prompt: str,
    *,
    max_tokens: int = 700,
    temperature: float = 0.6,
    caps: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    client = _require_client()
    effective_max = _apply_output_cap(max_tokens, caps)
    completion = client.chat.completions.create(
        model=GROK_MODEL_FAST,
        messages=[
            {"role": "system", "content": system_prompt + "\nRespond with valid JSON only."},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        max_tokens=effective_max,
        response_format={"type": "json_object"},
    )
    _log_llm_usage(completion, model=GROK_MODEL_FAST)
    content = completion.choices[0].message.content if completion.choices else ""
    return _extract_json(content or "")


def generate_web_search_json(
    system_prompt: str,
    user_prompt: str,
    *,
    max_output_tokens: int = 1200,
    temperature: float = 0.3,
    caps: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    client = _require_client()
    effective_max = _apply_output_cap(max_output_tokens, caps)
    response = client.responses.create(
        model=GROK_MODEL_FAST,
        input=[
            {"role": "system", "content": system_prompt + "\nRespond with valid JSON only."},
            {"role": "user", "content": user_prompt},
        ],
        tools=[{"type": "web_search"}],
        max_output_tokens=effective_max,
        temperature=temperature,
    )
    _log_llm_usage(response, model=GROK_MODEL_FAST, tools_web_search=True)
    raw = (response.output_text or "").strip() if hasattr(response, "output_text") else ""
    if not raw:
        logger.warning("generate_web_search_json: empty output_text from responses API")
        return {}
    try:
        return _extract_json(raw)
    except ValueError as exc:
        logger.warning(
            "generate_web_search_json: %s (len=%s prefix=%r)",
            exc,
            len(raw),
            raw[:240].replace("\n", "\\n"),
        )
        return {}


_RESEARCH_MODEL = os.getenv("STEVE_BUILDER_RESEARCH_MODEL", "gpt-4o")


def web_search_json(system_prompt: str, user_prompt: str, *, max_output_tokens: int = 1800) -> Dict[str, Any]:
    """Run a REAL web search via OpenAI's hosted web_search tool and return parsed
    JSON. NOTE: ``generate_web_search_json`` above targets the xAI endpoint, which
    does NOT support the OpenAI hosted web_search tool — use THIS for genuine web
    grounding. Best-effort: returns {} if the key/tool/model is unavailable."""
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured")
    oai = OpenAI(api_key=OPENAI_API_KEY)
    base = dict(
        model=_RESEARCH_MODEL,
        input=[
            {"role": "system", "content": system_prompt + "\nRespond with valid JSON only."},
            {"role": "user", "content": user_prompt},
        ],
        max_output_tokens=max_output_tokens,
    )
    raw = ""
    for tool_type in ("web_search", "web_search_preview"):  # tool name varies by SDK/model
        try:
            response = oai.responses.create(tools=[{"type": tool_type}], **base)
            _log_llm_usage(response, model=_RESEARCH_MODEL, tools_web_search=True)
            raw = (response.output_text or "").strip() if hasattr(response, "output_text") else ""
            if raw:
                break
        except Exception as exc:
            logger.warning("web_search_json: tool '%s' failed: %s", tool_type, exc)
            continue
    if not raw:
        return {}
    try:
        return _extract_json(raw)
    except ValueError:
        logger.warning("web_search_json: unparseable JSON (prefix=%r)", raw[:200])
        return {}


def web_search_text(system_prompt: str, user_prompt: str, *, max_output_tokens: int = 2400) -> str:
    """Run a web search and return the RAW text answer. Uses the xAI responses
    API + hosted web_search tool — the path proven (in prod logs) to return real,
    current data. We deliberately do NOT ask for / parse JSON: the search model
    reliably returns prose with citations, and JSON parsing was silently dropping
    every result. Best-effort; raises on hard failure so the caller can fall back."""
    client = _require_client()
    response = client.responses.create(
        model=GROK_MODEL_FAST,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        tools=[{"type": "web_search"}],
        max_output_tokens=max_output_tokens,
    )
    _log_llm_usage(response, model=GROK_MODEL_FAST, tools_web_search=True)
    return (response.output_text or "").strip() if hasattr(response, "output_text") else ""


def vision_json(
    system_prompt: str,
    user_prompt: str,
    image_b64_png: Union[str, List[str]],
    *,
    model: str = "claude-opus-4-8",
    max_tokens: int = 1200,
    timeout: float = 90,
) -> Dict[str, Any]:
    """Vision completion: send one or more PNG screenshots (base64) + a prompt to
    a vision-capable Claude model and parse a JSON object from the reply. Used by
    the Steve Builder vision-judge to grade a rendered artifact — multiple images
    (mobile fold / full page / desktop) go in ONE call so the judge stays one
    paid call per pass. Anthropic-only (Opus/Sonnet are vision-capable); raises
    if the key is unset or no JSON is found, so the caller can degrade
    gracefully."""
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured")
    import anthropic
    aclient = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    images = [image_b64_png] if isinstance(image_b64_png, str) else list(image_b64_png)
    content: List[Dict[str, Any]] = [
        {"type": "image", "source": {"type": "base64",
                                     "media_type": "image/png",
                                     "data": img}}
        for img in images if img
    ]
    content.append({"type": "text", "text": user_prompt})
    msg = aclient.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": content}],
        timeout=timeout,
    )
    _log_llm_usage(msg, model=model)
    text = next((b.text for b in msg.content if getattr(b, "type", None) == "text"), "")
    return _extract_json(text)


def generate_text(
    system_prompt: str,
    user_prompt: str,
    *,
    max_tokens: int = 4000,
    temperature: float = 0.6,
    caps: Optional[Dict[str, Any]] = None,
    model: Optional[str] = None,
    timeout: Optional[float] = None,
) -> str:
    """Plain-text completion from Grok (no JSON coercion).

    Used by the Steve Builder to generate a self-contained HTML artifact.
    Callers that need a large artifact pass ``caps=None`` so the small
    chat per-turn token ceilings don't truncate the output; cost is governed
    by the builder's own monthly cap, not per-turn tokens. ``model`` lets a
    caller pick a stronger (e.g. reasoning) model than the fast default.
    ``timeout`` (seconds) caps the upstream call — callers on a wall-clock
    budget (e.g. the builder render/repair pass) pass a tight value so a slow
    generation can't blow the request/lease budget.
    """
    effective_max = _apply_output_cap(max_tokens, caps)
    mdl = model or GROK_MODEL_FAST
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    if _is_anthropic_model(mdl):
        # Anthropic Claude (Fable/Opus/Sonnet/Haiku) via the official SDK. These
        # models reject `temperature` (400), so we omit it; `max_tokens` is the
        # output cap, and an explicit timeout suppresses the SDK's large-output
        # guard. Fable 5 additionally runs safety classifiers that can decline a
        # request (HTTP 200 + stop_reason "refusal"), so for Fable/Mythos we opt
        # into the server-side fallback: a declined call is transparently
        # re-served by Opus 4.8 inside the same request. Sent as raw
        # header/body (not typed SDK params) so any anthropic>=0.40 works.
        if not ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")
        import anthropic
        aclient = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        extra: Dict[str, Any] = {}
        if mdl.startswith(("claude-fable", "claude-mythos")):
            extra = {
                "extra_headers": {"anthropic-beta": "server-side-fallback-2026-06-01"},
                "extra_body": {"fallbacks": [{"model": "claude-opus-4-8"}]},
            }
        msg = aclient.messages.create(
            model=mdl,
            max_tokens=effective_max,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
            timeout=timeout if timeout is not None else 600,
            **extra,
        )
        # Log the model that actually served the response (the fallback model
        # when the primary declined) so ai_usage rows reflect real billing.
        _log_llm_usage(msg, model=str(getattr(msg, "model", "") or mdl))
        if getattr(msg, "stop_reason", None) == "refusal":
            # Whole chain declined — return empty so the builder's own model
            # fallback (fast tier) takes over instead of shipping a partial.
            logger.warning("anthropic refusal on %s; returning empty artifact", mdl)
            return ""
        return next((b.text for b in msg.content if getattr(b, "type", None) == "text"), "")
    if _is_openai_model(mdl):
        # OpenAI GPT-5.x runs through the Responses API with max_output_tokens
        # (mirrors the onboarding services); these models reject chat-style
        # max_tokens and a non-default temperature, so we omit temperature.
        if not OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        oai = OpenAI(api_key=OPENAI_API_KEY)
        response = oai.responses.create(
            model=mdl,
            input=messages,
            max_output_tokens=effective_max,
            timeout=timeout,
        )
        _log_llm_usage(response, model=mdl)
        if hasattr(response, "output_text") and response.output_text:
            return response.output_text
        return ""
    client = _require_client()
    completion = client.chat.completions.create(
        model=mdl,
        messages=messages,
        temperature=temperature,
        max_tokens=effective_max,
        timeout=timeout,
    )
    _log_llm_usage(completion, model=mdl)
    if not completion.choices:
        return ""
    return completion.choices[0].message.content or ""


def trim_messages(messages: List[Dict[str, Any]], caps: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Trim a conversation ``messages`` list to ``caps['max_context_messages']``.

    The system prompt (first role=``system`` message) is preserved; only
    historical user/assistant turns are dropped from the oldest end.
    """
    if not caps or not messages:
        return messages
    try:
        limit = int(caps.get("max_context_messages") or 0)
    except Exception:
        return messages
    if limit <= 0 or len(messages) <= limit:
        return messages
    system_msgs = [m for m in messages if (m.get("role") == "system")]
    other_msgs = [m for m in messages if (m.get("role") != "system")]
    keep = other_msgs[-max(1, limit - len(system_msgs)):]
    return system_msgs + keep


def cap_images(image_urls: List[str], caps: Optional[Dict[str, Any]]) -> List[str]:
    """Truncate ``image_urls`` to ``caps['max_images_per_turn']``."""
    if not caps:
        return image_urls
    try:
        limit = int(caps.get("max_images_per_turn") or 0)
    except Exception:
        return image_urls
    if limit <= 0:
        return image_urls
    return list(image_urls)[:limit]


def plan_timely_topic(
    *,
    roundup_kind: str,
    allowed_domains: Sequence[str],
    topic_seed: str = "",
    community_name: str = "",
    community_context_enabled: bool = True,
    recency_instructions: str = "",
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
    recency = (recency_instructions or "").strip()
    recency_block = f"\n{recency}\n" if recency else ""
    result = generate_web_search_json(
        system_prompt=(
            f"You are planning one timely topic for Steve's {roundup_kind} roundup. "
            "Use current public web coverage to choose one concrete topic that feels timely and specific. "
            f"Only consider sources from this allowlist: {allowed_list}. "
            "Return JSON with keys: topic, why_now, source_links. "
            "topic should be short, concrete, and ready to place in a headline. "
            "why_now should be one short sentence. "
            "source_links should be an array of 1-4 exact URLs that justify the choice. "
            "Every URL must support news or events within the recency window when a recency rule is given."
            f"{recency_block}"
        ),
        user_prompt=(
            f"{seed_line}"
            f"{community_line}"
            f"{recency_block}"
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

