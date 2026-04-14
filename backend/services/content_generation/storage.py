"""Persistence helpers for Steve content generation jobs and runs."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from backend.services.database import get_db_connection


def _utc_now_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _json_dump(value: Any) -> Optional[str]:
    if value is None:
        return None
    return json.dumps(value)


def _json_load(raw: Any, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def ensure_tables() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS content_generation_jobs (
                id INT PRIMARY KEY AUTO_INCREMENT,
                idea_id VARCHAR(120) NOT NULL,
                title VARCHAR(191),
                target_type VARCHAR(32) NOT NULL,
                community_id INT NULL,
                target_username VARCHAR(191) NULL,
                delivery_channel VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'active',
                actor_username VARCHAR(191) NOT NULL,
                surface VARCHAR(32) NOT NULL DEFAULT 'community',
                payload_json TEXT NULL,
                schedule_json TEXT NULL,
                timezone VARCHAR(100) NULL,
                rrule TEXT NULL,
                next_run_at TEXT NULL,
                last_run_at TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS content_generation_runs (
                id INT PRIMARY KEY AUTO_INCREMENT,
                job_id INT NOT NULL,
                idea_id VARCHAR(120) NOT NULL,
                target_type VARCHAR(32) NOT NULL,
                community_id INT NULL,
                target_username VARCHAR(191) NULL,
                triggered_by_username VARCHAR(191) NOT NULL,
                delivery_channel VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'running',
                started_at TEXT NOT NULL,
                finished_at TEXT NULL,
                output_post_id INT NULL,
                output_message_id INT NULL,
                error TEXT NULL,
                source_links_json TEXT NULL,
                meta_json TEXT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_content_jobs_community ON content_generation_jobs (community_id, created_at)"
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_content_jobs_target_username ON content_generation_jobs (target_username, created_at)"
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_content_runs_job ON content_generation_runs (job_id, created_at)"
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_content_runs_community ON content_generation_runs (community_id, created_at)"
        )
        try:
            conn.commit()
        except Exception:
            pass


def _job_from_row(row: Any) -> Dict[str, Any]:
    data = dict(row) if hasattr(row, "keys") else {
        "id": row[0],
        "idea_id": row[1],
        "title": row[2],
        "target_type": row[3],
        "community_id": row[4],
        "target_username": row[5],
        "delivery_channel": row[6],
        "status": row[7],
        "actor_username": row[8],
        "surface": row[9],
        "payload_json": row[10],
        "schedule_json": row[11],
        "timezone": row[12],
        "rrule": row[13],
        "next_run_at": row[14],
        "last_run_at": row[15],
        "created_at": row[16],
        "updated_at": row[17],
    }
    data["payload"] = _json_load(data.pop("payload_json", None), {})
    data["schedule"] = _json_load(data.pop("schedule_json", None), {})
    return data


def _run_from_row(row: Any) -> Dict[str, Any]:
    data = dict(row) if hasattr(row, "keys") else {
        "id": row[0],
        "job_id": row[1],
        "idea_id": row[2],
        "target_type": row[3],
        "community_id": row[4],
        "target_username": row[5],
        "triggered_by_username": row[6],
        "delivery_channel": row[7],
        "status": row[8],
        "started_at": row[9],
        "finished_at": row[10],
        "output_post_id": row[11],
        "output_message_id": row[12],
        "error": row[13],
        "source_links_json": row[14],
        "meta_json": row[15],
        "created_at": row[16],
    }
    data["source_links"] = _json_load(data.pop("source_links_json", None), [])
    data["meta"] = _json_load(data.pop("meta_json", None), {})
    return data


def create_job(
    *,
    idea_id: str,
    title: str,
    target_type: str,
    community_id: Optional[int],
    target_username: Optional[str],
    delivery_channel: str,
    actor_username: str,
    surface: str,
    payload: Optional[Dict[str, Any]] = None,
    schedule: Optional[Dict[str, Any]] = None,
    timezone: Optional[str] = None,
    rrule: Optional[str] = None,
    next_run_at: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_tables()
    now = _utc_now_str()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO content_generation_jobs (
                idea_id, title, target_type, community_id, target_username,
                delivery_channel, status, actor_username, surface,
                payload_json, schedule_json, timezone, rrule, next_run_at,
                last_run_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, NULL, ?)
            """,
            (
                idea_id,
                title,
                target_type,
                community_id,
                target_username,
                delivery_channel,
                actor_username,
                surface,
                _json_dump(payload or {}),
                _json_dump(schedule or {}),
                timezone,
                rrule,
                next_run_at,
                now,
            ),
        )
        try:
            conn.commit()
        except Exception:
            pass
        job_id = c.lastrowid
    job = get_job(job_id)
    if not job:
        raise RuntimeError("Failed to create content generation job")
    return job


