"""Speech-to-text provider chain: OpenAI Whisper primary, xAI Grok STT fallback.

Added after the 2026-07-25/26 OpenAI incidents (500s, then account
``insufficient_quota``) took voice-note summaries down. xAI shipped a
standalone STT API in April 2026 (``POST https://api.x.ai/v1/stt``,
https://docs.x.ai/developers/model-capabilities/audio/speech-to-text) —
it reuses the platform's existing ``XAI_API_KEY``, supports Portuguese,
and returns exact audio duration, so it is the natural second leg.

Notes on the xAI endpoint:

- NOT OpenAI-SDK compatible — plain multipart POST. Option fields must
  precede ``file`` in the body (fields after ``file`` are ignored).
- Accepts a remote ``url`` field, so R2 CDN voice notes skip the local
  download entirely on the fallback path.
- Documented containers: WAV, MP3, OGG, Opus, FLAC, AAC, MP4, M4A, MKV.
  WebM (browser recordings) is undocumented; we attempt it anyway — as a
  fallback the worst case equals today's behaviour (transcription fails).
- Response: ``{"text", "language" ("English"), "duration", "words"}``.
  Language is normalised to lowercase to match Whisper verbose_json.

Circuit-breaker state is shared with :mod:`voice_note_providers` — one
provider account powers both the STT and chat legs, so quota exhaustion
on one leg should open the breaker for both.

This module never logs ``ai_usage`` rows; callers do, using the returned
``model`` so the log row reflects the provider that actually served.
"""

from __future__ import annotations

import logging
import os
import tempfile
from typing import Any, Dict, List, Optional

from backend.services.voice_note_providers import (
    OPENAI_API_KEY,
    XAI_API_KEY,
    is_account_level_error,
    mark_provider_down,
    provider_is_down,
)

logger = logging.getLogger(__name__)

OPENAI_STT_MODEL = os.getenv("VOICE_STT_OPENAI_MODEL", "whisper-1")
# xAI's STT endpoint has no public model id — this label is what we write
# to ai_usage_log.model so provider share stays auditable.
XAI_STT_MODEL_LABEL = "grok-stt"
XAI_STT_URL = "https://api.x.ai/v1/stt"

# Bounded: transcription runs synchronously inside the DM/group send
# request, so a provider outage must fail fast instead of holding every
# voice-note send hostage while SDK retries stack up.
_OPENAI_TIMEOUT_SECONDS = 20.0
_OPENAI_MAX_RETRIES = 1
_XAI_TIMEOUT_SECONDS = 40.0  # upload + transcription in one round-trip

_DOWNLOAD_TIMEOUT_SECONDS = 30


# Mirrors the monolith's UPLOAD_FOLDER (<repo>/static/uploads) without
# importing the app (this module loads before/without Flask).
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER") or os.path.join(_REPO_ROOT, "static", "uploads")


def _resolve_local_path(audio_file_path: str) -> Optional[str]:
    if os.path.isabs(audio_file_path):
        return audio_file_path if os.path.exists(audio_file_path) else None
    rel_path = audio_file_path.replace("uploads/", "", 1)
    for candidate in (os.path.join(_UPLOAD_FOLDER, rel_path), audio_file_path):
        if os.path.exists(candidate):
            return candidate
    return None


