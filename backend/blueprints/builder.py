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


def _safe_tier(value):
    """Validate the user-facing quality tier (Quick='fast' | Polished='balanced' | Showpiece='best')."""
    t = value.strip().lower() if isinstance(value, str) else "balanced"
    return t if t in ("fast", "balanced", "best") else "balanced"


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
    tier = _safe_tier(data.get("tier"))

    if not _can_access_community(username, community_id):
        return jsonify({"success": False, "error": "not_found"}), 404

    allowed, reason, ent = gate_builder_or_reason(username, community_id=community_id)
    if not allowed:
        ai_usage.log_block(username, surface=ai_usage.SURFACE_BUILDER,
                           reason=reason or "builder_monthly_cap", community_id=community_id)
        return _limit_response(ent, reason)

    try:
        creation = builder_svc.create_creation(
            username=username, community_id=community_id, prompt=prompt, tier=tier,
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
                       model=creation.get("model") or builder_svc.MODEL_LABEL)
    return jsonify({"success": True, "creation": creation})


@builder_bp.route("/api/builder/chat", methods=["POST"])
def builder_chat():
    """Steve's design conversation — reason / ideate / discuss / propose-and-confirm
    before building. AI-free of the build cap (distinct surface)."""
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"success": False, "error": "message required"}), 400
    mode = "technical" if str(data.get("mode") or "").lower() == "technical" else "simple"
    # Ask (discuss only) vs Agent (can build). Defaults to Agent.
    agent_mode = str(data.get("agent_mode") or "agent").lower() != "ask"
    raw_history = data.get("history") if isinstance(data.get("history"), list) else []
    history = [{"role": h.get("role"), "text": h.get("text")}
               for h in raw_history if isinstance(h, dict) and h.get("text")][-20:]
    # Give Steve the ACTUAL current build to reason with (owner-scoped), so he
    # reasons against the real code, not just the prompt.
    current_html = None
    cid_int = _safe_int(data.get("creation_id"))
    if cid_int is not None:
        creation = builder_svc.get_creation(cid_int)
        if creation and creation.get("created_by") == username:
            current_html = creation.get("html_content")
    tier = _safe_tier(data.get("tier"))
    result = builder_svc.converse(history, message[:4000], mode=mode, agent_mode=agent_mode,
                                  has_creation=bool(current_html), current_html=current_html, tier=tier)
    ai_usage.log_usage(username, surface=ai_usage.SURFACE_BUILDER_CHAT, request_type="builder_chat",
                       community_id=_safe_int(data.get("community_id")), model=builder_svc.MODEL_LABEL)
    return jsonify({"success": True, **result})


@builder_bp.route("/api/builder/plan", methods=["POST"])
def builder_plan():
    """A quick 'here's what I'll make' narration shown while a build runs. Logged
    under a distinct surface so it does NOT consume a build turn."""
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    data = request.get_json(silent=True) or {}
    prompt = (data.get("prompt") or data.get("message") or "").strip()
    if not prompt:
        return jsonify({"success": False, "error": "prompt required"}), 400
    plan = builder_svc.plan_build(prompt[:4000], is_iteration=bool(data.get("iteration")))
    if plan:
        ai_usage.log_usage(username, surface=ai_usage.SURFACE_BUILDER_PLAN,
                           request_type="builder_plan", community_id=_safe_int(data.get("community_id")),
                           model=builder_svc.MODEL_LABEL)
    return jsonify({"success": True, "plan": plan})


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
    tier = _safe_tier(data.get("tier"))

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
            creation_id=creation_id, username=username, message=message, tier=tier,
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
                       model=creation.get("model") or builder_svc.MODEL_LABEL)
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


@builder_bp.route("/api/builder/mine", methods=["GET"])
def builder_mine():
    """The signed-in user's own creations so they can resume unfinished work."""
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    limit = _safe_int(request.args.get("limit")) or 50
    return jsonify({"success": True, "creations": builder_svc.list_creations(username, limit=limit)})


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
    }, "chat_history": builder_svc.get_chat_history(creation_id)})


@builder_bp.route("/api/builder/<int:creation_id>/history", methods=["POST"])
def builder_save_history(creation_id: int):
    """Persist the design conversation for a creation so the user can resume it."""
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    data = request.get_json(silent=True) or {}
    messages = data.get("messages")
    if not isinstance(messages, list):
        return jsonify({"success": False, "error": "messages required"}), 400
    try:
        saved = builder_svc.save_chat_history(creation_id=creation_id, username=username, messages=messages)
    except Exception:
        logger.exception("builder: save_chat_history failed")
        return jsonify({"success": False, "error": "save_failed"}), 500
    return jsonify({"success": saved})


# --- Community interaction data (scores / ratings / plays) --------------------
# These routes are NOT AI calls: they do not touch the builder turn cap, the
# entitlements gate, or ai_usage. Authorization is server-side — the community
# is resolved from the creation row (never the request), and the writer's
# username comes from the session, never the (untrusted) artifact.

def _resolve_accessible_creation(creation_id: int, username: str):
    """Return (creation, community_id) if the user may interact with it, else (None, None)."""
    creation = builder_svc.get_creation(creation_id)
    if not creation:
        return None, None
    community_id = _safe_int(creation.get("community_id"))
    if creation.get("created_by") == username:
        return creation, community_id
    if community_id is not None and _can_access_community(username, community_id):
        return creation, community_id
    return None, None


