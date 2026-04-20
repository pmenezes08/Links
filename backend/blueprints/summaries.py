"""Post / voice summary endpoints (gated, logged, bounded).

Wave-4 scaffolding. The legacy summary endpoints still live in
:mod:`bodybuilding_app` and are gated inline; over time they migrate here.

Currently exposes:

* ``POST /api/summaries/voice/preflight`` — checks the caller's Whisper
  allowance before the client uploads a long audio file, so we don't burn
  bandwidth for a call that will be rejected.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request, session

from backend.services import ai_usage
from backend.services.entitlements import resolve_entitlements
from backend.services.feature_flags import entitlements_enforcement_enabled


summaries_bp = Blueprint("summaries", __name__)
logger = logging.getLogger(__name__)


@summaries_bp.route("/api/summaries/voice/preflight", methods=["POST"])
def voice_summary_preflight():
    """Return whether the user can spend ``duration_seconds`` of Whisper right now.

    Body: ``{"duration_seconds": 42.3}`` (optional). Returns remaining minutes
    plus a boolean ``can_transcribe`` that accounts for both the monthly
    Whisper cap and the daily Steve cap.
    """
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    body = request.get_json(silent=True) or {}
    try:
        duration = float(body.get("duration_seconds") or 0)
    except Exception:
        duration = 0.0

    try:
        ent = resolve_entitlements(username)
    except Exception as err:
        logger.exception("voice_summary_preflight resolve failed: %s", err)
        return jsonify({"success": False, "error": "Could not resolve entitlements"}), 500

    whisper_cap = ent.get("whisper_minutes_per_month")
    used_minutes = ai_usage.whisper_minutes_this_month(username)
    need_minutes = duration / 60.0

    if whisper_cap is None:
        remaining = None
        fits = True
    else:
        try:
            remaining = max(0.0, float(whisper_cap) - used_minutes)
            fits = (remaining >= need_minutes) if need_minutes > 0 else (remaining > 0 or whisper_cap == 0)
        except Exception:
            remaining = None
            fits = True

    return jsonify({
        "success": True,
        "can_transcribe": bool(ent.get("can_use_steve")) and fits,
        "tier": ent.get("tier"),
        "whisper_minutes_used": round(used_minutes, 2),
        "whisper_minutes_cap": whisper_cap,
        "whisper_minutes_remaining": None if remaining is None else round(remaining, 2),
        "needs_minutes": round(need_minutes, 2),
        "enforcement_enabled": entitlements_enforcement_enabled(),
    })
