"""Authenticated platform activity digest (communities + group chats — no private DMs)."""

from __future__ import annotations

import logging
from functools import wraps

from flask import Blueprint, jsonify, request, session

from backend.services import ai_usage
from backend.services.entitlements_gate import gate_or_reason
from backend.services.feature_flags import entitlements_enforcement_enabled
from backend.services.platform_activity_digest import (
    VALID_WINDOW_HOURS,
    build_platform_activity_digest,
    coerce_window_hours,
)

logger = logging.getLogger(__name__)

platform_activity_bp = Blueprint("platform_activity", __name__)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "error": "unauthenticated"}), 401
        return view_func(*args, **kwargs)

    return wrapper


@platform_activity_bp.route("/api/me/platform-activity-digest", methods=["GET"])
@_login_required
def api_platform_activity_digest():
    """Return aggregated community + group chat activity JSON for narrations or dashboards."""
    username = session.get("username")
    allowed, reason, _ent = gate_or_reason(username, ai_usage.SURFACE_DM)
    if not allowed and entitlements_enforcement_enabled():
        return jsonify({"success": False, "error": reason or "forbidden"}), 403

    raw_hours = request.args.get("window_hours", default=24, type=int)
    wh = coerce_window_hours(raw_hours) or 24

    try:
        data = build_platform_activity_digest(username, wh)
        return jsonify({"success": True, "digest": data, "allowed_window_hours": sorted(VALID_WINDOW_HOURS)})
    except Exception as e:
        logger.exception("platform-activity-digest failed: %s", e)
        return jsonify({"success": False, "error": "server_error"}), 500
