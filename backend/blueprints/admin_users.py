"""Admin user-management endpoints that go beyond basic CRUD.

The legacy ``/api/admin/users`` (list) and ``/api/admin/update_user``
(subscription change) endpoints live in the monolith. This blueprint adds
the pieces Wave 2 needs:

    POST   /api/admin/users/<username>/special/grant
    POST   /api/admin/users/<username>/special/revoke
    GET    /api/admin/users/<username>/manage

Grant/revoke write through :mod:`backend.services.special_access` so they go
through the same audit path as the Special Users KB page.

``/manage`` powers the right-hand drawer in the admin Users tab: it returns
the user's resolved entitlements, current period usage, and a tiny
subscription/seat summary in one call.
"""

from __future__ import annotations

import logging
from functools import wraps
from typing import Any, Dict

from flask import Blueprint, jsonify, request, session

from backend.services import ai_usage, special_access
from backend.services.account_deletion import AccountDeletionMode, delete_user_in_connection
from backend.services.content_generation.permissions import is_app_admin
from backend.services.database import get_db_connection
from backend.services.entitlements import resolve_entitlements


admin_users_bp = Blueprint("admin_users", __name__)
logger = logging.getLogger(__name__)


def _admin_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        if not is_app_admin(session.get("username")):
            return jsonify({"success": False, "error": "Admin access required"}), 403
        return view_func(*args, **kwargs)
    return wrapper


def _body_json() -> Dict[str, Any]:
    return request.get_json(silent=True) or {}


@admin_users_bp.route(
    "/api/admin/users/<string:target_username>/special/grant", methods=["POST"]
)
@_admin_required
def grant_special(target_username: str):
    """Flip ``users.is_special = 1`` and write an audit row."""
    data = _body_json()
    reason = str(data.get("reason") or "").strip()
    if not reason:
        return jsonify({"success": False, "error": "Reason is required"}), 400
    actor = session.get("username") or "unknown"
    try:
        special_access.ensure_tables()
        special_access.grant(
            target_username,
            actor_username=actor,
            reason=reason,
            source="admin-ui",
        )
        return jsonify({"success": True, "username": target_username, "is_special": True})
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        logger.exception("grant_special failed")
        return jsonify({"success": False, "error": str(e)}), 500


@admin_users_bp.route(
    "/api/admin/users/<string:target_username>/special/revoke", methods=["POST"]
)
@_admin_required
def revoke_special(target_username: str):
    """Flip ``users.is_special = 0`` and write an audit row."""
    data = _body_json()
    reason = str(data.get("reason") or "").strip()
    if not reason:
        return jsonify({"success": False, "error": "Reason is required"}), 400
    actor = session.get("username") or "unknown"
    try:
        special_access.ensure_tables()
        special_access.revoke(
            target_username,
            actor_username=actor,
            reason=reason,
            source="admin-ui",
        )
        return jsonify({"success": True, "username": target_username, "is_special": False})
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        logger.exception("revoke_special failed")
        return jsonify({"success": False, "error": str(e)}), 500


@admin_users_bp.route("/api/admin/users/<string:target_username>/manage", methods=["GET"])
@_admin_required
def manage_user(target_username: str):
    """Power the Users tab drawer: entitlements + usage + seat summary.

    Returns a single payload the admin-web can render without chaining calls:

    .. code-block:: json

        {
          "success": true,
          "username": "paulo",
          "entitlements": { ...resolve_entitlements(...) },
          "usage": {
            "steve_month": 42,
            "steve_month_cap": 100,
            "whisper_minutes_month": 7.4,
            "whisper_minutes_month_cap": 100,
            "steve_today": 3,
            "steve_today_cap": 10
          },
          "audit": [ ...special_access.list_audit_log(username=...) ]
        }
    """
    try:
        ent = resolve_entitlements(target_username) or {}
    except Exception:
        logger.exception("resolve_entitlements failed in manage_user")
        ent = {}

    def _as_int_or_none(v):
        if v is None:
            return None
        try:
            return int(v)
        except Exception:
            return None

    try:
        steve_month = ai_usage.monthly_steve_count(target_username)
    except Exception:
        steve_month = 0
    try:
        daily = ai_usage.daily_count(target_username)
    except Exception:
        daily = 0
    try:
        whisper_min = ai_usage.whisper_minutes_this_month(target_username)
    except Exception:
        whisper_min = 0.0

    try:
        special_access.ensure_tables()
        audit = special_access.list_audit_log(username=target_username, limit=20)
    except Exception:
        audit = []

    return jsonify({
        "success": True,
        "username": target_username,
        "entitlements": ent,
        "usage": {
            "steve_month": int(steve_month or 0),
            "steve_month_cap": _as_int_or_none(ent.get("steve_uses_per_month")),
            "whisper_minutes_month": round(float(whisper_min or 0), 2),
            "whisper_minutes_month_cap": _as_int_or_none(ent.get("whisper_minutes_per_month")),
            "steve_today": int(daily or 0),
            "steve_today_cap": _as_int_or_none(ent.get("ai_daily_limit")),
        },
        "audit": audit,
    })


@admin_users_bp.route("/api/admin/delete_user", methods=["POST"])
@_admin_required
def admin_delete_user():
    """Delete a user as admin (FK-safe; same path as legacy monolith route)."""
    actor = session.get("username")
    data = _body_json()
    target_username = (data.get("username") or "").strip()
    if not target_username:
        return jsonify({"success": False, "error": "Username required"}), 400
    if is_app_admin(target_username):
        return jsonify({"success": False, "error": "Cannot delete admin user"}), 400

    try:
        with get_db_connection() as conn:
            former = delete_user_in_connection(
                conn, target_username, AccountDeletionMode.ADMIN_PURGE
            )
            conn.commit()
    except ValueError as e:
        if str(e) == "user_not_found":
            return jsonify({"success": False, "error": "User not found"}), 404
        logger.exception("admin_delete_user ValueError")
        return jsonify({"success": False, "error": str(e)}), 500
    except Exception as e:
        logger.exception("Error deleting user: %s", e)
        return jsonify({"success": False, "error": str(e)}), 500

    try:
        from backend.services import community_lifecycle as _lifecycle
        from backend.services import subscription_audit as _audit

        for cid in former:
            try:
                if _lifecycle.maybe_auto_unfreeze(cid):
                    _audit.log(
                        username=target_username or "",
                        action="community_auto_unfrozen_member_removed",
                        source="admin_delete_user",
                        actor_username=actor,
                        metadata={"community_id": cid},
                    )
            except Exception:
                pass
    except Exception:
        pass

    return jsonify({"success": True})
