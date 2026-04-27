"""Media asset accounting and cleanup routes."""

from __future__ import annotations

import logging
import os
from datetime import datetime

from flask import Blueprint, jsonify, request, session

from backend.services import media_assets
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.r2_storage import (
    R2_ENABLED,
    R2_PUBLIC_URL,
    generate_presigned_upload_url,
    get_content_type,
)


media_assets_bp = Blueprint("media_assets", __name__)
logger = logging.getLogger(__name__)


def _cron_authed() -> bool:
    expected = os.environ.get("CRON_SHARED_SECRET") or ""
    if not expected:
        return False
    provided = request.headers.get("X-Cron-Secret") or ""
    return provided == expected


def _session_username():
    username = session.get("username")
    return str(username) if username else None


def _video_upload_payload(prefix: str, filename: str, content_type: str):
    if not R2_ENABLED or not R2_PUBLIC_URL:
        return jsonify({"success": False, "error": "Direct upload not available"}), 503
    if not content_type.startswith("video/"):
        return jsonify({"success": False, "error": "Invalid video type"}), 400
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "mp4"
    if ext not in ("mp4", "webm", "mov", "m4v", "avi"):
        ext = "mp4"
    name = (filename.rsplit(".", 1)[0] if "." in filename else "video")[:50]
    key = f"{prefix}/{name}_{ts}.{ext}"
    upload_url = generate_presigned_upload_url(key, content_type)
    if not upload_url:
        return jsonify({"success": False, "error": "Failed to generate upload URL"}), 500
    public_url = f"{R2_PUBLIC_URL.rstrip('/')}/{key}"
    return jsonify({"success": True, "upload_url": upload_url, "key": key, "public_url": public_url})


@media_assets_bp.route("/api/video_upload_url", methods=["POST"])
def api_video_upload_url():
    """Get a presigned URL for direct DM video upload to R2."""
    if not _session_username():
        return jsonify({"success": False, "error": "Authentication required"}), 401
    data = request.get_json() or {}
    recipient_id = data.get("recipient_id")
    filename = (data.get("filename") or "video.mp4").strip()
    content_type = (data.get("content_type") or get_content_type(filename)).strip()
    if not recipient_id:
        return jsonify({"success": False, "error": "recipient_id required"}), 400
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ph = get_sql_placeholder()
            cursor.execute(f"SELECT username FROM users WHERE id = {ph}", (recipient_id,))
            if not cursor.fetchone():
                return jsonify({"success": False, "error": "Recipient not found"}), 404
    except Exception as exc:
        logger.error("video_upload_url recipient check: %s", exc)
        return jsonify({"success": False, "error": "Server error"}), 500
    return _video_upload_payload("message_videos", filename, content_type)


@media_assets_bp.route("/api/post_video_upload_url", methods=["POST"])
def api_post_video_upload_url():
    """Get a presigned URL for direct community/group post video upload to R2."""
    if not _session_username():
        return jsonify({"success": False, "error": "Authentication required"}), 401
    data = request.get_json() or {}
    filename = (data.get("filename") or "video.mp4").strip()
    content_type = (data.get("content_type") or get_content_type(filename)).strip()
    return _video_upload_payload("post_videos", filename, content_type)


@media_assets_bp.route("/api/cron/media/purge-retained-stories", methods=["POST"])
def cron_purge_retained_story_media():
    """Purge expired story media after its retention window."""
    if not _cron_authed():
        return jsonify({"success": False, "error": "forbidden"}), 403

    raw_dry_run = (request.args.get("dry_run") or "").strip().lower()
    dry_run = raw_dry_run in {"1", "true", "yes", "on"}
    try:
        limit = int(request.args.get("limit") or 200)
    except ValueError:
        limit = 200

    try:
        result = media_assets.purge_retained_story_media(dry_run=dry_run, limit=limit)
        return jsonify({"success": True, **result})
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("retained story media purge failed: %s", exc)
        return jsonify({"success": False, "error": "purge_failed"}), 500

