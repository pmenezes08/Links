"""Content generation APIs for Steve jobs and runs."""

from __future__ import annotations

import logging
from functools import wraps
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request, session

from backend.services.content_generation import (
    create_job,
    ensure_tables,
    execute_job,
    get_descriptor,
    get_job,
    list_ideas,
    list_jobs,
    list_runs,
    update_job,
)
from backend.services.content_generation.permissions import (
    can_manage_community_jobs,
    can_manage_member_jobs,
    is_app_admin,
)
from backend.services.database import get_db_connection


content_generation_bp = Blueprint("content_generation", __name__)
logger = logging.getLogger(__name__)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        return view_func(*args, **kwargs)

    return wrapper


def _body_json() -> Dict[str, Any]:
    return request.get_json(silent=True) or {}


def _build_rrule(schedule: Dict[str, Any]) -> Optional[str]:
    if not schedule:
        return None
    cadence = str(schedule.get("cadence") or "").strip().lower()
    weekday = str(schedule.get("weekday") or "").strip().upper()
    week_of_month = str(schedule.get("week_of_month") or "").strip()
    if cadence == "weekly" and weekday:
        return f"FREQ=WEEKLY;BYDAY={weekday}"
    if cadence == "monthly" and weekday and week_of_month:
        return f"FREQ=MONTHLY;BYDAY={weekday};BYSETPOS={week_of_month}"
    return None


def _default_job_title(descriptor, payload: Dict[str, Any], *, community_id: Optional[int], target_username: Optional[str]) -> str:
    topic_mode = str(payload.get("topic_mode") or "manual").strip().lower()
    topic = str(payload.get("topic") or "").strip()
    if topic:
        return f"{descriptor.title}: {topic}"
    if topic_mode == "auto":
        topic_seed = str(payload.get("topic_seed") or "").strip()
        return f"{descriptor.title}: auto{f' ({topic_seed})' if topic_seed else ''}"
    if target_username:
        return f"{descriptor.title}: @{target_username}"
    if community_id:
        return f"{descriptor.title}: community {community_id}"
    return descriptor.title


def _job_accessible(username: str, job: Dict[str, Any]) -> bool:
    if job["target_type"] == "community":
        return can_manage_community_jobs(username, int(job.get("community_id") or 0))
    return can_manage_member_jobs(username)


def _community_exists(community_id: int) -> bool:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("SELECT 1 FROM communities WHERE id = ?", (community_id,))
        return c.fetchone() is not None


def _user_exists(username: str) -> bool:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)", (username,))
        return c.fetchone() is not None


def _payload_for_create(data: Dict[str, Any], descriptor) -> Dict[str, Any]:
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    normalized = {
        str(key): value.strip() if isinstance(value, str) else value
        for key, value in payload.items()
    }

    if descriptor.idea_id in {"public_news_roundup", "public_opinion_roundup"}:
        topic_mode = str(normalized.get("topic_mode") or "manual").strip().lower() or "manual"
        if topic_mode not in {"manual", "auto"}:
            raise ValueError("Topic mode must be manual or auto")
        normalized["topic_mode"] = topic_mode
        normalized["topic"] = str(normalized.get("topic") or "").strip()
        normalized["topic_seed"] = str(normalized.get("topic_seed") or "").strip()
        community_context_enabled = normalized.get("community_context_enabled")
        if community_context_enabled in (None, ""):
            normalized["community_context_enabled"] = "true"
        else:
            normalized["community_context_enabled"] = (
                "false"
                if str(community_context_enabled).strip().lower() in {"0", "false", "no", "off"}
                else "true"
            )
        if topic_mode == "manual" and not normalized["topic"]:
            raise ValueError("Topic is required when topic mode is manual")

    if "target_username" in normalized:
        normalized["target_username"] = str(normalized.get("target_username") or "").strip()

    for field in descriptor.payload_fields:
        if field.name == "target_username":
            continue
        if field.required and not str(normalized.get(field.name) or "").strip():
            raise ValueError(f"{field.label} is required")
    return normalized


@content_generation_bp.route("/api/content-generation/ideas", methods=["GET"])
@_login_required
def content_generation_ideas_api():
    ensure_tables()
    surface = (request.args.get("surface") or "").strip().lower() or None
    target_type = (request.args.get("target_type") or "").strip().lower() or None
    return jsonify({"success": True, "ideas": list_ideas(surface=surface, target_type=target_type)})


