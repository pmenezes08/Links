"""Steve feedback queue APIs."""

from __future__ import annotations

from functools import wraps

from flask import Blueprint, jsonify, request, session

from backend.services.content_generation.permissions import is_app_admin
from backend.services import steve_feedback

steve_feedback_bp = Blueprint("steve_feedback", __name__)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        return view_func(*args, **kwargs)

    return wrapper


def _admin_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        username = session.get("username")
        if not username:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        if not is_app_admin(username):
            return jsonify({"success": False, "error": "Admin access required"}), 403
        return view_func(*args, **kwargs)

    return wrapper


def _json():
    return request.get_json(silent=True) or {}


@steve_feedback_bp.route("/api/steve/feedback", methods=["POST"])
@_login_required
def create_steve_feedback():
    data = _json()
    raw = str(data.get("raw_user_message") or data.get("message") or "").strip()
    if not raw:
        return jsonify({"success": False, "error": "message required"}), 400
    try:
        item = steve_feedback.create_feedback_item(
            submitted_by=session.get("username") or "unknown",
            raw_user_message=raw,
            steve_summary=str(data.get("steve_summary") or data.get("summary") or "").strip() or None,
            feedback_type=str(data.get("type") or "").strip() or None,
            severity=str(data.get("severity") or "").strip() or None,
            surface=str(data.get("surface") or "steve_dm").strip() or "steve_dm",
            community_id=data.get("community_id"),
            device_info=str(data.get("device_info") or "").strip() or None,
            app_version=str(data.get("app_version") or "").strip() or None,
            media_url=str(data.get("media_url") or "").strip() or None,
            duplicate_of=data.get("duplicate_of"),
        )
        return jsonify({"success": True, "item": item})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@steve_feedback_bp.route("/api/admin/steve_feedback", methods=["GET"])
@_admin_required
def admin_list_steve_feedback():
    try:
        filters = {
            "status": request.args.get("status") or "",
            "type": request.args.get("type") or "",
            "severity": request.args.get("severity") or "",
            "submitted_by": request.args.get("submitted_by") or "",
        }
        limit = int(request.args.get("limit") or 100)
        items = steve_feedback.list_feedback_items(filters, limit=limit)
        return jsonify({"success": True, "items": items})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@steve_feedback_bp.route("/api/admin/steve_feedback/<int:feedback_id>", methods=["GET"])
@_admin_required
def admin_get_steve_feedback(feedback_id: int):
    try:
        item = steve_feedback.get_feedback_item(feedback_id)
        if not item:
            return jsonify({"success": False, "error": "not_found"}), 404
        events = steve_feedback.list_feedback_events(feedback_id)
        return jsonify({"success": True, "item": item, "events": events})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@steve_feedback_bp.route("/api/admin/steve_feedback/<int:feedback_id>", methods=["PATCH"])
@_admin_required
def admin_update_steve_feedback(feedback_id: int):
    data = _json()
    try:
        item = steve_feedback.update_feedback_item_status(
            feedback_id=feedback_id,
            status=str(data.get("status") or "new").strip(),
            severity=str(data.get("severity") or "").strip() or None,
            duplicate_of=data.get("duplicate_of"),
            note=str(data.get("note") or "").strip(),
            actor_username=session.get("username") or "admin",
        )
        return jsonify({"success": True, "item": item})
    except KeyError:
        return jsonify({"success": False, "error": "not_found"}), 404
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@steve_feedback_bp.route("/api/admin/steve_feedback/<int:feedback_id>/notes", methods=["POST"])
@_admin_required
def admin_add_steve_feedback_note(feedback_id: int):
    data = _json()
    try:
        item = steve_feedback.add_admin_note(
            feedback_id=feedback_id,
            actor_username=session.get("username") or "admin",
            note=str(data.get("note") or "").strip(),
        )
        return jsonify({"success": True, "item": item})
    except KeyError:
        return jsonify({"success": False, "error": "not_found"}), 404
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@steve_feedback_bp.route("/api/admin/steve_feedback/<int:feedback_id>/closure_receipt", methods=["POST"])
@_admin_required
def admin_send_steve_feedback_closure_receipt(feedback_id: int):
    data = _json()
    try:
        result = steve_feedback.send_closure_receipt(
            feedback_id=feedback_id,
            actor_username=session.get("username") or "admin",
            message=str(data.get("message") or "").strip() or None,
        )
        return jsonify({"success": True, **result})
    except KeyError:
        return jsonify({"success": False, "error": "not_found"}), 404
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500
