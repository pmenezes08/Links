"""Admin-managed branding assets for public onboarding surfaces."""

from __future__ import annotations

import logging
from functools import wraps

from flask import Blueprint, jsonify, request, session

from backend.services import auth_session, branding_assets, session_identity
from backend.services.community import is_app_admin
from backend.services.media import save_uploaded_file


branding_assets_bp = Blueprint("branding_assets", __name__)
logger = logging.getLogger(__name__)


@branding_assets_bp.after_request
def _no_store_branding_asset_json(response):
    return auth_session.no_store(response)


def _admin_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        username = session_identity.valid_session_username(session)
        if not username:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        if not is_app_admin(username):
            return jsonify({"success": False, "error": "Admin access required"}), 403
        return view_func(*args, **kwargs)

    return wrapper


@branding_assets_bp.route("/admin/get_onboarding_welcome_video", methods=["GET"])
@_admin_required
def admin_get_onboarding_welcome_video():
    return jsonify(
        {
            "success": True,
            "video_url": branding_assets.get_onboarding_welcome_video_url(),
        }
    )


@branding_assets_bp.route("/admin/upload_onboarding_welcome_video", methods=["POST"])
@_admin_required
def admin_upload_onboarding_welcome_video():
    uploaded = request.files.get("video")
    if not uploaded or not uploaded.filename:
        return jsonify({"success": False, "error": "No file selected"}), 400

    validation_error = branding_assets.validate_onboarding_video_file(uploaded)
    if validation_error:
        return jsonify({"success": False, "error": validation_error}), 400

    try:
        saved_path = save_uploaded_file(
            uploaded,
            subfolder="branding",
            allowed_extensions=branding_assets.ALLOWED_ONBOARDING_VIDEO_EXTENSIONS,
        )
        if not saved_path:
            return jsonify({"success": False, "error": "Failed to upload video"}), 500
        branding_assets.set_setting(branding_assets.ONBOARDING_WELCOME_VIDEO_KEY, saved_path)
        return jsonify(
            {
                "success": True,
                "video_url": branding_assets.resolve_public_asset_url(saved_path),
            }
        )
    except Exception as exc:
        logger.exception("admin_upload_onboarding_welcome_video failed: %s", exc)
        return jsonify({"success": False, "error": "Server error"}), 500


@branding_assets_bp.route("/admin/remove_onboarding_welcome_video", methods=["POST"])
@_admin_required
def admin_remove_onboarding_welcome_video():
    try:
        branding_assets.delete_setting(branding_assets.ONBOARDING_WELCOME_VIDEO_KEY)
        return jsonify({"success": True, "message": "Onboarding welcome video removed"})
    except Exception as exc:
        logger.exception("admin_remove_onboarding_welcome_video failed: %s", exc)
        return jsonify({"success": False, "error": "Server error"}), 500


@branding_assets_bp.route("/api/public/onboarding_welcome_video", methods=["GET"])
def api_public_onboarding_welcome_video():
    return jsonify(
        {
            "success": True,
            "video_url": branding_assets.get_onboarding_welcome_video_url(),
        }
    )