def _transcribe_openai(audio_file_path: str) -> Optional[Dict[str, Any]]:
    from openai import OpenAI  # lazy

    client = OpenAI(
        api_key=OPENAI_API_KEY,
        max_retries=_OPENAI_MAX_RETRIES,
        timeout=_OPENAI_TIMEOUT_SECONDS,
    )

    tmp_path = None
    try:
        if audio_file_path.startswith(("http://", "https://")):
            import requests

            logger.info("stt/openai: downloading audio from CDN: %s", audio_file_path)
            response = requests.get(audio_file_path, timeout=_DOWNLOAD_TIMEOUT_SECONDS)
            response.raise_for_status()
            ext = os.path.splitext(audio_file_path)[1] or ".mp4"
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp_file:
                tmp_file.write(response.content)
                tmp_path = tmp_file.name
            local_path = tmp_path
        else:
            local_path = _resolve_local_path(audio_file_path)
            if not local_path:
                logger.warning("stt/openai: file not found: %s", audio_file_path)
                return None

        with open(local_path, "rb") as audio_file:
            result = client.audio.transcriptions.create(
                model=OPENAI_STT_MODEL,
                file=audio_file,
                response_format="verbose_json",
            )
        text = result.text or ""
        return {
            "text": text,
            "language": (getattr(result, "language", None) or "en"),
            "duration_seconds": getattr(result, "duration", None),
            "model": OPENAI_STT_MODEL,
            "provider": "openai",
        }
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def _transcribe_xai(audio_file_path: str) -> Optional[Dict[str, Any]]:
    import requests

    headers = {"Authorization": f"Bearer {XAI_API_KEY}"}

    if audio_file_path.startswith(("http://", "https://")):
        # xAI downloads the URL server-side — no local round-trip needed.
        response = requests.post(
            XAI_STT_URL,
            headers=headers,
            data={"url": audio_file_path},
            timeout=_XAI_TIMEOUT_SECONDS,
        )
    else:
        local_path = _resolve_local_path(audio_file_path)
        if not local_path:
            logger.warning("stt/xai: file not found: %s", audio_file_path)
            return None
        with open(local_path, "rb") as audio_file:
            # Option fields must precede ``file`` in the multipart body;
            # requests emits ``data`` entries before ``files``.
            response = requests.post(
                XAI_STT_URL,
                headers=headers,
                files={"file": (os.path.basename(local_path), audio_file)},
                timeout=_XAI_TIMEOUT_SECONDS,
            )

    if response.status_code == 401:
        exc = RuntimeError("xai stt: 401 unauthorized")
        setattr(exc, "status_code", 401)
        raise exc
    response.raise_for_status()
    payload = response.json()
    text = (payload.get("text") or "").strip()
    if not text:
        return None
    # xAI returns a capitalised language name ("English"); Whisper
    # verbose_json uses lowercase ("english") — normalise to Whisper's
    # convention so downstream lang maps keep working.
    language = (payload.get("language") or "en").strip().lower()
    return {
        "text": text,
        "language": language,
        "duration_seconds": payload.get("duration"),
        "model": XAI_STT_MODEL_LABEL,
        "provider": "xai",
    }


def stt_cost_usd(model: str, duration_seconds: float) -> float:
    """Cost estimate for an STT call, by the model that actually served it.

    OpenAI whisper-1 bills whole minutes at $0.006/min; xAI STT is
    $0.10/hour (REST batch) — https://docs.x.ai/developers/models.
    """
    import math

    seconds = max(0.0, float(duration_seconds or 0))
    if model == XAI_STT_MODEL_LABEL:
        return round(seconds / 3600.0 * 0.10, 6)
    return round(math.ceil(seconds / 60.0) * 0.006, 6)


def _stt_chain() -> List[Dict[str, Any]]:
    chain: List[Dict[str, Any]] = []
    if OPENAI_API_KEY:
        chain.append({"provider": "openai", "fn": _transcribe_openai})
    if XAI_API_KEY:
        chain.append({"provider": "xai", "fn": _transcribe_xai})
    return chain


def transcribe_audio(audio_file_path: str) -> Optional[Dict[str, Any]]:
    """Transcribe a voice note, failing over across providers.

    Args:
        audio_file_path: local path (absolute or uploads-relative) or an
            HTTPS URL (R2 CDN).

    Returns ``{"text", "language", "duration_seconds", "model",
    "provider"}`` on success, ``None`` when every configured provider
    failed or none is configured. Never raises.
    """
    chain = _stt_chain()
    if not chain:
        logger.warning("transcription_providers: no STT provider configured")
        return None

    for entry in chain:
        provider = entry["provider"]
        if provider_is_down(provider):
            logger.info("stt: skipping %s (circuit open)", provider)
            continue
        try:
            result = entry["fn"](audio_file_path)
            if result and result.get("text"):
                logger.info(
                    "stt: %s transcription successful (lang=%s): %.100s...",
                    provider, result.get("language"), result["text"],
                )
                return result
            logger.warning("stt: %s returned empty result, trying next", provider)
        except Exception as exc:
            if is_account_level_error(exc):
                mark_provider_down(provider, str(exc)[:200])
            logger.error("stt: %s failed: %s", provider, exc)
    return None