@content_generation_bp.route("/api/content-generation/jobs", methods=["GET"])
@_login_required
def content_generation_jobs_api():
    ensure_tables()
    username = session["username"]
    community_id = request.args.get("community_id", type=int)
    if not community_id:
        return jsonify({"success": False, "error": "community_id is required"}), 400
    if not can_manage_community_jobs(username, community_id):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    return jsonify(
        {
            "success": True,
            "jobs": list_jobs(community_id=community_id),
            "runs": list_runs(community_id=community_id, limit=25),
        }
    )


@content_generation_bp.route("/api/content-generation/runs", methods=["GET"])
@_login_required
def content_generation_runs_api():
    ensure_tables()
    username = session["username"]
    community_id = request.args.get("community_id", type=int)
    if not community_id:
        return jsonify({"success": False, "error": "community_id is required"}), 400
    if not can_manage_community_jobs(username, community_id):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    return jsonify({"success": True, "runs": list_runs(community_id=community_id, limit=50)})


@content_generation_bp.route("/api/content-generation/jobs", methods=["POST"])
@_login_required
def create_content_generation_job_api():
    ensure_tables()
    username = session["username"]
    data = _body_json()
    idea_id = str(data.get("idea_id") or "").strip()
    community_id = int(data.get("community_id") or 0)
    if not idea_id or not community_id:
        return jsonify({"success": False, "error": "idea_id and community_id are required"}), 400
    if not can_manage_community_jobs(username, community_id):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    descriptor = get_descriptor(idea_id)
    if descriptor.target_type != "community":
        return jsonify({"success": False, "error": "This idea is not available for community jobs"}), 400
    if not _community_exists(community_id):
        return jsonify({"success": False, "error": "Community not found"}), 404
    try:
        payload = _payload_for_create(data, descriptor)
        target_username = str(payload.get("target_username") or "").strip() or None
        schedule = data.get("schedule") if isinstance(data.get("schedule"), dict) else {}
        timezone = str(data.get("timezone") or schedule.get("timezone") or "").strip() or None
        job = create_job(
            idea_id=idea_id,
            title=str(data.get("title") or "").strip() or _default_job_title(descriptor, payload, community_id=community_id, target_username=target_username),
            target_type=descriptor.target_type,
            community_id=community_id,
            target_username=target_username,
            delivery_channel=descriptor.delivery_channel,
            actor_username=username,
            surface="community",
            payload=payload,
            schedule=schedule,
            timezone=timezone,
            rrule=str(data.get("rrule") or "").strip() or _build_rrule(schedule),
            next_run_at=str(data.get("next_run_at") or "").strip() or None,
        )
        return jsonify({"success": True, "job": job})
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.error("Failed to create content generation job: %s", exc, exc_info=True)
        return jsonify({"success": False, "error": "Failed to create job"}), 500


@content_generation_bp.route("/api/content-generation/jobs/<int:job_id>", methods=["PATCH"])
@_login_required
def update_content_generation_job_api(job_id: int):
    ensure_tables()
    username = session["username"]
    job = get_job(job_id)
    if not job:
        return jsonify({"success": False, "error": "Job not found"}), 404
    if not _job_accessible(username, job):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    data = _body_json()
    updates: Dict[str, Any] = {}
    for key in ("title", "status", "payload", "schedule", "timezone", "rrule", "next_run_at"):
        if key in data:
            updates[key] = data[key]
    if "payload" in updates:
        descriptor = get_descriptor(job["idea_id"])
        updates["payload"] = _payload_for_create({"payload": updates["payload"]}, descriptor)
    if "schedule" in updates and "rrule" not in updates:
        updates["rrule"] = _build_rrule(updates["schedule"] or {})
    updated = update_job(job_id, updates)
    return jsonify({"success": True, "job": updated})


@content_generation_bp.route("/api/content-generation/jobs/<int:job_id>/run", methods=["POST"])
@_login_required
def run_content_generation_job_api(job_id: int):
    ensure_tables()
    username = session["username"]
    job = get_job(job_id)
    if not job:
        return jsonify({"success": False, "error": "Job not found"}), 404
    if not _job_accessible(username, job):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    try:
        result = execute_job(job, triggered_by_username=username)
        return jsonify({"success": True, **result})
    except Exception as exc:
        logger.error("Failed to execute content generation job %s: %s", job_id, exc, exc_info=True)
        return jsonify({"success": False, "error": str(exc)}), 500