def _data_write_ok(username: str, creation_id: int) -> bool:
    """Coarse best-effort per-user/creation write throttle (anti-spam). Never blocks on error."""
    try:
        from redis_cache import cache
        key = f"cpdata:rl:{username}:{creation_id}"
        count = cache.get(key) or 0
        if int(count) >= 40:  # ~40 writes / 60s window
            return False
        cache.set(key, int(count) + 1, ttl=60)
    except Exception:
        pass
    return True


@builder_bp.route("/api/builder/<int:creation_id>/data/score", methods=["POST"])
def builder_data_score(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    if not _data_write_ok(username, creation_id):
        return jsonify({"success": False, "error": "rate_limited"}), 429
    data = request.get_json(silent=True) or {}
    try:
        result = builder_svc.submit_score(
            creation_id=creation_id, community_id=community_id, username=username,
            value=data.get("value"), key=data.get("key") or "highscore",
            display_name=data.get("name"),
        )
    except ValueError:
        return jsonify({"success": False, "error": "invalid_value"}), 400
    except Exception:
        logger.exception("builder: submit_score failed")
        return jsonify({"success": False, "error": "data_error"}), 500
    return jsonify(result)


@builder_bp.route("/api/builder/<int:creation_id>/data/rate", methods=["POST"])
def builder_data_rate(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    if not _data_write_ok(username, creation_id):
        return jsonify({"success": False, "error": "rate_limited"}), 429
    data = request.get_json(silent=True) or {}
    try:
        result = builder_svc.rate_creation(
            creation_id=creation_id, community_id=community_id, username=username,
            value=data.get("value"), display_name=data.get("name"),
        )
    except ValueError:
        return jsonify({"success": False, "error": "invalid_value"}), 400
    except Exception:
        logger.exception("builder: rate_creation failed")
        return jsonify({"success": False, "error": "data_error"}), 500
    return jsonify(result)


@builder_bp.route("/api/builder/<int:creation_id>/data/save", methods=["POST"])
def builder_data_save(creation_id: int):
    """Per-player save slot (localStorage is blocked in the sandbox)."""
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    if not _data_write_ok(username, creation_id):
        return jsonify({"success": False, "error": "rate_limited"}), 429
    data = request.get_json(silent=True) or {}
    try:
        result = builder_svc.save_record(
            creation_id=creation_id, community_id=community_id, username=username,
            key=data.get("key") or "save", value=data.get("value"),
        )
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception:
        logger.exception("builder: save_record failed")
        return jsonify({"success": False, "error": "data_error"}), 500
    return jsonify(result)


@builder_bp.route("/api/builder/<int:creation_id>/data/load", methods=["GET"])
def builder_data_load(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    return jsonify({"success": True, **builder_svc.load_record(creation_id, username=username, key=request.args.get("key") or "save")})


@builder_bp.route("/api/builder/<int:creation_id>/data/images", methods=["GET"])
def builder_data_images(creation_id: int):
    """Real freely-licensed photos for a query (keyless). Cached; rate-limited."""
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"success": True, "images": []})
    limit = min(_safe_int(request.args.get("limit")) or 8, 20)
    cache = None
    ckey = f"cpdata:img:{q.lower()[:80]}:{limit}"
    try:
        from redis_cache import cache as _c
        cache = _c
        hit = cache.get(ckey)
        if hit is not None:
            return jsonify({"success": True, "images": hit})
    except Exception:
        cache = None
    if not _data_write_ok(username, creation_id):
        return jsonify({"success": False, "error": "rate_limited", "images": []}), 429
    images = builder_svc.search_images(q, limit=limit)
    try:
        if cache is not None and images:
            cache.set(ckey, images, ttl=21600)
    except Exception:
        pass
    return jsonify({"success": True, "images": images})


@builder_bp.route("/api/builder/<int:creation_id>/data/leaderboard", methods=["GET"])
def builder_data_leaderboard(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    key = request.args.get("key") or "highscore"
    limit = _safe_int(request.args.get("limit")) or 10
    return jsonify({"success": True, **builder_svc.get_leaderboard(creation_id, key=key, limit=limit, username=username)})


@builder_bp.route("/api/builder/<int:creation_id>/data/results", methods=["GET"])
def builder_data_results(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    return jsonify({"success": True, **builder_svc.get_results(creation_id, username=username)})


@builder_bp.route("/api/builder/<int:creation_id>/data/summary", methods=["GET"])
def builder_data_summary(creation_id: int):
    """Lightweight aggregates for the feed card strip (plays / top score / rating)."""
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    try:
        from redis_cache import cache
        ckey = f"cpdata:summary:{creation_id}"
        cached = cache.get(ckey)
        if cached is not None:
            return jsonify({"success": True, **cached})
    except Exception:
        cache = None
        ckey = None
    summary = builder_svc.get_summary(creation_id)
    try:
        if cache is not None and ckey:
            cache.set(ckey, summary, ttl=15)
    except Exception:
        pass
    return jsonify({"success": True, **summary})


@builder_bp.route("/api/builder/<int:creation_id>/play", methods=["POST"])
def builder_record_play(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    result = builder_svc.record_play(creation_id)
    try:
        from redis_cache import cache
        cache.delete(f"cpdata:summary:{creation_id}")
    except Exception:
        pass
    return jsonify({"success": True, **result})
