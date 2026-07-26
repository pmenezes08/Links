"""Provider chains for the voice-note pipeline (summary / translation / STT).

Why this exists: on 2026-07-25 OpenAI returned 500s and on 2026-07-26 the
account hit ``insufficient_quota`` — every voice-note summary died with it
even though Steve's own xAI account was healthy. The pipeline must not have
a single-provider point of failure.

Each leg of the pipeline gets an ordered provider chain:

- ``summarize_transcript`` / ``translate_text``: OpenAI ``gpt-4o-mini``
  first, then xAI Grok (same OpenAI-compatible SDK, ``base_url`` swap).
- Transcription lives in :mod:`backend.services.transcription_providers`.

Account-level failures (quota exhausted, invalid key) trip a per-instance
circuit breaker so subsequent calls skip the dead provider for a cooldown
window instead of paying a failed round-trip per voice note. Transient
errors (5xx, timeouts) do NOT trip the breaker — they just fail over for
that one call.

Callers must keep routing usage accounting through ``ai_usage`` — this
module never logs usage itself; it returns the model id that actually
served the call so the caller can log it truthfully.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
XAI_API_KEY = os.getenv("XAI_API_KEY", "")
XAI_BASE_URL = "https://api.x.ai/v1"

# Model choices. gpt-4o-mini is the historical default for the summary leg;
# grok-4.3 is the platform's standard Steve model (already priced/monitored).
OPENAI_SUMMARY_MODEL = os.getenv("VOICE_SUMMARY_OPENAI_MODEL", "gpt-4o-mini")
XAI_SUMMARY_MODEL = os.getenv("VOICE_SUMMARY_XAI_MODEL", "grok-4.3")

# Bounded like transcribe_audio_file: these calls run synchronously inside
# the send request, so a provider outage must fail fast, not stack retries.
_REQUEST_TIMEOUT_SECONDS = 20.0
_MAX_RETRIES = 1

_BREAKER_COOLDOWN_SECONDS = int(os.getenv("VOICE_PROVIDER_BREAKER_SECONDS", "600"))

_breaker_lock = threading.Lock()
_provider_down_until: Dict[str, float] = {}


def mark_provider_down(provider: str, reason: str) -> None:
    """Open the circuit for a provider account (shared across all legs —
    if the OpenAI account is out of quota, Whisper and gpt-4o-mini are
    equally dead, so STT and chat legs share these keys)."""
    with _breaker_lock:
        _provider_down_until[provider] = time.monotonic() + _BREAKER_COOLDOWN_SECONDS
    logger.warning(
        "voice_note_providers: %s marked down for %ss (%s)",
        provider, _BREAKER_COOLDOWN_SECONDS, reason,
    )


def provider_is_down(provider: str) -> bool:
    with _breaker_lock:
        deadline = _provider_down_until.get(provider)
        if deadline is None:
            return False
        if time.monotonic() >= deadline:
            del _provider_down_until[provider]
            return False
        return True


def reset_breakers() -> None:
    """Test helper — clear all circuit-breaker state."""
    with _breaker_lock:
        _provider_down_until.clear()


def is_account_level_error(exc: Exception) -> bool:
    """True for errors that mean the provider account itself is unusable
    (quota exhausted, bad key) — retrying other requests won't help."""
    text = str(exc).lower()
    if "insufficient_quota" in text or "invalid_api_key" in text:
        return True
    code = getattr(exc, "code", None)
    if code in ("insufficient_quota", "invalid_api_key"):
        return True
    status = getattr(exc, "status_code", None)
    return status == 401


