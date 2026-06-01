"""Resumable chat media upload HTTP routes."""

from __future__ import annotations

import logging
import os

from flask import Blueprint, jsonify, request, session

from backend.services import api_errors, chat_uploads

chat_uploads_bp = Blueprint("chat_uploads", __name__)
logger = logging.getLogger(__name__)


def _session_username() -> str | None:
    username = session.get("username")
    return str(username) if username else None


def _cron_authed() -> bool:
    expected = os.environ.get("CRON_SHARED_SECRET") or ""
    if not expected:
        return False
    return (request.headers.get("X-Cron-Secret") or "") == expected


@chat_uploads_bp.route("/api/chat/uploads/init", methods=["POST"])
def api_chat_uploads_init():
    username = _session_username()
    if not username:
        return api_errors.auth_required()
    data = request.get_json() or {}
    payload, status = chat_uploads.init_upload_session(
        username,
        context=data.get("context") or {},
        filename=(data.get("filename") or "media.bin").strip(),
        content_type=(data.get("content_type") or "").strip(),
        expected_bytes=int(data.get("expected_bytes") or 0),
        media_kind=(data.get("media_kind") or "video").strip(),
    )
    return jsonify(payload), status


@chat_uploads_bp.route("/api/chat/uploads/part-url", methods=["POST"])
def api_chat_uploads_part_url():
    username = _session_username()
    if not username:
        return api_errors.auth_required()
    data = request.get_json() or {}
    session_id = (data.get("session_id") or "").strip()
    if not session_id:
        return jsonify({"success": False, "error": "session_id required"}), 400
    try:
        part_number = int(data.get("part_number"))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "part_number required"}), 400
    payload, status = chat_uploads.presign_part_url(username, session_id, part_number)
    return jsonify(payload), status


@chat_uploads_bp.route("/api/chat/uploads/complete", methods=["POST"])
def api_chat_uploads_complete():
    username = _session_username()
    if not username:
        return api_errors.auth_required()
    data = request.get_json() or {}
    session_id = (data.get("session_id") or "").strip()
    if not session_id:
        return jsonify({"success": False, "error": "session_id required"}), 400
    parts = data.get("parts") or []
    payload, status = chat_uploads.complete_upload_session(username, session_id, parts)
    return jsonify(payload), status


@chat_uploads_bp.route("/api/chat/uploads/abort", methods=["POST"])
def api_chat_uploads_abort():
    username = _session_username()
    if not username:
        return api_errors.auth_required()
    data = request.get_json() or {}
    session_id = (data.get("session_id") or "").strip()
    if not session_id:
        return jsonify({"success": False, "error": "session_id required"}), 400
    payload, status = chat_uploads.abort_upload_session(username, session_id)
    return jsonify(payload), status


@chat_uploads_bp.route("/api/cron/chat-uploads-janitor", methods=["POST"])
def cron_chat_uploads_janitor():
    if not _cron_authed():
        return jsonify({"success": False, "error": "forbidden"}), 403
    raw_dry = (request.args.get("dry_run") or "").strip().lower()
    dry_run = raw_dry in {"1", "true", "yes", "on"}
    try:
        limit = int(request.args.get("limit") or 200)
    except ValueError:
        limit = 200
    result = chat_uploads.janitor_expired_sessions(limit=limit, dry_run=dry_run)
    return jsonify({"success": True, **result})
