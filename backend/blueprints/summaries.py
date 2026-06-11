"""Post / voice summary endpoints (gated, logged, bounded).

Wave-4 scaffolding. Remaining legacy summary endpoints still live in
:mod:`bodybuilding_app` and are gated inline; over time they migrate here.

Currently exposes:

* ``POST /api/summaries/voice/preflight`` — checks the caller's Whisper
  allowance before the client uploads a long audio file, so we don't burn
  bandwidth for a call that will be rejected.
* ``GET /api/post/<post_id>/summary`` — Steve summary of a post + its
  replies (moved out of the monolith; authz/gate/logging live in
  :mod:`backend.services.post_summary`).
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request, session

from backend.services import ai_usage, api_errors
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
        return api_errors.auth_required()

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


@summaries_bp.route("/api/post/<int:post_id>/summary", methods=["GET"])
def post_summary(post_id: int):
    """Steve summary of a post and its discussion (member-only, gated, logged)."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    from backend.services.post_summary import generate_post_summary

    body, status = generate_post_summary(username, post_id)
    return jsonify(body), status


@summaries_bp.route("/api/post_summary/config", methods=["GET"])
def post_summary_config():
    """Affordance thresholds for the feed glyph — KB-driven, never hardcoded
    client-side. The client shows the inline Steve glyph only on posts that
    clear these bars; sub-threshold posts keep the ⋯ menu entry."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    from backend.services.post_summary import get_post_summary_config

    config = get_post_summary_config()
    return jsonify({
        "success": True,
        "enabled": config.enabled,
        "min_replies": config.min_replies_for_affordance,
        "min_thread_chars": config.min_thread_chars_for_affordance,
    })
