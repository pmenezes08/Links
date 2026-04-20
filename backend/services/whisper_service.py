"""Whisper transcription wrapper — the gated entry point.

The underlying OpenAI Whisper call lives in the legacy monolith
(``bodybuilding_app.transcribe_audio_file``). This module wraps it so that:

1. Entitlements are checked *before* we spend money on the API call.
2. Audio duration is measured and written to ``ai_usage_log`` so the
   monthly Whisper-minutes counter is accurate.
3. Callers get a consistent return contract regardless of whether the
   gate allowed or denied the call.

New callers should route through :func:`transcribe` — the monolith's
``transcribe_audio_file`` is kept in place for legacy paths and will be
migrated as each call-site is touched.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Optional, Tuple

from backend.services import ai_usage
from backend.services import entitlements_errors as errs
from backend.services.entitlements_gate import gate_or_reason


logger = logging.getLogger(__name__)


WHISPER_MODEL = "whisper-1"
# OpenAI Whisper current public price — fallback used when the KB is missing.
_FALLBACK_PRICE_USD_PER_MINUTE = 0.006


def _probe_duration_seconds(audio_path_or_url: str) -> Optional[float]:
    """Best-effort duration probe — tries mutagen, then ffprobe, then falls back."""
    # Remote URLs — we'd have to download twice; skip the probe and accept
    # the cost of measuring duration post-hoc from the Whisper response.
    if audio_path_or_url.startswith(("http://", "https://")):
        return None

    path = audio_path_or_url
    if not os.path.isabs(path):
        for candidate in (
            os.path.join("uploads", path),
            path,
        ):
            if os.path.exists(candidate):
                path = candidate
                break

    if not os.path.exists(path):
        return None

    # 1. mutagen — pure-python, fast.
    try:
        from mutagen import File as _MutagenFile  # type: ignore

        mf = _MutagenFile(path)
        if mf and mf.info and getattr(mf.info, "length", None):
            return float(mf.info.length)
    except Exception:
        pass

    # 2. ffprobe — last resort, requires ffmpeg on PATH.
    try:
        import subprocess

        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception:
        pass

    return None


def _whisper_cost_usd(duration_seconds: float) -> float:
    minutes = max(0.0, float(duration_seconds or 0) / 60.0)
    # Bill in whole minutes like the upstream API.
    import math
    return round(math.ceil(minutes) * _FALLBACK_PRICE_USD_PER_MINUTE, 6)


def transcribe(
    username: str,
    audio_file_path: str,
    *,
    surface: str = ai_usage.SURFACE_VOICE_SUMMARY,
    community_id: Optional[int] = None,
    enforce_override: Optional[bool] = None,
) -> Tuple[bool, Dict[str, Any]]:
    """Gate + call Whisper + log usage.

    Args:
        username: session username — required for gating and logging.
        audio_file_path: local path or HTTPS URL for the audio file.
        surface: which user surface triggered this (voice_summary, whisper, ...).
        community_id: optional, stored for pool accounting later.
        enforce_override: force enforcement on/off (useful for tests).

    Returns a 2-tuple::

        (allowed, data)

    When ``allowed`` is True, ``data`` is::

        {"text": str, "language": str, "duration_seconds": float,
         "cost_usd": float, "model": "whisper-1"}

    When ``allowed`` is False (only possible with enforcement on), ``data`` is
    the standard entitlements-error payload from :mod:`entitlements_errors`,
    plus an ``"http_status"`` key the caller can forward to Flask.
    """
    if not username:
        return False, {
            "success": False,
            "error": "Authentication required",
            "http_status": 401,
        }

    # Pre-flight duration probe so we can refuse a clip that would blow
    # past the monthly Whisper cap.
    pre_duration = _probe_duration_seconds(audio_file_path)

    allowed, reason, ent = gate_or_reason(
        username,
        surface,
        duration_seconds=pre_duration,
        enforce_override=enforce_override,
    )
    if not allowed:
        payload, status = errs.build_error(
            reason or errs.REASON_MONTHLY_WHISPER_CAP,
            ent=ent,
        )
        payload["http_status"] = status
        return False, payload

    # Lazy import — monolith loads after this module.
    try:
        from bodybuilding_app import transcribe_audio_file  # type: ignore
    except Exception as import_err:
        logger.error("whisper_service: cannot import transcribe_audio_file: %s", import_err)
        return False, {
            "success": False,
            "error": "Transcription service unavailable",
            "http_status": 503,
        }

    start = time.time()
    transcription_result = transcribe_audio_file(audio_file_path)
    elapsed_ms = int((time.time() - start) * 1000)

    if not transcription_result:
        ai_usage.log_usage(
            username,
            surface=surface,
            request_type="whisper_failed",
            success=False,
            reason_blocked="api_error",
            community_id=community_id,
            response_time_ms=elapsed_ms,
            model=WHISPER_MODEL,
        )
        return False, {
            "success": False,
            "error": "Transcription failed",
            "http_status": 502,
        }

    # transcribe_audio_file returns (text, language) on success.
    if isinstance(transcription_result, tuple):
        text, language = transcription_result
    else:
        text, language = str(transcription_result), None

    # If we couldn't probe pre-flight, estimate duration from the transcript
    # length as a last-resort (roughly 150 wpm average speech).
    final_duration = pre_duration
    if final_duration is None and text:
        words = len(text.split())
        final_duration = max(1.0, words / 2.5)  # ≈150 wpm ⇒ 2.5 wps

    cost = _whisper_cost_usd(final_duration or 0.0)

    ai_usage.log_usage(
        username,
        surface=surface,
        request_type="whisper",
        duration_seconds=final_duration,
        cost_usd=cost,
        success=True,
        response_time_ms=elapsed_ms,
        community_id=community_id,
        model=WHISPER_MODEL,
    )

    return True, {
        "text": text,
        "language": language,
        "duration_seconds": final_duration,
        "cost_usd": cost,
        "model": WHISPER_MODEL,
    }
