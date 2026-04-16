"""Content generation APIs for Steve jobs and runs."""

from __future__ import annotations

import logging
from functools import wraps
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request, session
import os

from backend.services.content_generation import (
    create_job,
    delete_all_jobs,
    delete_all_runs,
    delete_job,
    delete_jobs_for_community,
    delete_run,
    delete_runs_for_community,
    ensure_tables,
    execute_job,
    get_descriptor,
    get_due_jobs,
    get_job,
    get_run,
    list_ideas,
    list_jobs,
    list_runs,
    update_job,
    update_job_next_run,
)
from backend.services.steve_content_enrichment import fetch_article_for_reader
from backend.services.content_generation.job_schedule import compute_schedule_timestamps
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


def _schedule_payload_from_request(
    data: Dict[str, Any],
) -> tuple[Dict[str, Any], Optional[str], str, Optional[str]]:
    """Normalize schedule, rrule, next_run_at, ends_at (UTC strings)."""
    schedule = data.get("schedule") if isinstance(data.get("schedule"), dict) else {}
    timezone = str(data.get("timezone") or schedule.get("timezone") or "").strip() or None
    sched_norm, rrule, next_run_at, ends_at = compute_schedule_timestamps(schedule, timezone)
    return sched_norm, rrule, next_run_at, ends_at


def _schedule_payload_from_update(
    job: Dict[str, Any],
    data: Dict[str, Any],
) -> tuple[Dict[str, Any], Optional[str], str, Optional[str]]:
    schedule = dict(job.get("schedule") or {})
    if isinstance(data.get("schedule"), dict):
        schedule.update(data["schedule"])
    timezone = str(
        data.get("timezone") if "timezone" in data else job.get("timezone") or schedule.get("timezone") or ""
    ).strip() or None
    return compute_schedule_timestamps(schedule, timezone)


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


def _run_accessible(username: str, run: Dict[str, Any]) -> bool:
    cid = run.get("community_id")
    if cid:
        return can_manage_community_jobs(username, int(cid))
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
        sched_norm, rrule, next_run_at, ends_at = _schedule_payload_from_request(data)
        timezone = str(data.get("timezone") or sched_norm.get("timezone") or "").strip() or None
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
            schedule=sched_norm,
            timezone=timezone,
            rrule=rrule,
            next_run_at=next_run_at,
            ends_at=ends_at,
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
    if "schedule" in data or "timezone" in data:
        try:
            sched_norm, rrule, next_run, ends_at = _schedule_payload_from_update(job, data)
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400
        updates["schedule"] = sched_norm
        updates["rrule"] = rrule
        updates["next_run_at"] = next_run
        updates["ends_at"] = ends_at
        tz = str(data.get("timezone") or sched_norm.get("timezone") or "").strip() or None
        if tz is not None:
            updates["timezone"] = tz
    updated = update_job(job_id, updates)
    return jsonify({"success": True, "job": updated})


@content_generation_bp.route("/api/content-generation/jobs/<int:job_id>", methods=["DELETE"])
@_login_required
def delete_content_generation_job_api(job_id: int):
    ensure_tables()
    username = session["username"]
    job = get_job(job_id)
    if not job:
        return jsonify({"success": False, "error": "Job not found"}), 404
    if not _job_accessible(username, job):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    if not delete_job(job_id):
        return jsonify({"success": False, "error": "Failed to delete job"}), 500
    return jsonify({"success": True})


@content_generation_bp.route("/api/content-generation/runs/<int:run_id>", methods=["DELETE"])
@_login_required
def delete_content_generation_run_api(run_id: int):
    ensure_tables()
    username = session["username"]
    run = get_run(run_id)
    if not run:
        return jsonify({"success": False, "error": "Run not found"}), 404
    if not _run_accessible(username, run):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    if not delete_run(run_id):
        return jsonify({"success": False, "error": "Run not found"}), 404
    return jsonify({"success": True})


@content_generation_bp.route("/api/content-generation/jobs", methods=["DELETE"])
@_login_required
def delete_content_generation_jobs_bulk_api():
    """DELETE ?community_id=N&all=1 removes all saved jobs for that community (run history kept)."""
    ensure_tables()
    username = session["username"]
    community_id = request.args.get("community_id", type=int)
    delete_all = str(request.args.get("all") or "").strip().lower() in {"1", "true", "yes"}
    if not community_id or not delete_all:
        return jsonify({"success": False, "error": "community_id and all=1 are required"}), 400
    if not can_manage_community_jobs(username, community_id):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    removed = delete_jobs_for_community(community_id)
    return jsonify({"success": True, "removed": removed})


