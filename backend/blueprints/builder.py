"""Steve Builder routes — chat-to-build front-end creations (Phase 1).

All routes are cookie/session authenticated. Build turns (``create`` /
``iterate``) are gated by the self-contained builder entitlement and log one
``ai_usage_log`` row each (success or block), per the repo's AI invariants.
Builder deliberately does NOT use the Steve credit-pool gate.
"""

from __future__ import annotations

import json
import logging

from flask import Blueprint, jsonify, request, session

from backend.services import ai_usage
from backend.services import builder as builder_svc
from backend.services import builder_capsules
from backend.services import builder_feeds
from backend.services import creation_runtime as runtime_svc
from backend.services import creation_match as match_svc
from backend.services.cron_auth import cron_authed
from backend.services.entitlements_gate import gate_builder_or_reason
from backend.services.community_access import can_view_community_content
from backend.services.community import is_app_admin
from backend.services.database import get_db_connection, get_sql_placeholder

builder_bp = Blueprint("builder", __name__)
logger = logging.getLogger(__name__)
_MAX_BUILD_REQUEST_CHARS = 20_000


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


def _json_creation(row, *, include_private: bool = True):
    payload = {
        "id": row.get("id"),
        "title": row.get("title"),
        "html": row.get("html_content") or row.get("html"),
        "status": row.get("status"),
        "kind": row.get("kind"),
        "public_slug": row.get("public_slug"),
        "public_status": row.get("public_status"),
        "public_url": row.get("public_url"),
        "public_published_at": str(row.get("public_published_at")) if row.get("public_published_at") else None,
        "public_kind": row.get("public_kind"),
        "gallery_status": row.get("gallery_status") or "not_listed",
        "gallery_requested_at": str(row.get("gallery_requested_at")) if row.get("gallery_requested_at") else None,
        "gallery_reviewed_at": str(row.get("gallery_reviewed_at")) if row.get("gallery_reviewed_at") else None,
        "gallery_rejection_reason": row.get("gallery_rejection_reason"),
    }
    if include_private:
        payload["created_by"] = row.get("created_by")
        payload["community_id"] = row.get("community_id")
        payload["published_post_id"] = row.get("published_post_id")
        payload["capsule_recipes"] = row.get("capsule_recipes") or builder_capsules.loads_recipes(row.get("capsule_recipes_json"))
    elif row.get("capsule_recipes") or row.get("capsule_recipes_json"):
        recipes = row.get("capsule_recipes") or builder_capsules.loads_recipes(row.get("capsule_recipes_json"))
        payload["capsule_recipes"] = [r for r in recipes if r.get("public")]
    return payload


def _limit_response(ent, reason):
    cap = ent.get("builder_turns_per_month") if isinstance(ent, dict) else None
    return jsonify({
        "success": False,
        "error": "builder_limit_reached",
        "code": reason or "builder_monthly_cap",
        "cap": cap,
        "message": "You've used all your builds for this month. Upgrade to keep building.",
    }), 402


def _active_job_response():
    return jsonify({
        "success": False,
        "error": "builder_job_active",
        "message": "Steve is already building something for you. You can leave this screen — we'll notify you when it's ready.",
    }), 409


def _job_payload(job):
    return {
        "id": job.get("id"),
        "status": job.get("status"),
        "kind": job.get("kind"),
        "community_id": job.get("community_id"),
        "creation_id": job.get("creation_id"),
        "result_creation_id": job.get("result_creation_id"),
        "error": job.get("error"),
    }


