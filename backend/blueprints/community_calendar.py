"""Calendar and event API routes."""

from __future__ import annotations

from functools import wraps

from flask import Blueprint, current_app, jsonify, redirect, request, session, url_for

from backend.services import community_calendar as calendar_svc


community_calendar_bp = Blueprint("community_calendar", __name__)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return redirect(url_for("auth.login"))
        return view_func(*args, **kwargs)

    return wrapper


def _json(payload, status: int = 200):
    return jsonify(payload), status


def _error_response(exc: Exception):
    if isinstance(exc, calendar_svc.CalendarError):
        return _json({"success": False, "message": exc.message, "error": exc.message}, exc.status)
    current_app.logger.exception("calendar API error: %s", exc)
    return _json({"success": False, "message": "Server error", "error": "Server error"}, 500)


def _event_input() -> calendar_svc.EventInput:
    start_time = (request.form.get("start_time") or request.form.get("time") or "").strip() or None
    return calendar_svc.EventInput(
        title=(request.form.get("title") or "").strip(),
        date=(request.form.get("date") or "").strip(),
        end_date=(request.form.get("end_date") or "").strip() or None,
        start_time=start_time,
        end_time=(request.form.get("end_time") or "").strip() or None,
        timezone=(request.form.get("timezone") or "").strip() or None,
        description=(request.form.get("description") or "").strip() or None,
        notification_preferences=(request.form.get("notification_preferences") or "all").strip() or "all",
        community_id=request.form.get("community_id", type=int),
        group_id=request.form.get("group_id", type=int),
        invite_all=(request.form.get("invite_all") or "").strip().lower() == "true",
        invited_members=request.form.getlist("invited_members[]"),
    )


@community_calendar_bp.route("/get_calendar_events")
@_login_required
def get_calendar_events():
    try:
        return _json({"success": True, "events": calendar_svc.list_visible_events(session.get("username"))})
    except Exception as exc:
        return _error_response(exc)


@community_calendar_bp.route("/api/all_calendar_events")
@_login_required
def api_all_calendar_events():
    try:
        return _json({"success": True, "events": calendar_svc.list_all_member_events(session["username"])})
    except Exception as exc:
        return _error_response(exc)


@community_calendar_bp.route("/api/group_calendar/<int:group_id>")
@_login_required
def api_group_calendar(group_id: int):
    try:
        return _json({"success": True, "events": calendar_svc.list_group_events(session.get("username"), group_id)})
    except Exception as exc:
        return _error_response(exc)


@community_calendar_bp.route("/api/calendar_events/<int:event_id>")
@_login_required
def api_get_calendar_event(event_id: int):
    try:
        return _json({"success": True, "event": calendar_svc.get_event(event_id, session.get("username"))})
    except Exception as exc:
        return _error_response(exc)


@community_calendar_bp.route("/get_calendar_event/<int:event_id>")
@_login_required
def get_calendar_event(event_id: int):
    try:
        return _json({"success": True, "event": calendar_svc.get_event(event_id, session.get("username"))})
    except Exception as exc:
        return _error_response(exc)


@community_calendar_bp.route("/add_calendar_event", methods=["POST"])
@_login_required
def add_calendar_event():
    try:
        result = calendar_svc.create_event(session["username"], _event_input())
        return _json({
            "success": True,
            "message": f"Event added successfully. {result['invited_count']} members invited.",
            "event_id": result["event_id"],
        })
    except Exception as exc:
        return _error_response(exc)


@community_calendar_bp.route("/edit_calendar_event", methods=["POST"])
@_login_required
def edit_calendar_event():
    try:
        event_id = request.form.get("event_id", type=int)
        if not event_id:
            raise calendar_svc.CalendarError("Event ID is required")
        calendar_svc.update_event(session["username"], event_id, _event_input())
        return _json({"success": True, "message": "Event updated successfully"})
    except Exception as exc:
        return _error_response(exc)


@community_calendar_bp.route("/delete_calendar_event", methods=["POST"])
@_login_required
def delete_calendar_event():
    try:
        event_id = request.form.get("event_id", type=int)
        if not event_id:
            raise calendar_svc.CalendarError("Event ID is required")
        calendar_svc.delete_event(session["username"], event_id)
        return _json({"success": True, "message": "Event deleted successfully"})
    except Exception as exc:
        return _error_response(exc)


@community_calendar_bp.route("/event/<int:event_id>/rsvp", methods=["POST"])
@_login_required
def rsvp_event(event_id: int):
    try:
        data = request.get_json(silent=True) or {}
        response = (request.form.get("response") or data.get("response") or "").strip()
        note = (request.form.get("note") or data.get("note") or "").strip()
        result = calendar_svc.rsvp_event(session["username"], event_id, response, note)
        return _json({"success": True, **result})
    except Exception as exc:
        return _error_response(exc)


@community_calendar_bp.route("/event/<int:event_id>/rsvp", methods=["DELETE"])
@_login_required
def cancel_rsvp(event_id: int):
    try:
        result = calendar_svc.cancel_rsvp(session["username"], event_id)
        return _json({"success": True, "message": "RSVP cancelled", **result})
    except Exception as exc:
        return _error_response(exc)


@community_calendar_bp.route("/event/<int:event_id>/rsvps")
@_login_required
def get_event_rsvps(event_id: int):
    try:
        event = calendar_svc.get_event(event_id, session.get("username"))
        details = calendar_svc.rsvp_details(event_id)
        rsvps = []
        for response in ("going", "maybe", "not_going"):
            rsvps.extend({**attendee, "response": response} for attendee in details["attendees"][response])
        return _json({
            "success": True,
            "event": event,
            "rsvps": rsvps,
            "counts": event.get("rsvp_counts", {}),
            "user_rsvp": event.get("user_rsvp"),
        })
    except Exception as exc:
        return _error_response(exc)


@community_calendar_bp.route("/get_event_rsvp_details")
@_login_required
def get_event_rsvp_details():
    try:
        event_id = request.args.get("event_id", type=int)
        if not event_id:
            raise calendar_svc.CalendarError("Event ID required")
        details = calendar_svc.rsvp_details(event_id)
        return _json({"success": True, **details})
    except Exception as exc:
        return _error_response(exc)