def make_client(provider: str):
    from openai import OpenAI  # lazy: keeps module importable without the SDK

    if provider == "openai":
        return OpenAI(
            api_key=OPENAI_API_KEY,
            max_retries=_MAX_RETRIES,
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
    if provider == "xai":
        return OpenAI(
            api_key=XAI_API_KEY,
            base_url=XAI_BASE_URL,
            max_retries=_MAX_RETRIES,
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
    raise ValueError(f"unknown provider: {provider}")


def _chat_providers() -> List[Dict[str, str]]:
    chain = []
    if OPENAI_API_KEY:
        chain.append({"provider": "openai", "model": OPENAI_SUMMARY_MODEL})
    if XAI_API_KEY:
        chain.append({"provider": "xai", "model": XAI_SUMMARY_MODEL})
    return chain


def _run_chat_chain(
    system_prompt: str,
    user_prompt: str,
    *,
    max_tokens: int,
    temperature: float,
    what: str,
) -> Optional[Dict[str, Any]]:
    """Try each provider in order; return the first success.

    Returns ``{"text", "model", "tokens_in", "tokens_out"}`` or ``None``
    when every provider failed or none is configured.
    """
    chain = _chat_providers()
    if not chain:
        logger.warning("voice_note_providers: no provider configured for %s", what)
        return None

    for entry in chain:
        provider, model = entry["provider"], entry["model"]
        if provider_is_down(provider):
            logger.info(
                "voice_note_providers: skipping %s for %s (circuit open)",
                provider, what,
            )
            continue
        try:
            client = make_client(provider)
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=max_tokens,
                temperature=temperature,
            )
            text = (response.choices[0].message.content or "").strip()
            if not text:
                logger.warning(
                    "voice_note_providers: %s returned empty %s, trying next",
                    provider, what,
                )
                continue
            usage = getattr(response, "usage", None)
            return {
                "text": text,
                "model": model,
                "tokens_in": getattr(usage, "prompt_tokens", None) if usage else None,
                "tokens_out": getattr(usage, "completion_tokens", None) if usage else None,
            }
        except Exception as exc:
            if is_account_level_error(exc):
                mark_provider_down(provider, str(exc)[:200])
            logger.error(
                "voice_note_providers: %s failed for %s: %s", provider, what, exc
            )
    return None


# ── Summary leg ─────────────────────────────────────────────────────────

_SUMMARY_LANG_MAP = {
    'en': 'English', 'pt': 'European Portuguese (PT-PT)', 'es': 'Spanish',
    'fr': 'French', 'de': 'German', 'it': 'Italian', 'nl': 'Dutch',
    'ga': 'Irish', 'pl': 'Polish', 'ru': 'Russian', 'ja': 'Japanese',
    'zh': 'Mandarin Chinese', 'ko': 'Korean', 'ar': 'Arabic',
    'english': 'English', 'portuguese': 'European Portuguese (PT-PT)',
    'spanish': 'Spanish', 'french': 'French', 'german': 'German',
    'italian': 'Italian', 'dutch': 'Dutch', 'irish': 'Irish',
    'polish': 'Polish', 'russian': 'Russian', 'japanese': 'Japanese',
    'chinese': 'Mandarin Chinese', 'korean': 'Korean', 'arabic': 'Arabic',
}


def summarize_transcript(
    text: str,
    *,
    username: Optional[str] = None,
    language: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Summarize a voice-note transcript with provider fallback.

    Accepts Whisper full language names ("portuguese") or ISO codes ("pt").
    Returns ``{"text", "model", "tokens_in", "tokens_out"}`` or ``None``.
    """
    if not text or len(text.strip()) < 20:
        return None

    target_lang = _SUMMARY_LANG_MAP.get(
        language.lower() if language else '', 'English'
    ) or 'English'

    system_prompt = f"""You are a helpful assistant that summarizes audio transcriptions.

You MUST write your summary in {target_lang}. This is non-negotiable.

Content requirements:
- Provide a concise 1-2 sentence summary of the main points
- Refer to the person by their name if provided, not as 'the speaker' or 'the user'
- Write ONLY in {target_lang}"""

    if username:
        user_prompt = (
            f"Summarize this audio transcription from {username}. "
            f"Write the summary in {target_lang}.\n\n{text}"
        )
    else:
        user_prompt = (
            f"Summarize this audio transcription. "
            f"Write the summary in {target_lang}.\n\n{text}"
        )

    return _run_chat_chain(
        system_prompt, user_prompt,
        max_tokens=150, temperature=0.5, what="voice_summary",
    )


# ── Translation leg ─────────────────────────────────────────────────────

def translate_text(text: str, target_lang_name: str) -> Optional[Dict[str, Any]]:
    """Translate a summary with provider fallback. Same return contract."""
    if not text:
        return None

    system_prompt = f"""You are a professional translator. Translate the given text to {target_lang_name}.
Rules:
- Maintain the meaning and tone of the original text
- Keep the same level of formality
- If translating to European Portuguese, use Portugal vocabulary and grammar, NOT Brazilian Portuguese
- Keep proper names unchanged
- Preserve any technical terms that don't need translation"""

    return _run_chat_chain(
        system_prompt,
        f"Translate this to {target_lang_name}:\n\n{text}",
        max_tokens=200, temperature=0.3, what="translate_summary",
    )


def any_chat_provider_configured() -> bool:
    return bool(OPENAI_API_KEY or XAI_API_KEY)
