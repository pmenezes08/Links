"""Guided placement API routes (Enterprise sub-community allocation)."""

from __future__ import annotations

from functools import wraps

from flask import Blueprint, jsonify, request, session

from backend.services import community_placement as placement_svc


community_placement_bp = Blueprint("community_placement", __name__)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "error": "Not logged in"}), 401
        return view_func(*args, **kwargs)

    return wrapper


def _json_response(result):
    payload, status = result
    return jsonify(payload), status


@community_placement_bp.route("/api/community/<int:community_id>/placement/config", methods=["GET", "POST"])
@_login_required
def placement_config(community_id: int):
    if request.method == "GET":
        return _json_response(placement_svc.get_config(session["username"], community_id))
    payload = request.get_json(silent=True) or {}
    return _json_response(placement_svc.save_config(session["username"], community_id, payload))


@community_placement_bp.route("/api/me/placement/pending", methods=["GET"])
@_login_required
def placement_pending():
    return _json_response(placement_svc.list_pending_for_user(session["username"]))


@community_placement_bp.route("/api/community/<int:community_id>/placement/respond", methods=["POST"])
@_login_required
def placement_respond(community_id: int):
    payload = request.get_json(silent=True) or {}
    return _json_response(
        placement_svc.respond(session["username"], community_id, payload.get("answers") or {})
    )
