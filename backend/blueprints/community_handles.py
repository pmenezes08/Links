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