@builder_bp.route("/api/builder/create", methods=["POST"])
def builder_create():
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401

    data = request.get_json(silent=True) or {}
    community_id = _safe_int(data.get("community_id"))
    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        return jsonify({"success": False, "error": "prompt is required"}), 400
    if len(prompt) > _MAX_BUILD_REQUEST_CHARS:
        return jsonify({"success": False, "error": "prompt too long"}), 400
    tier = _safe_tier(data.get("tier"))

    if community_id is not None and not _can_access_community(username, community_id):
        return jsonify({"success": False, "error": "not_found"}), 404

    allowed, reason, ent = gate_builder_or_reason(username, community_id=community_id)
    if not allowed:
        ai_usage.log_block(username, surface=ai_usage.SURFACE_BUILDER,
                           reason=reason or "builder_monthly_cap", community_id=community_id)
        return _limit_response(ent, reason)

    if builder_svc.user_has_active_job(username):
        return _active_job_response()

    job = builder_svc.create_build_job(
        username=username, community_id=community_id, prompt=prompt, tier=tier, kind="create",
    )
    queued_with_cloud_tasks = builder_svc.enqueue_build_job(int(job["id"]))
    return jsonify({
        "success": True,
        "queued": True,
        "job": _job_payload(job),
        "queued_with_cloud_tasks": queued_with_cloud_tasks,
        "message": "Steve is building now. You can leave this screen — we'll notify you when it's ready.",
    }), 202


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
    if len(message) > _MAX_BUILD_REQUEST_CHARS:
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

    if builder_svc.user_has_active_job(username):
        return _active_job_response()

    job = builder_svc.create_build_job(
        username=username, community_id=community_id, creation_id=creation_id,
        prompt=message, tier=tier, kind="iterate",
    )
    queued_with_cloud_tasks = builder_svc.enqueue_build_job(int(job["id"]))
    return jsonify({
        "success": True,
        "queued": True,
        "job": _job_payload(job),
        "queued_with_cloud_tasks": queued_with_cloud_tasks,
        "message": "Steve is updating it now. You can leave this screen — we'll notify you when it's ready.",
    }), 202