@content_generation_bp.route("/api/content-generation/runs", methods=["DELETE"])
@_login_required
def delete_content_generation_runs_bulk_api():
    """DELETE ?community_id=N&all=1 removes all run history for that community."""
    ensure_tables()
    username = session["username"]
    community_id = request.args.get("community_id", type=int)
    delete_all = str(request.args.get("all") or "").strip().lower() in {"1", "true", "yes"}
    if not community_id or not delete_all:
        return jsonify({"success": False, "error": "community_id and all=1 are required"}), 400
    if not can_manage_community_jobs(username, community_id):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    removed = delete_runs_for_community(community_id)
    return jsonify({"success": True, "removed": removed})


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
        sched_norm, rrule, next_run_at, ends_at = _schedule_payload_from_request(data)
        timezone = str(data.get("timezone") or sched_norm.get("timezone") or "").strip() or None
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
                        schedule=sched_norm,
                        timezone=timezone,
                        rrule=rrule,
                        next_run_at=next_run_at,
                        ends_at=ends_at,
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
                    schedule=sched_norm,
                    timezone=timezone,
                    rrule=rrule,
                    next_run_at=next_run_at,
                    ends_at=ends_at,
                )
            )
        return jsonify({"success": True, "jobs": created_jobs})
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        logger.error("Admin failed to create content generation jobs: %s", exc, exc_info=True)
        return jsonify({"success": False, "error": "Failed to create jobs"}), 500


@content_generation_bp.route("/api/admin/content-generation/jobs", methods=["DELETE"])
@_login_required
def admin_delete_all_content_generation_jobs_api():
    ensure_tables()
    username = session["username"]
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    delete_all = str(request.args.get("all") or "").strip().lower() in {"1", "true", "yes"}
    if not delete_all:
        return jsonify({"success": False, "error": "all=1 is required"}), 400
    delete_all_jobs()
    return jsonify({"success": True})


@content_generation_bp.route("/api/admin/content-generation/jobs/<int:job_id>", methods=["DELETE"])
@_login_required
def admin_delete_content_generation_job_api(job_id: int):
    ensure_tables()
    username = session["username"]
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    job = get_job(job_id)
    if not job:
        return jsonify({"success": False, "error": "Job not found"}), 404
    if not delete_job(job_id):
        return jsonify({"success": False, "error": "Failed to delete job"}), 500
    return jsonify({"success": True})


@content_generation_bp.route("/api/admin/content-generation/runs/<int:run_id>", methods=["DELETE"])
@_login_required
def admin_delete_content_generation_run_api(run_id: int):
    ensure_tables()
    username = session["username"]
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    if not delete_run(run_id):
        return jsonify({"success": False, "error": "Run not found"}), 404
    return jsonify({"success": True})


@content_generation_bp.route("/api/admin/content-generation/runs", methods=["DELETE"])
@_login_required
def admin_delete_content_generation_runs_bulk_api():
    ensure_tables()
    username = session["username"]
    if not is_app_admin(username):
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    community_id = request.args.get("community_id", type=int)
    delete_all = str(request.args.get("all") or "").strip().lower() in {"1", "true", "yes"}
    if community_id:
        removed = delete_runs_for_community(community_id)
        return jsonify({"success": True, "removed": removed})
    if delete_all:
        removed = delete_all_runs()
        return jsonify({"success": True, "removed": removed})
    return jsonify({"success": False, "error": "Use all=1 or community_id=N"}), 400


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


@content_generation_bp.route("/api/content-generation/cron/process-due-jobs", methods=["POST"])
def api_process_due_content_generation_jobs():
    """Cron job endpoint to process due content generation jobs (roundups, etc.) based on user-chosen cadence.
    Protected by X-API-Key like poll_notification_check. Updates next_run_at after execution.
    Deploy as a cron job (e.g. every 5-15 minutes).
    """
    api_key = request.headers.get("X-API-Key") or request.form.get("api_key")
    expected_key = os.getenv("CONTENT_GENERATION_CRON_API_KEY")

    if expected_key and api_key != expected_key:
        logger.warning("Content generation due-jobs cron called with invalid API key: %s", api_key)
        return jsonify({"success": False, "error": "Invalid API key"}), 401

    try:
        due_jobs = get_due_jobs(limit=5)
        processed = 0
        for job in due_jobs:
            try:
                cadence = str((job.get("schedule") or {}).get("cadence") or "").strip().lower()
                result = execute_job(job, triggered_by_username="system-cron")
                update_job_next_run(job["id"], cadence)
                processed += 1
                logger.info("Processed due job %s (%s): %s", job.get("id"), cadence, result.get("status"))
            except Exception as job_err:
                logger.error("Failed to process due job %s: %s", job.get("id"), job_err, exc_info=True)
        return jsonify({"success": True, "processed": processed, "due": len(due_jobs)})
    except Exception as exc:
        logger.error("Due jobs cron error: %s", exc, exc_info=True)
        return jsonify({"success": False, "error": str(exc)}), 500


@content_generation_bp.route("/api/articles/read", methods=["GET"])
def api_read_article():
    """Proxy endpoint for in-platform article reader. Reuses trafilatura parsing with Redis caching.
    Returns clean text suitable for modal display. URL must be provided as query param.
    """
    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"success": False, "error": "url query parameter is required"}), 400
    if not url.startswith(("http://", "https://")):
        return jsonify({"success": False, "error": "Invalid URL"}), 400

    try:
        result = fetch_article_for_reader(url)
        return jsonify({"success": True, **result})
    except Exception as exc:
        logger.error("Article reader API failed for %s: %s", url, exc, exc_info=True)
        return jsonify({"success": False, "error": "Failed to fetch article"}), 500