def get_job(job_id: int) -> Optional[Dict[str, Any]]:
    ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            SELECT id, idea_id, title, target_type, community_id, target_username,
                   delivery_channel, status, actor_username, surface,
                   payload_json, schedule_json, timezone, rrule, next_run_at,
                   last_run_at, created_at, updated_at
            FROM content_generation_jobs
            WHERE id = ?
            """,
            (job_id,),
        )
        row = c.fetchone()
    return _job_from_row(row) if row else None


def update_job(job_id: int, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    ensure_tables()
    field_map = {
        "title": "title",
        "status": "status",
        "payload": "payload_json",
        "schedule": "schedule_json",
        "timezone": "timezone",
        "rrule": "rrule",
        "next_run_at": "next_run_at",
    }
    assignments: List[str] = []
    params: List[Any] = []
    for key, column in field_map.items():
        if key not in updates:
            continue
        assignments.append(f"{column} = ?")
        value = updates[key]
        if key in {"payload", "schedule"}:
            value = _json_dump(value or {})
        params.append(value)
    if not assignments:
        return get_job(job_id)
    assignments.append("updated_at = ?")
    params.append(_utc_now_str())
    params.append(job_id)
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE content_generation_jobs SET {', '.join(assignments)} WHERE id = ?",
            tuple(params),
        )
        try:
            conn.commit()
        except Exception:
            pass
    return get_job(job_id)


def list_jobs(*, community_id: Optional[int] = None, include_all: bool = False) -> List[Dict[str, Any]]:
    ensure_tables()
    query = """
        SELECT id, idea_id, title, target_type, community_id, target_username,
               delivery_channel, status, actor_username, surface,
               payload_json, schedule_json, timezone, rrule, next_run_at,
               last_run_at, created_at, updated_at
        FROM content_generation_jobs
    """
    params: List[Any] = []
    if not include_all and community_id is not None:
        query += " WHERE community_id = ?"
        params.append(community_id)
    query += " ORDER BY updated_at DESC, id DESC"
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(query, tuple(params))
        rows = c.fetchall() or []
    return [_job_from_row(row) for row in rows]


def create_run(job: Dict[str, Any], triggered_by_username: str) -> int:
    ensure_tables()
    now = _utc_now_str()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO content_generation_runs (
                job_id, idea_id, target_type, community_id, target_username,
                triggered_by_username, delivery_channel, status, started_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)
            """,
            (
                job["id"],
                job["idea_id"],
                job["target_type"],
                job.get("community_id"),
                job.get("target_username"),
                triggered_by_username,
                job["delivery_channel"],
                now,
            ),
        )
        try:
            conn.commit()
        except Exception:
            pass
        return c.lastrowid


def finish_run(
    run_id: int,
    *,
    job_id: int,
    status: str,
    output_post_id: Optional[int] = None,
    output_message_id: Optional[int] = None,
    error: Optional[str] = None,
    source_links: Optional[Iterable[str]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    ensure_tables()
    finished_at = _utc_now_str()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            UPDATE content_generation_runs
            SET status = ?, finished_at = ?, output_post_id = ?, output_message_id = ?,
                error = ?, source_links_json = ?, meta_json = ?
            WHERE id = ?
            """,
            (
                status,
                finished_at,
                output_post_id,
                output_message_id,
                error,
                _json_dump(list(source_links or [])),
                _json_dump(meta or {}),
                run_id,
            ),
        )
        c.execute(
            """
            UPDATE content_generation_jobs
            SET last_run_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (finished_at, finished_at, job_id),
        )
        try:
            conn.commit()
        except Exception:
            pass


def list_runs(
    *,
    community_id: Optional[int] = None,
    include_all: bool = False,
    limit: int = 30,
) -> List[Dict[str, Any]]:
    ensure_tables()
    query = """
        SELECT id, job_id, idea_id, target_type, community_id, target_username,
               triggered_by_username, delivery_channel, status, started_at,
               finished_at, output_post_id, output_message_id, error,
               source_links_json, meta_json, created_at
        FROM content_generation_runs
    """
    params: List[Any] = []
    if not include_all and community_id is not None:
        query += " WHERE community_id = ?"
        params.append(community_id)
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(query, tuple(params))
        rows = c.fetchall() or []
    return [_run_from_row(row) for row in rows]