@builder_bp.route("/api/builder/jobs/<int:job_id>", methods=["GET"])
def builder_job_get(job_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    job = builder_svc.get_build_job(job_id)
    if not job or job.get("username") != username:
        return jsonify({"success": False, "error": "not_found"}), 404
    creation = None
    result_id = _safe_int(job.get("result_creation_id"))
    if result_id:
        row = builder_svc.get_creation(result_id)
        if row and row.get("created_by") == username:
            creation = {
                **_json_creation(row)
            }
    return jsonify({"success": True, "job": _job_payload(job), "creation": creation})


@builder_bp.route("/api/internal/builder/jobs/<int:job_id>/run", methods=["POST"])
def builder_job_run_internal(job_id: int):
    # Cloud Tasks worker callback — shared-secret auth, not a session.
    if not cron_authed(request, extra_secret_env="BUILDER_JOB_SECRET", extra_header="X-Builder-Job-Secret"):
        return jsonify({"success": False, "error": "forbidden"}), 403
    result = builder_svc.run_build_job(job_id)
    # 500 ONLY when a retry could help (transient infra error). Terminal failures
    # return 200 so Cloud Tasks stops retrying — otherwise it would retry-storm
    # and re-log success=0 rows for a build that can never succeed.
    status = 500 if (not result.get("success") and result.get("transient")) else 200
    return jsonify(result), status


@builder_bp.route("/api/cron/builder/sweep", methods=["POST"])
def builder_sweep_cron():
    """Cloud Scheduler reaper — reclaim builds orphaned by a crashed worker."""
    if not cron_authed(request):
        return jsonify({"success": False, "error": "forbidden"}), 403
    result = builder_svc.sweep_build_jobs()
    return jsonify({"success": True, **result})


@builder_bp.route("/api/builder/<int:creation_id>/publish", methods=["POST"])
def builder_publish(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401

    data = request.get_json(silent=True) or {}
    caption = (data.get("caption") or "").strip() or None
    community_id = _safe_int(data.get("community_id"))

    existing = builder_svc.get_creation(creation_id)
    if not existing or existing.get("created_by") != username:
        return jsonify({"success": False, "error": "not_found"}), 404
    target_community_id = community_id if community_id is not None else _safe_int(existing.get("community_id"))
    if target_community_id is None:
        return jsonify({"success": False, "error": "community_required"}), 400
    if not _can_access_community(username, target_community_id):
        return jsonify({"success": False, "error": "not_found"}), 404

    try:
        result = builder_svc.publish_creation(
            creation_id=creation_id, username=username, community_id=target_community_id, caption=caption,
        )
    except PermissionError:
        return jsonify({"success": False, "error": "not_found"}), 404
    except Exception:
        logger.exception("builder: publish_creation failed")
        return jsonify({"success": False, "error": "publish_failed"}), 500

    try:
        from redis_cache import invalidate_community_cache
        invalidate_community_cache(target_community_id)
    except Exception:
        logger.warning("builder: feed cache invalidation failed", exc_info=True)

    return jsonify({"success": True, **result})


@builder_bp.route("/api/builder/<int:creation_id>/share", methods=["POST"])
def builder_share_to_community(creation_id: int):
    """Share one owned creation into a community the user belongs to."""
    return builder_publish(creation_id)


@builder_bp.route("/api/builder/<int:creation_id>/publish-web", methods=["GET"])
def builder_publish_web_status(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    creation = builder_svc.get_creation(creation_id)
    if not creation or creation.get("created_by") != username:
        return jsonify({"success": False, "error": "not_found"}), 404
    return jsonify({"success": True, "publication": {
        "public_slug": creation.get("public_slug"),
        "public_status": creation.get("public_status"),
        "public_url": creation.get("public_url"),
        "public_published_at": str(creation.get("public_published_at")) if creation.get("public_published_at") else None,
        "public_kind": creation.get("public_kind"),
        "eligible": builder_svc.public_publish_eligible(creation.get("public_kind") or creation.get("kind")),
    }})


@builder_bp.route("/api/builder/<int:creation_id>/publish-web", methods=["POST"])
def builder_publish_web(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    try:
        result = builder_svc.publish_creation_to_web(creation_id=creation_id, username=username)
    except PermissionError:
        return jsonify({"success": False, "error": "not_found"}), 404
    except ValueError as exc:
        error = str(exc)
        status = 400
        return jsonify({"success": False, "error": error}), status
    except Exception:
        logger.exception("builder: publish_creation_to_web failed")
        return jsonify({"success": False, "error": "publish_web_failed"}), 500
    return jsonify({"success": True, **result})


@builder_bp.route("/api/builder/<int:creation_id>/publish-web", methods=["DELETE"])
def builder_unpublish_web(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    try:
        result = builder_svc.unpublish_creation_from_web(creation_id=creation_id, username=username)
    except PermissionError:
        return jsonify({"success": False, "error": "not_found"}), 404
    except Exception:
        logger.exception("builder: unpublish_creation_from_web failed")
        return jsonify({"success": False, "error": "unpublish_web_failed"}), 500
    return jsonify({"success": True, **result})


@builder_bp.route("/api/builder/explore", methods=["GET"])
def builder_explore():
    limit = _safe_int(request.args.get("limit")) or 30
    return jsonify({"success": True, "creations": builder_svc.list_explore_creations(limit=limit)})


@builder_bp.route("/api/builder/<int:creation_id>/gallery", methods=["POST"])
def builder_gallery_update(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    data = request.get_json(silent=True) or {}
    action = str(data.get("action") or "request")
    try:
        result = builder_svc.update_gallery_status(creation_id=creation_id, username=username, action=action)
    except PermissionError:
        return jsonify({"success": False, "error": "not_found"}), 404
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception:
        logger.exception("builder: gallery update failed")
        return jsonify({"success": False, "error": "gallery_update_failed"}), 500
    return jsonify({"success": True, **result})


@builder_bp.route("/api/admin/builder/<int:creation_id>/gallery", methods=["POST"])
def builder_admin_gallery_update(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "forbidden"}), 403
    data = request.get_json(silent=True) or {}
    action = str(data.get("action") or "")
    reason = (data.get("reason") or "").strip() or None
    try:
        result = builder_svc.update_gallery_status(
            creation_id=creation_id, username=username, action=action, reviewer=username, reason=reason,
        )
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except PermissionError:
        return jsonify({"success": False, "error": "not_found"}), 404
    except Exception:
        logger.exception("builder: admin gallery update failed")
        return jsonify({"success": False, "error": "gallery_update_failed"}), 500
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

    include_private = True
    # Owner always allowed; otherwise must be able to see the community's content
    # or open an owner-approved Explore listing inside the platform.
    if creation.get("created_by") != username:
        requested_community_id = _safe_int(request.args.get("community_id"))
        community_id = requested_community_id if requested_community_id is not None else _safe_int(creation.get("community_id"))
        if requested_community_id is None and creation.get("gallery_status") == "approved":
            include_private = False
        elif community_id is None or not _can_access_community(username, community_id):
            return jsonify({"success": False, "error": "not_found"}), 404
        elif requested_community_id is not None and not builder_svc.get_creation_share(
            creation_id=creation_id, community_id=requested_community_id,
        ):
            return jsonify({"success": False, "error": "not_found"}), 404

    return jsonify({"success": True, "creation": _json_creation(creation, include_private=include_private),
                    "chat_history": builder_svc.get_chat_history(creation_id) if include_private else []})


@builder_bp.route("/api/builder/<int:creation_id>", methods=["DELETE"])
def builder_delete(creation_id: int):
    """Owner-only permanent delete for a Steve Build creation."""
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    result, status = builder_svc.delete_creation(username, creation_id)
    return jsonify(result), status


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
    requested_community_id = _safe_int(request.args.get("community_id"))
    if requested_community_id is None and request.method != "GET":
        payload = request.get_json(silent=True) or {}
        requested_community_id = _safe_int(payload.get("community_id"))
    if requested_community_id is not None:
        if requested_community_id == 0 and creation.get("created_by") == username:
            return creation, 0
        if (builder_svc.get_creation_share(creation_id=creation_id, community_id=requested_community_id)
                and _can_access_community(username, requested_community_id)):
            return creation, requested_community_id
        return None, None
    community_id = _safe_int(creation.get("community_id"))
    if creation.get("created_by") == username:
        # Owner can always interact with their own creation's data, even a draft
        # with no community yet (stamp 0 so the `community_id is None` route gate
        # never wrongly 404s the owner).
        return creation, (community_id if community_id is not None else 0)
    if requested_community_id is None and creation.get("gallery_status") == "approved":
        return creation, 0
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


def _data_read_ok(username: str, creation_id: int, connector: str = "") -> bool:
    """Best-effort read throttle for brokered public data polling."""
    try:
        from redis_cache import cache
        safe_connector = (connector or "feed")[:32]
        key = f"cpfeed:rl:{username}:{creation_id}:{safe_connector}"
        if hasattr(cache, "incr"):
            count = cache.incr(key, ttl=60)
        else:
            count = int(cache.get(key) or 0) + 1
            cache.set(key, count, ttl=60)
        if count is not None and int(count) >= 120:  # ~120 reads / 60s / connector / creation
            return False
    except Exception:
        pass
    return True


def _client_ip() -> str:
    raw = request.headers.get("CF-Connecting-IP") or request.headers.get("X-Forwarded-For") or request.remote_addr or "unknown"
    return str(raw).split(",")[0].strip()[:64] or "unknown"


def _public_data_read_ok(slug: str, creation_id: int, connector: str = "") -> bool:
    """Best-effort public throttle: per slug/connector plus per IP burst cap."""
    if not _data_read_ok(f"public:{slug}", creation_id, connector):
        return False
    try:
        from redis_cache import cache
        safe_slug = (slug or "public")[:96]
        safe_connector = (connector or "feed")[:32]
        key = f"cpfeed:pubip:{_client_ip()}:{safe_slug}:{safe_connector}"
        if hasattr(cache, "incr"):
            count = cache.incr(key, ttl=60)
        else:
            count = int(cache.get(key) or 0) + 1
            cache.set(key, count, ttl=60)
        if count is not None and int(count) >= 60:  # ~60 anonymous reads / 60s / IP / build / connector
            return False
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
    return jsonify({"success": True, **builder_svc.load_record(
        creation_id, community_id=community_id, username=username, key=request.args.get("key") or "save",
    )})


@builder_bp.route("/api/builder/<int:creation_id>/data/images", methods=["GET"])
def builder_data_images(creation_id: int):
    """Real freely-licensed photos for a query (keyless). Cached; rate-limited."""
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    creation, community_id = _resolve_accessible_creation(creation_id, username)
    if creation is None:
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


@builder_bp.route("/api/builder/<int:creation_id>/data/feed", methods=["GET"])
def builder_data_feed(creation_id: int):
    """Brokered public data connector. The artifact passes a connector id, never a URL."""
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    creation, community_id = _resolve_accessible_creation(creation_id, username)
    if creation is None:
        return jsonify({"success": False, "error": "not_found"}), 404

    connector = (request.args.get("connector") or "").strip().lower()
    refresh = str(request.args.get("refresh") or "").strip().lower() in {"1", "true", "yes"}
    raw_params = request.args.get("params") or "{}"
    try:
        params = json.loads(raw_params) if raw_params else {}
    except Exception:
        return jsonify({"success": False, "error": "invalid_params"}), 400
    if not isinstance(params, dict):
        return jsonify({"success": False, "error": "invalid_params"}), 400

    if not _data_read_ok(username, creation_id, connector):
        return jsonify({"success": False, "error": "rate_limited", "data": None}), 429

    result = builder_feeds.fetch_feed(connector, params, refresh=refresh)
    status = 200
    if not result.get("success") and result.get("error") in {"unknown_connector", "invalid_params"}:
        status = 400
    return jsonify(result), status


@builder_bp.route("/api/builder/<int:creation_id>/capsules/<name>", methods=["GET"])
def builder_capsule_get(creation_id: int, name: str):
    """Execute a stored capsule recipe for an authenticated in-app creation."""
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    creation, _community_id = _resolve_accessible_creation(creation_id, username)
    if creation is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    recipe = builder_capsules.find_recipe(creation.get("capsule_recipes") or [], name)
    if not recipe:
        return jsonify({"success": False, "error": "capsule_not_found", "data": None}), 404
    connector_key = str(recipe.get("connector") or recipe.get("engine") or "capsule")
    if not _data_read_ok(username, creation_id, connector_key):
        return jsonify({"success": False, "error": "rate_limited", "data": None}), 429
    refresh = str(request.args.get("refresh") or "").strip().lower() in {"1", "true", "yes"}
    result = builder_capsules.execute_recipe(recipe, refresh=refresh)
    status = 200
    if not result.get("success") and result.get("error") in {"unknown_connector", "invalid_params", "unknown_capsule_engine"}:
        status = 400
    return jsonify(result), status


def _public_json(payload, status: int = 200):
    resp = jsonify(payload)
    resp.status_code = status
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept"
    resp.headers["Cache-Control"] = "public, max-age=60"
    return resp


@builder_bp.route("/api/builder/public/<slug>/data/images", methods=["GET", "OPTIONS"])
def builder_public_data_images(slug: str):
    """Unauthenticated public image search for published web builds only."""
    if request.method == "OPTIONS":
        return _public_json({"success": True})
    creation = builder_svc.public_creation_for_slug(slug)
    if not creation:
        return _public_json({"success": False, "error": "not_found", "images": []}, 404)
    q = (request.args.get("q") or "").strip()
    if not q:
        return _public_json({"success": True, "images": []})
    limit = min(_safe_int(request.args.get("limit")) or 8, 20)
    if not _public_data_read_ok(str(creation.get("public_slug") or slug), int(creation["id"]), "images"):
        return _public_json({"success": False, "error": "rate_limited", "images": []}, 429)
    images = builder_svc.search_images(q, limit=limit)
    return _public_json({"success": True, "images": images})


@builder_bp.route("/api/builder/public/<slug>/data/feed", methods=["GET", "OPTIONS"])
def builder_public_data_feed(slug: str):
    """Unauthenticated public-data connector for published web builds only."""
    if request.method == "OPTIONS":
        return _public_json({"success": True})
    creation = builder_svc.public_creation_for_slug(slug)
    if not creation:
        return _public_json({"success": False, "error": "not_found", "data": None}, 404)

    connector = (request.args.get("connector") or "").strip().lower()
    # Public refresh is disabled in v1; public reads must respect route throttles,
    # connector budgets, and stale fallback instead of letting anonymous users
    # force fresh upstream calls.
    refresh = False
    raw_params = request.args.get("params") or "{}"
    try:
        params = json.loads(raw_params) if raw_params else {}
    except Exception:
        return _public_json({"success": False, "error": "invalid_params"}, 400)
    if not isinstance(params, dict):
        return _public_json({"success": False, "error": "invalid_params"}, 400)

    if not _public_data_read_ok(str(creation.get("public_slug") or slug), int(creation["id"]), connector):
        return _public_json({"success": False, "error": "rate_limited", "data": None}, 429)

    result = builder_feeds.fetch_feed(connector, params, refresh=refresh)
    status = 200
    if not result.get("success") and result.get("error") in {"unknown_connector", "invalid_params"}:
        status = 400
    return _public_json(result, status)


@builder_bp.route("/api/builder/public/<slug>/capsules/<name>", methods=["GET", "OPTIONS"])
def builder_public_capsule_get(slug: str, name: str):
    """Execute a public-safe stored capsule recipe for a published web build."""
    if request.method == "OPTIONS":
        return _public_json({"success": True})
    creation = builder_svc.public_creation_for_slug(slug)
    if not creation:
        return _public_json({"success": False, "error": "not_found", "data": None}, 404)
    recipe = builder_capsules.find_recipe(creation.get("capsule_recipes") or [], name)
    if not recipe or not recipe.get("public"):
        return _public_json({"success": False, "error": "not_found", "data": None}, 404)
    connector_key = str(recipe.get("connector") or recipe.get("engine") or "capsule")
    if not _public_data_read_ok(str(creation.get("public_slug") or slug), int(creation["id"]), connector_key):
        return _public_json({"success": False, "error": "rate_limited", "data": None}, 429)
    result = builder_capsules.execute_recipe(recipe, refresh=False)
    status = 200
    if not result.get("success") and result.get("error") in {"unknown_connector", "invalid_params", "unknown_capsule_engine"}:
        status = 400
    return _public_json(result, status)


@builder_bp.route("/api/builder/<int:creation_id>/data/shared", methods=["GET"])
def builder_data_shared_get(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    if not _data_read_ok(username, creation_id, "shared"):
        return jsonify({"success": False, "error": "rate_limited"}), 429
    state = runtime_svc.get_shared_state(
        creation_id=creation_id, community_id=community_id, key=request.args.get("key") or "main",
    )
    return jsonify({"success": True, **state})


@builder_bp.route("/api/builder/<int:creation_id>/data/shared", methods=["POST"])
def builder_data_shared_update(creation_id: int):
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
        state = runtime_svc.update_shared_state(
            creation_id=creation_id, community_id=community_id, username=username,
            key=data.get("key") or "main", value=data.get("value"),
            expected_version=_safe_int(data.get("version")),
        )
        return jsonify({"success": True, **state})
    except ValueError as e:
        status = 409 if str(e) == "version_conflict" else 400
        return jsonify({"success": False, "error": str(e)}), status
    except Exception:
        logger.exception("builder: shared state update failed")
        return jsonify({"success": False, "error": "data_error"}), 500


@builder_bp.route("/api/builder/<int:creation_id>/data/collection/<name>", methods=["GET"])
def builder_data_collection_list(creation_id: int, name: str):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    if not _data_read_ok(username, creation_id, "collection"):
        return jsonify({"success": False, "error": "rate_limited"}), 429
    result = runtime_svc.list_collection(
        creation_id=creation_id, community_id=community_id, name=name, limit=_safe_int(request.args.get("limit")) or 100,
    )
    return jsonify({"success": True, **result})


@builder_bp.route("/api/builder/<int:creation_id>/data/collection/<name>", methods=["POST"])
def builder_data_collection_create(creation_id: int, name: str):
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
        item = runtime_svc.create_collection_item(
            creation_id=creation_id, community_id=community_id, username=username,
            name=name, value=data.get("value"),
        )
        return jsonify({"success": True, "item": item})
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception:
        logger.exception("builder: collection create failed")
        return jsonify({"success": False, "error": "data_error"}), 500


@builder_bp.route("/api/builder/<int:creation_id>/data/collection/<name>/<row_id>", methods=["PATCH"])
def builder_data_collection_update(creation_id: int, name: str, row_id: str):
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
        item = runtime_svc.update_collection_item(
            creation_id=creation_id, community_id=community_id, name=name, row_id=row_id, value=data.get("value"),
            expected_version=_safe_int(data.get("version")),
        )
        return jsonify({"success": True, "item": item})
    except ValueError as e:
        status = 409 if str(e) == "version_conflict" else 404 if str(e) == "row_not_found" else 400
        return jsonify({"success": False, "error": str(e)}), status
    except Exception:
        logger.exception("builder: collection update failed")
        return jsonify({"success": False, "error": "data_error"}), 500


@builder_bp.route("/api/builder/<int:creation_id>/data/collection/<name>/<row_id>", methods=["DELETE"])
def builder_data_collection_delete(creation_id: int, name: str, row_id: str):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    if not _data_write_ok(username, creation_id):
        return jsonify({"success": False, "error": "rate_limited"}), 429
    result = runtime_svc.delete_collection_item(creation_id=creation_id, community_id=community_id, name=name, row_id=row_id)
    return jsonify({"success": True, **result})


@builder_bp.route("/api/builder/<int:creation_id>/data/forms/<name>/submit", methods=["POST"])
def builder_data_form_submit(creation_id: int, name: str):
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
        result = runtime_svc.submit_form(
            creation_id=creation_id, community_id=community_id, username=username,
            name=name, value=data.get("value"),
        )
        return jsonify({"success": True, **result})
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception:
        logger.exception("builder: form submit failed")
        return jsonify({"success": False, "error": "data_error"}), 500


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
    return jsonify({"success": True, **builder_svc.get_leaderboard(
        creation_id, community_id=community_id, key=key, limit=limit, username=username,
    )})


@builder_bp.route("/api/builder/<int:creation_id>/data/results", methods=["GET"])
def builder_data_results(creation_id: int):
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "auth_required"}), 401
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return jsonify({"success": False, "error": "not_found"}), 404
    return jsonify({"success": True, **builder_svc.get_results(creation_id, community_id=community_id, username=username)})


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
        ckey = f"cpdata:summary:{creation_id}:{community_id}"
        cached = cache.get(ckey)
        if cached is not None:
            return jsonify({"success": True, **cached})
    except Exception:
        cache = None
        ckey = None
    summary = builder_svc.get_summary(creation_id, community_id=community_id)
    try:
        if cache is not None and ckey:
            cache.set(ckey, summary, ttl=15)
    except Exception:
        pass
    return jsonify({"success": True, **summary})


# --- Two-player turn-based MATCH routes (game-agnostic; see creation_match.py) ---

def _match_fail(e: Exception):
    """Map a creation_match error to a JSON response. The build keys off the
    error STRING (e.g. 'not_your_turn','stale_version') to recover, so always
    pass it through."""
    msg = str(e) or "match_error"
    if isinstance(e, PermissionError):
        return jsonify({"success": False, "error": msg}), 403
    if isinstance(e, ValueError):
        code = 404 if msg == "match_not_found" else (
            409 if msg in ("not_your_turn", "stale_version", "not_active") else 400)
        return jsonify({"success": False, "error": msg}), code
    logger.exception("builder: match op failed")
    return jsonify({"success": False, "error": "match_error"}), 500


def _match_access(creation_id: int):
    """Shared auth for match routes -> (username, community_id) or an error response.

    The resolved community context is authoritative for CONTEXT-scoped routes
    (opponents / create / list — the lobby is per-community). Ops on an
    EXISTING match must NOT filter by this caller context: the two players may
    have entered the same creation through different surfaces (another shared
    community, Explore, My Builds, a notification deep link) and a context
    filter would 404 mid-game. For those ops the real security boundary is the
    seat check in creation_match (only seat 1/2 can read or act), so the
    routes below pass community_id=None to the service.
    """
    username = session.get("username")
    if not username:
        return None, None, (jsonify({"success": False, "error": "auth_required"}), 401)
    _creation, community_id = _resolve_accessible_creation(creation_id, username)
    if community_id is None:
        return None, None, (jsonify({"success": False, "error": "not_found"}), 404)
    return username, community_id, None


@builder_bp.route("/api/builder/<int:creation_id>/match/opponents", methods=["GET"])
def builder_match_opponents(creation_id: int):
    username, community_id, err = _match_access(creation_id)
    if err:
        return err
    return jsonify({"success": True, "opponents": match_svc.list_opponents(creation_id, community_id, username)})


@builder_bp.route("/api/builder/<int:creation_id>/match/list", methods=["GET"])
def builder_match_list(creation_id: int):
    username, community_id, err = _match_access(creation_id)
    if err:
        return err
    return jsonify({"success": True, "matches": match_svc.list_matches(
        creation_id, username, community_id=community_id)})


@builder_bp.route("/api/builder/<int:creation_id>/match/create", methods=["POST"])
def builder_match_create(creation_id: int):
    username, community_id, err = _match_access(creation_id)
    if err:
        return err
    if not _data_write_ok(username, creation_id):
        return jsonify({"success": False, "error": "rate_limited"}), 429
    data = request.get_json(silent=True) or {}
    try:
        m = match_svc.create_match(creation_id=creation_id, community_id=community_id,
                                   challenger=username, opponent_handle=str(data.get("opponent") or ""))
    except Exception as e:
        return _match_fail(e)
    return jsonify({"success": True, "match": m})


@builder_bp.route("/api/builder/<int:creation_id>/match/<int:match_id>", methods=["GET"])
def builder_match_get(creation_id: int, match_id: int):
    username, community_id, err = _match_access(creation_id)
    if err:
        return err
    try:
        # Seat-authorized: no caller-context community filter (see _match_access).
        return jsonify({"success": True, "match": match_svc.get_match(
            match_id, username, creation_id=creation_id,
        )})
    except Exception as e:
        return _match_fail(e)


@builder_bp.route("/api/builder/<int:creation_id>/match/<int:match_id>/move", methods=["POST"])
def builder_match_move(creation_id: int, match_id: int):
    username, community_id, err = _match_access(creation_id)
    if err:
        return err
    if not _data_write_ok(username, creation_id):
        return jsonify({"success": False, "error": "rate_limited"}), 429
    data = request.get_json(silent=True) or {}
    try:
        res = match_svc.submit_move(match_id, username, move=data.get("move"), state=data.get("state"),
                                    expected_version=int(data.get("version") or 0), result=data.get("result"),
                                    creation_id=creation_id)
    except Exception as e:
        return _match_fail(e)
    return jsonify({"success": True, **res})


@builder_bp.route("/api/builder/<int:creation_id>/match/<int:match_id>/poll", methods=["GET"])
def builder_match_poll(creation_id: int, match_id: int):
    username, community_id, err = _match_access(creation_id)
    if err:
        return err
    try:
        since = int(request.args.get("since") or 0)
    except (TypeError, ValueError):
        since = 0
    try:
        return jsonify({"success": True, **match_svc.poll_match(
            match_id, username, since, creation_id=creation_id,
        )})
    except Exception as e:
        return _match_fail(e)


@builder_bp.route("/api/builder/<int:creation_id>/match/<int:match_id>/accept", methods=["POST"])
def builder_match_accept(creation_id: int, match_id: int):
    username, community_id, err = _match_access(creation_id)
    if err:
        return err
    try:
        return jsonify({"success": True, "match": match_svc.accept_match(
            match_id, username, creation_id=creation_id,
        )})
    except Exception as e:
        return _match_fail(e)


@builder_bp.route("/api/builder/<int:creation_id>/match/<int:match_id>/decline", methods=["POST"])
def builder_match_decline(creation_id: int, match_id: int):
    username, community_id, err = _match_access(creation_id)
    if err:
        return err
    try:
        return jsonify({"success": True, "match": match_svc.decline_match(
            match_id, username, creation_id=creation_id,
        )})
    except Exception as e:
        return _match_fail(e)


@builder_bp.route("/api/builder/<int:creation_id>/match/<int:match_id>/cancel", methods=["POST"])
def builder_match_cancel(creation_id: int, match_id: int):
    username, community_id, err = _match_access(creation_id)
    if err:
        return err
    try:
        return jsonify({"success": True, "match": match_svc.cancel_match(
            match_id, username, creation_id=creation_id,
        )})
    except Exception as e:
        return _match_fail(e)


@builder_bp.route("/api/builder/<int:creation_id>/match/<int:match_id>/resign", methods=["POST"])
def builder_match_resign(creation_id: int, match_id: int):
    username, community_id, err = _match_access(creation_id)
    if err:
        return err
    try:
        return jsonify({"success": True, "match": match_svc.resign_match(
            match_id, username, creation_id=creation_id,
        )})
    except Exception as e:
        return _match_fail(e)


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
        cache.delete(f"cpdata:summary:{creation_id}:{community_id}")
    except Exception:
        pass
    return jsonify({"success": True, **result})
