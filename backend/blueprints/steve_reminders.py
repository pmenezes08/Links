"""User-facing Steve Reminder Vault API (list + update)."""

from __future__ import annotations

import logging
from functools import wraps

from flask import Blueprint, jsonify, request, session

from backend.services import ai_usage
from backend.services.entitlements_gate import gate_or_reason
from backend.services.feature_flags import entitlements_enforcement_enabled
from backend.services.steve_reminder_vault import list_reminders_for_user, update_reminder_for_user

logger = logging.getLogger(__name__)

steve_reminders_bp = Blueprint("steve_reminders", __name__)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "error": "unauthenticated"}), 401
        return view_func(*args, **kwargs)

    return wrapper


@steve_reminders_bp.route("/api/me/steve/reminders", methods=["GET"])
@_login_required
def api_list_reminders():
    username = session.get("username")
    allowed, reason, _ent = gate_or_reason(username, ai_usage.SURFACE_DM)
    if not allowed and entitlements_enforcement_enabled():
        return jsonify({"success": False, "error": reason or "forbidden"}), 403
    try:
        data = list_reminders_for_user(username)
        return jsonify({"success": True, **data})
    except Exception as e:
        logger.exception("list reminders: %s", e)
        return jsonify({"success": False, "error": "server_error"}), 500


@steve_reminders_bp.route("/api/me/steve/reminders/<int:rid>", methods=["PATCH"])
@_login_required
def api_patch_reminder(rid: int):
    username = session.get("username")
    allowed, reason, _ent = gate_or_reason(username, ai_usage.SURFACE_DM)
    if not allowed and entitlements_enforcement_enabled():
        return jsonify({"success": False, "error": reason or "forbidden"}), 403

    payload = request.get_json(silent=True) or {}
    has_txt = "reminder_text" in payload
    has_fire = "fire_at_utc" in payload
    reminder_text = payload.get("reminder_text") if has_txt else None
    fire_at_utc = payload.get("fire_at_utc") if has_fire else None

    ok, detail = update_reminder_for_user(
        username=username,
        reminder_id=rid,
        reminder_text=reminder_text,
        fire_at_utc_iso=fire_at_utc,
    )
    try:
        if ok:
            ai_usage.log_usage(
                username,
                surface=ai_usage.SURFACE_DM,
                request_type="steve_reminder_vault_edit",
                model="n/a",
            )
    except Exception:
        pass

    status = 200 if ok else 400
    return jsonify({"success": ok, "message": detail}), status

