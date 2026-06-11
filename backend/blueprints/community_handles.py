"""Community handle settings — the manage-community "@address" card.

Owner/admin endpoints only in this phase (lookup + join requests arrive
with the find flow). Thin routes; logic lives in
:mod:`backend.services.community_handles`.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request, session

from backend.services import api_errors

community_handles_bp = Blueprint("community_handles", __name__)
logger = logging.getLogger(__name__)


@community_handles_bp.route("/api/community/<int:community_id>/handle_settings", methods=["GET"])
def handle_settings_get(community_id: int):
    """Current handle, findability, and change-cooldown state (manage-gated)."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    from backend.services.community_handles import get_handle_settings

    body, status = get_handle_settings(username, community_id)
    return jsonify(body), status


@community_handles_bp.route("/api/community/<int:community_id>/handle_settings", methods=["POST"])
def handle_settings_post(community_id: int):
    """Update handle and/or findability. Body: {handle?, discoverable?}."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    data = request.get_json(silent=True) or {}
    if "handle" not in data and "discoverable" not in data:
        return jsonify({"success": False, "error": "Nothing to update"}), 400

    from backend.services.community_handles import update_handle_settings

    body, status = update_handle_settings(
        username,
        community_id,
        handle=data.get("handle") if "handle" in data else None,
        discoverable=data.get("discoverable") if "discoverable" in data else None,
    )
    return jsonify(body), status


@community_handles_bp.route("/api/community/by_handle/<handle>", methods=["GET"])
def lookup_by_handle(handle: str):
    """Exact-match lookup of a findable community. Non-enumerating: a
    missing handle and a non-findable community return the same closed
    door. Rate-limited per user."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    from backend.services.community_join_requests import lookup_by_handle as _lookup

    body, status = _lookup(username, handle)
    return jsonify(body), status


@community_handles_bp.route("/api/community/<int:community_id>/join_requests", methods=["POST"])
def join_request_create(community_id: int):
    """Ask to join a findable community (knock on the door)."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    from backend.services.community_join_requests import create_request

    body, status = create_request(username, community_id)
    return jsonify(body), status


@community_handles_bp.route("/api/community/<int:community_id>/join_requests/mine", methods=["DELETE"])
def join_request_withdraw(community_id: int):
    """Withdraw your own pending request."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    from backend.services.community_join_requests import withdraw_request

    body, status = withdraw_request(username, community_id)
    return jsonify(body), status


@community_handles_bp.route("/api/community/join_requests/pending", methods=["GET"])
def join_requests_pending():
    """All pending requests across communities the caller manages
    (the Notifications inbox feed)."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    from backend.services.community_join_requests import list_pending_for_manager

    body, status = list_pending_for_manager(username)
    return jsonify(body), status


@community_handles_bp.route("/api/community/<int:community_id>/join_requests/count", methods=["GET"])
def join_requests_count(community_id: int):
    """Pending count + avatar stack for the feed admin row (manage-gated)."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    from backend.services.community_join_requests import pending_count_for_community

    body, status = pending_count_for_community(username, community_id)
    return jsonify(body), status


@community_handles_bp.route("/api/community/<int:community_id>/join_requests/decide", methods=["POST"])
def join_request_decide(community_id: int):
    """Accept or decline a request. Body: {username, action: accept|reject}.
    Decline is silent for the requester (no notification, ever)."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    data = request.get_json(silent=True) or {}
    requester = (data.get("username") or "").strip()
    action = (data.get("action") or "").strip()
    if not requester or action not in ("accept", "reject"):
        return jsonify({"success": False, "error": "username and action required"}), 400

    from backend.services.community_join_requests import decide_request

    body, status = decide_request(username, community_id, requester, action)
    return jsonify(body), status


@community_handles_bp.route("/api/community/handle_check", methods=["GET"])
def handle_check():
    """Availability check for the live field validation (?handle=x).

    Returns taken/free only — standard username-checker semantics; it
    never reveals which community holds a handle or whether that
    community is findable.
    """
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    from backend.services.community_handles import is_handle_available, is_valid_handle

    raw = (request.args.get("handle") or "").strip().lstrip("@").lower()
    if not is_valid_handle(raw):
        return jsonify({"success": True, "handle": raw, "valid": False, "available": False})
    return jsonify({"success": True, "handle": raw, "valid": True, "available": is_handle_available(raw)})
