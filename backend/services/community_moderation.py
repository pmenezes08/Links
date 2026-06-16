"""Owner Dashboard — reported-content moderation, scoped to one community.

Community owners/admins review posts that members have flagged in *their*
community and either remove the content or keep it up. This mirrors the
app-admin report tooling in the monolith but scopes every query to a single
``community_id`` and is authorized per-community at the route boundary — an
owner of A can never see or act on reports in B.

Posts only for now (the ``post_reports`` table is post-scoped); comment/reply
reporting is a separate, not-yet-built pipeline. The reporter is never exposed
to the reported member (the existing report flow is silent).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

VALID_STATUS_FILTERS = ("pending", "reviewed", "dismissed", "all")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def list_reports(community_id: int, status_filter: str = "pending") -> Dict[str, Any]:
    """Reports for posts in ``community_id``, newest first. Aggregate-safe:
    returns an empty list on any error rather than 500-ing the dashboard."""
    status_filter = (status_filter or "pending").strip().lower()
    if status_filter not in VALID_STATUS_FILTERS:
        status_filter = "pending"

    reports = []
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            params: Tuple[Any, ...] = (community_id,)
            status_clause = ""
            if status_filter != "all":
                status_clause = f"AND r.status = {ph}"
                params = (community_id, status_filter)

            c.execute(
                f"""
                SELECT r.id AS report_id, r.post_id, r.reporter_username, r.reason,
                       r.details, r.status, r.reviewed_by, r.reviewed_at,
                       r.created_at AS reported_at,
                       p.username AS post_author, p.content AS post_content,
                       p.timestamp AS post_timestamp,
                       (SELECT COUNT(*) FROM post_reports pr WHERE pr.post_id = r.post_id) AS report_count
                FROM post_reports r
                JOIN posts p ON r.post_id = p.id
                WHERE p.community_id = {ph} {status_clause}
                ORDER BY r.created_at DESC
                """,
                params,
            )
            for row in c.fetchall() or []:
                d = dict(row) if hasattr(row, "keys") else {
                    "report_id": row[0], "post_id": row[1], "reporter_username": row[2],
                    "reason": row[3], "details": row[4], "status": row[5],
                    "reviewed_by": row[6], "reviewed_at": row[7], "reported_at": row[8],
                    "post_author": row[9], "post_content": row[10],
                    "post_timestamp": row[11], "report_count": row[12],
                }
                d["type"] = "post"  # forward-compat for when comments are reportable
                reports.append(d)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("list_reports failed for community %s: %s", community_id, exc)
        return {"success": True, "reports": []}

    return {"success": True, "reports": reports}


def _report_community_id(c, ph: str, report_id: int) -> Optional[int]:
    c.execute(
        f"""
        SELECT p.community_id
        FROM post_reports r JOIN posts p ON r.post_id = p.id
        WHERE r.id = {ph}
        """,
        (report_id,),
    )
    row = c.fetchone()
    if not row:
        return None
    cid = row["community_id"] if hasattr(row, "keys") else row[0]
    return int(cid) if cid is not None else None


def review_report(community_id: int, report_id: Any, action: str, reviewer: str) -> Tuple[Dict[str, Any], int]:
    """Dismiss or mark-reviewed a single report — only if its post is in this
    community (otherwise a non-enumerating 404)."""
    if not report_id:
        return {"success": False, "error": "report_id required"}, 400
    action = (action or "").strip().lower()
    if action not in ("dismiss", "reviewed", "dismissed"):
        return {"success": False, "error": "invalid action"}, 400
    new_status = "dismissed" if action == "dismiss" else "reviewed"

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            owner_cid = _report_community_id(c, ph, report_id)
            if owner_cid is None or owner_cid != int(community_id):
                return {"success": False, "error": "not_found"}, 404
            c.execute(
                f"""
                UPDATE post_reports
                SET status = {ph}, reviewed_by = {ph}, reviewed_at = {ph}
                WHERE id = {ph}
                """,
                (new_status, reviewer, _now(), report_id),
            )
            conn.commit()
    except Exception as exc:
        logger.error("review_report failed: %s", exc)
        return {"success": False, "error": "failed"}, 500
    return {"success": True, "status": new_status}, 200


def remove_reported_post(community_id: int, post_id: Any, reviewer: str) -> Tuple[Dict[str, Any], int]:
    """Delete a reported post (and its replies) and resolve its reports — only
    if the post belongs to this community."""
    if not post_id:
        return {"success": False, "error": "post_id required"}, 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(f"SELECT community_id FROM posts WHERE id = {ph}", (post_id,))
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "not_found"}, 404
            post_cid = row["community_id"] if hasattr(row, "keys") else row[0]
            if post_cid is None or int(post_cid) != int(community_id):
                return {"success": False, "error": "not_found"}, 404

            c.execute(
                f"""
                UPDATE post_reports
                SET status = 'reviewed', reviewed_by = {ph}, reviewed_at = {ph}
                WHERE post_id = {ph}
                """,
                (reviewer, _now(), post_id),
            )
            c.execute(f"DELETE FROM replies WHERE post_id = {ph}", (post_id,))
            c.execute(f"DELETE FROM posts WHERE id = {ph}", (post_id,))
            conn.commit()
    except Exception as exc:
        logger.error("remove_reported_post failed: %s", exc)
        return {"success": False, "error": "failed"}, 500

    # Best-effort feed-cache invalidation so the post disappears promptly; the
    # cache TTL covers us if the helper isn't importable.
    try:
        from bodybuilding_app import invalidate_community_cache
        invalidate_community_cache(community_id)
    except Exception:
        pass

    return {"success": True}, 200
