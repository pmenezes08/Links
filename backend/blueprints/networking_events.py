"""Networking attribution event sink (thin route — logic in the service)."""

from __future__ import annotations

from functools import wraps

from flask import Blueprint, jsonify, request, session

from backend.services import networking_events

networking_events_bp = Blueprint("networking_events", __name__)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        return view_func(*args, **kwargs)

    return wrapper


@networking_events_bp.route("/api/networking/event", methods=["POST"])
@_login_required
def create_networking_event():
    data = request.get_json(silent=True) or {}
    recorded = networking_events.record_event(
        session.get("username") or "",
        event_type=str(data.get("event_type") or ""),
        source=data.get("source"),
        community_id=data.get("community_id"),
        target_username=data.get("target_username"),
    )
    # Always 200 on a well-formed request: attribution is best-effort and the
    # client fires-and-forgets. `recorded` tells tests whether it was accepted.
    return jsonify({"success": True, "recorded": bool(recorded)})
