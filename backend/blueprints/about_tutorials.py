"""Public About-page tutorial metadata + app-admin video URL management."""

from __future__ import annotations

import logging
import re
from datetime import datetime

from flask import Blueprint, jsonify, request, session

from backend.services import about_tutorials as about_tut
from backend.services.community import is_app_admin
from backend.services.r2_storage import R2_ENABLED, R2_PUBLIC_URL, generate_presigned_upload_url, get_content_type

logger = logging.getLogger(__name__)

about_tutorials_bp = Blueprint("about_tutorials", __name__)


def _session_username() -> str | None:
    u = session.get("username")
    return str(u) if u else None


def _validate_https_url(url: str) -> bool:
    s = (url or "").strip()
    if not s.startswith("https://"):
        return False
    if len(s) > 2048:
        return False
    if re.search(r"[\s<>\"']", s):
        return False
    return True


@about_tutorials_bp.route("/api/about/tutorial_videos", methods=["GET"])
def get_tutorial_videos():
    """Public map of slot_id -> public video URL (null if unset)."""
    try:
        about_tut.ensure_tables()
        videos = about_tut.list_urls_for_slots()
        return jsonify({"success": True, "videos": videos})
    except Exception as exc:
        logger.exception("get_tutorial_videos: %s", exc)
        return jsonify({"success": False, "error": "server_error"}), 500


@about_tutorials_bp.route("/api/admin/about/tutorial_video", methods=["POST"])
def admin_set_tutorial_video():
    """App admin: set or replace public URL for a tutorial slot."""
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Forbidden"}), 403

    data = request.get_json() or {}
    slot_id = str(data.get("slot_id") or "").strip()
    public_url = str(data.get("public_url") or "").strip()

    if slot_id not in about_tut.ALLOWED_SLOTS:
        return jsonify({"success": False, "error": "invalid_slot"}), 400
    if not _validate_https_url(public_url):
        return jsonify({"success": False, "error": "invalid_url"}), 400

    if not about_tut.set_slot_url(slot_id, public_url):
        return jsonify({"success": False, "error": "save_failed"}), 500
    return jsonify({"success": True, "slot_id": slot_id, "public_url": public_url})


def _admin_video_presign_response(filename: str, content_type: str):
    if not R2_ENABLED or not R2_PUBLIC_URL:
        return jsonify({"success": False, "error": "Direct upload not available"}), 503
    if not content_type.startswith("video/"):
        return jsonify({"success": False, "error": "Invalid video type"}), 400
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "mp4"
    if ext not in ("mp4", "webm", "mov", "m4v", "avi"):
        ext = "mp4"
    name = (filename.rsplit(".", 1)[0] if "." in filename else "tutorial")[:50]
    key = f"about_tutorials/{name}_{ts}.{ext}"
    upload_url = generate_presigned_upload_url(key, content_type)
    if not upload_url:
        return jsonify({"success": False, "error": "Failed to generate upload URL"}), 500
    public_url = f"{R2_PUBLIC_URL.rstrip('/')}/{key}"
    return jsonify({"success": True, "upload_url": upload_url, "key": key, "public_url": public_url})


@about_tutorials_bp.route("/api/admin/about/tutorial_upload_url", methods=["POST"])
def admin_tutorial_upload_url():
    """App admin: presigned PUT URL for About tutorial video (R2)."""
    username = _session_username()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Forbidden"}), 403

    data = request.get_json() or {}
    filename = (data.get("filename") or "tutorial.mp4").strip()
    content_type = (data.get("content_type") or get_content_type(filename)).strip()
    return _admin_video_presign_response(filename, content_type)
