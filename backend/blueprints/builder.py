"""Steve Builder routes — chat-to-build front-end creations (Phase 1).

All routes are cookie/session authenticated. Build turns (``create`` /
``iterate``) are gated by the self-contained builder entitlement and log one
``ai_usage_log`` row each (success or block), per the repo's AI invariants.
Builder deliberately does NOT use the Steve credit-pool gate.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request, session

from backend.services import ai_usage
from backend.services import builder as builder_svc
from backend.services.entitlements_gate import gate_builder_or_reason
from backend.services.community_access import can_view_community_content
from backend.services.database import get_db_connection, get_sql_placeholder

builder_bp = Blueprint("builder", __name__)
logger = logging.getLogger(__name__)


def _safe_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _can_access_community(username: str, community_id: int) -> bool:
    """Server-side authorization: can this user see content in the community."""
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            allowed, _reason = can_view_community_content(c, ph, username, community_id)
            return bool(allowed)
    except Exception:
        logger.exception("builder: community access check failed")
        return False


def _limit_response(ent, reason):
    cap = ent.get("builder_turns_per_month") if isinstance(ent, dict) else None
    return jsonify({
        "success": False,
        "error": "builder_limit_reached",
        "code": reason or "builder_monthly_cap",
        "cap": cap,
        "message": "You've used all your builds for this month. Upgrade to keep building.",
    }), 402


@builder_bp.route("/api/builder/create", methods=["POST"])
def builder_create():
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401

    data = request.get_json(silent=True) or {}
    community_id = _safe_int(data.get("community_id"))
    prompt = (data.get("prompt") or "").strip()
    if community_id is None or not prompt:
        return jsonify({"success": False, "error": "community_id and prompt are required"}), 400
    if len(prompt) > 4000:
        return jsonify({"success": False, "error": "prompt too long"}), 400

    if not _can_access_community(username, community_id):
        return jsonify({"success": False, "error": "not_found"}), 404

    allowed, reason, ent = gate_builder_or_reason(username, community_id=community_id)
    if not allowed:
        ai_usage.log_block(username, surface=ai_usage.SURFACE_BUILDER,
                           reason=reason or "builder_monthly_cap", community_id=community_id)
        return _limit_response(ent, reason)

    try:
        creation = builder_svc.create_creation(
            username=username, community_id=community_id, prompt=prompt,
        )
    except Exception:
        logger.exception("builder: create_creation failed")
        ai_usage.log_usage(username, surface=ai_usage.SURFACE_BUILDER,
                           request_type="builder_create", success=False,
                           reason_blocked="generation_error", community_id=community_id,
                           model=builder_svc.MODEL_LABEL)
        return jsonify({"success": False, "error": "build_failed"}), 502

    ai_usage.log_usage(username, surface=ai_usage.SURFACE_BUILDER,
                       request_type="builder_create", community_id=community_id,
                       model=builder_svc.MODEL_LABEL)
    return jsonify({"success": True, "creation": creation})


@builder_bp.route("/api/builder/<int:creation_id>/iterate", methods=["POST"])
def builder_iterate(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"success": False, "error": "message is required"}), 400
    if len(message) > 4000:
        return jsonify({"success": False, "error": "message too long"}), 400

    existing = builder_svc.get_creation(creation_id)
    if not existing or existing.get("created_by") != username:
        return jsonify({"success": False, "error": "not_found"}), 404
    community_id = _safe_int(existing.get("community_id"))

    allowed, reason, ent = gate_builder_or_reason(username, community_id=community_id)
    if not allowed:
        ai_usage.log_block(username, surface=ai_usage.SURFACE_BUILDER,
                           reason=reason or "builder_monthly_cap", community_id=community_id)
        return _limit_response(ent, reason)

    try:
        creation = builder_svc.iterate_creation(
            creation_id=creation_id, username=username, message=message,
        )
    except PermissionError:
        return jsonify({"success": False, "error": "not_found"}), 404
    except Exception:
        logger.exception("builder: iterate_creation failed")
        ai_usage.log_usage(username, surface=ai_usage.SURFACE_BUILDER,
                           request_type="builder_iterate", success=False,
                           reason_blocked="generation_error", community_id=community_id,
                           model=builder_svc.MODEL_LABEL)
        return jsonify({"success": False, "error": "build_failed"}), 502

    ai_usage.log_usage(username, surface=ai_usage.SURFACE_BUILDER,
                       request_type="builder_iterate", community_id=community_id,
                       model=builder_svc.MODEL_LABEL)
    return jsonify({"success": True, "creation": creation})


@builder_bp.route("/api/builder/<int:creation_id>/publish", methods=["POST"])
def builder_publish(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401

    data = request.get_json(silent=True) or {}
    caption = (data.get("caption") or "").strip() or None

    existing = builder_svc.get_creation(creation_id)
    if not existing or existing.get("created_by") != username:
        return jsonify({"success": False, "error": "not_found"}), 404

    try:
        result = builder_svc.publish_creation(
            creation_id=creation_id, username=username, caption=caption,
        )
    except PermissionError:
        return jsonify({"success": False, "error": "not_found"}), 404
    except Exception:
        logger.exception("builder: publish_creation failed")
        return jsonify({"success": False, "error": "publish_failed"}), 500

    try:
        from redis_cache import invalidate_community_cache
        invalidate_community_cache(existing.get("community_id"))
    except Exception:
        logger.warning("builder: feed cache invalidation failed", exc_info=True)

    return jsonify({"success": True, **result})


@builder_bp.route("/api/builder/<int:creation_id>", methods=["GET"])
def builder_get(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401

    creation = builder_svc.get_creation(creation_id)
    if not creation:
        return jsonify({"success": False, "error": "not_found"}), 404

    # Owner always allowed; otherwise must be able to see the community's content.
    if creation.get("created_by") != username:
        community_id = _safe_int(creation.get("community_id"))
        if community_id is None or not _can_access_community(username, community_id):
            return jsonify({"success": False, "error": "not_found"}), 404

    return jsonify({"success": True, "creation": {
        "id": creation.get("id"),
        "title": creation.get("title"),
        "html": creation.get("html_content"),
        "status": creation.get("status"),
        "community_id": creation.get("community_id"),
        "created_by": creation.get("created_by"),
        "published_post_id": creation.get("published_post_id"),
    }})
