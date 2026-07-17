"""Retention attribution event sink (thin route — logic in the service)."""

from __future__ import annotations

from functools import wraps

from flask import Blueprint, jsonify, request, session

from backend.services import retention_events

retention_events_bp = Blueprint("retention_events", __name__)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        return view_func(*args, **kwargs)

    return wrapper


@retention_events_bp.route("/api/retention/event", methods=["POST"])
@_login_required
def create_retention_event():
    data = request.get_json(silent=True) or {}
    event_type = str(data.get("event_type") or "").strip().lower()
    if event_type in retention_events.SERVER_ONLY_EVENT_TYPES:
        # Activation events are emitted server-side only — the client sink
        # must not let a browser inflate the founder's funnel numbers.
        return jsonify({"success": True, "recorded": False})
    recorded = retention_events.record_event(
        session.get("username") or "",
        event_type=str(data.get("event_type") or ""),
        source=data.get("source"),
        community_id=data.get("community_id"),
        group_id=data.get("group_id"),
        detail=data.get("detail"),
    )
    # Always 200 on a well-formed request: attribution is best-effort and the
    # client fires-and-forgets. `recorded` tells tests whether it was accepted.
    return jsonify({"success": True, "recorded": bool(recorded)})