@content_generation_bp.route("/api/admin/content-generation/jobs", methods=["GET"])
@_login_required
def admin_content_generation_jobs_api():
    ensure_tables()
    username = session["username"]
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    return jsonify({"success": True, "jobs": list_jobs(include_all=True)})


@content_generation_bp.route("/api/admin/content-generation/runs", methods=["GET"])
@_login_required
def admin_content_generation_runs_api():
    ensure_tables()
    username = session["username"]
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    limit = request.args.get("limit", default=60, type=int) or 60
    return jsonify({"success": True, "runs": list_runs(include_all=True, limit=max(1, min(limit, 200)))})


@content_generation_bp.route("/api/admin/content-generation/jobs", methods=["POST"])
@_login_required
def admin_create_content_generation_jobs_api():
    ensure_tables()
    username = session["username"]
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Unauthorized"}), 403

    data = _body_json()
    idea_id = str(data.get("idea_id") or "").strip()
    if not idea_id:
        return jsonify({"success": False, "error": "idea_id is required"}), 400
    descriptor = get_descriptor(idea_id)
    try:
        payload = _payload_for_create(data, descriptor)
        schedule = data.get("schedule") if isinstance(data.get("schedule"), dict) else {}
        timezone = str(data.get("timezone") or schedule.get("timezone") or "").strip() or None
        created_jobs: List[Dict[str, Any]] = []
        if descriptor.target_type == "community":
            community_ids = data.get("community_ids")
            if not isinstance(community_ids, list):
                community_ids = [data.get("community_id")] if data.get("community_id") is not None else []
            cleaned_ids = [int(value) for value in community_ids if str(value).strip()]
            if not cleaned_ids:
                return jsonify({"success": False, "error": "At least one community_id is required"}), 400
            for community_id in cleaned_ids:
                if not _community_exists(community_id):
                    return jsonify({"success": False, "error": f"Community {community_id} not found"}), 404
                target_username = str(payload.get("target_username") or "").strip() or None
                created_jobs.append(
                    create_job(
                        idea_id=idea_id,
                        title=str(data.get("title") or "").strip() or _default_job_title(descriptor, payload, community_id=community_id, target_username=target_username),
                        target_type=descriptor.target_type,
                        community_id=community_id,
                        target_username=target_username,
                        delivery_channel=descriptor.delivery_channel,
                        actor_username=username,
                        surface="admin",
                        payload=payload,
                        schedule=schedule,
                        timezone=timezone,
                        rrule=str(data.get("rrule") or "").strip() or _build_rrule(schedule),
                        next_run_at=str(data.get("next_run_at") or "").strip() or None,
                    )
                )
        else:
            target_username = str(data.get("target_username") or payload.get("target_username") or "").strip()
            if not target_username:
                return jsonify({"success": False, "error": "target_username is required"}), 400
            if not _user_exists(target_username):
                return jsonify({"success": False, "error": "Target user not found"}), 404
            payload["target_username"] = target_username
            created_jobs.append(
                create_job(
                    idea_id=idea_id,
                    title=str(data.get("title") or "").strip() or _default_job_title(descriptor, payload, community_id=None, target_username=target_username),
                    target_type=descriptor.target_type,
                    community_id=None,
                    target_username=target_username,
                    delivery_channel=descriptor.delivery_channel,
                    actor_username=username,
                    surface="admin",
                    payload=payload,
                    schedule=schedule,
                    timezone=timezone,
                    rrule=str(data.get("rrule") or "").strip() or _build_rrule(schedule),
                    next_run_at=str(data.get("next_run_at") or "").strip() or None,
                )
            )
        return jsonify({"success": True, "jobs": created_jobs})
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.error("Admin failed to create content generation jobs: %s", exc, exc_info=True)
        return jsonify({"success": False, "error": "Failed to create jobs"}), 500


@content_generation_bp.route("/api/admin/content-generation/jobs/<int:job_id>/run", methods=["POST"])
@_login_required
def admin_run_content_generation_job_api(job_id: int):
    ensure_tables()
    username = session["username"]
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    job = get_job(job_id)
    if not job:
        return jsonify({"success": False, "error": "Job not found"}), 404
    try:
        result = execute_job(job, triggered_by_username=username)
        return jsonify({"success": True, **result})
    except Exception as exc:
        logger.error("Admin failed to execute content generation job %s: %s", job_id, exc, exc_info=True)
        return jsonify({"success": False, "error": str(exc)}), 500

