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
from typing import Any, Dict, List, Optional, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

VALID_STATUS_FILTERS = ("pending", "reviewed", "dismissed", "all")

# reporter_username value for wordlist auto-flags (see auto_flag_content_if_needed
# in the monolith). Surfaces render these with a distinct "auto-flagged" badge.
SYSTEM_REPORTER = "system"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def ensure_post_reports_table(use_mysql: bool = True) -> None:
    """Create ``post_reports`` if missing. Called once at startup — the DDL
    used to live inline in the report request handler, which would have
    masked any future schema migration on a fresh environment."""
    mysql_ddl = """CREATE TABLE IF NOT EXISTS post_reports
                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                  post_id INTEGER NOT NULL,
                  reporter_username VARCHAR(191) NOT NULL,
                  reason TEXT NOT NULL,
                  details TEXT,
                  status VARCHAR(50) DEFAULT 'pending',
                  reviewed_by VARCHAR(191),
                  reviewed_at TIMESTAMP NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE KEY unique_report (post_id, reporter_username))"""
    sqlite_ddl = """CREATE TABLE IF NOT EXISTS post_reports
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  post_id INTEGER NOT NULL,
                  reporter_username TEXT NOT NULL,
                  reason TEXT NOT NULL,
                  details TEXT,
                  status TEXT DEFAULT 'pending',
                  reviewed_by TEXT,
                  reviewed_at TIMESTAMP NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE(post_id, reporter_username))"""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(mysql_ddl if use_mysql else sqlite_ddl)
            conn.commit()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("ensure_post_reports_table failed: %s", exc)


def _community_moderators(c, ph: str, community_id: int) -> List[str]:
    """Usernames who moderate ``community_id``: the owner plus delegated
    admins (``user_communities.role`` and the legacy ``community_admins``
    table — the same sources ``is_community_admin`` checks). Lowercase-deduped;
    the platform ``admin`` account is excluded (app-admins keep their own
    global notification path)."""
    recipients: Dict[str, str] = {}

    def _add(name: Optional[str]) -> None:
        name = (name or "").strip()
        key = name.lower()
        if name and key != "admin" and key not in recipients:
            recipients[key] = name

    c.execute(f"SELECT creator_username FROM communities WHERE id = {ph}", (community_id,))
    row = c.fetchone()
    if row:
        _add(row["creator_username"] if hasattr(row, "keys") else row[0])

    try:
        c.execute(
            f"""
            SELECT u.username FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            WHERE uc.community_id = {ph}
              AND LOWER(COALESCE(uc.role, '')) IN ('admin', 'owner', 'moderator', 'manager')
            """,
            (community_id,),
        )
        for r in c.fetchall() or []:
            _add(r["username"] if hasattr(r, "keys") else r[0])
    except Exception:
        pass

    try:
        c.execute(f"SELECT username FROM community_admins WHERE community_id = {ph}", (community_id,))
        for r in c.fetchall() or []:
            _add(r["username"] if hasattr(r, "keys") else r[0])
    except Exception:
        pass

    return list(recipients.values())


def notify_moderators_of_report(
    community_id: Optional[int],
    post_id: Any,
    reporter_username: str,
    post_author: str,
    *,
    system: bool = False,
) -> int:
    """Tell the community's moderators a report landed in their queue.

    Push + in-app row per recipient, each in the recipient's own locale,
    deep-linking to the Owner Dashboard Reports tab. The reporter and the
    reported author never receive it (the report flow stays silent toward
    the author; the reporter gets the synchronous confirmation instead).
    Best-effort: returns how many moderators were notified, never raises.
    """
    if not community_id:
        return 0
    sent = 0
    try:
        from backend.services import notification_copy
        from backend.services.notifications import create_notification, send_push_to_user

        skip = {(reporter_username or "").strip().lower(), (post_author or "").strip().lower()}
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            moderators = _community_moderators(c, ph, int(community_id))
            c.execute(f"SELECT name FROM communities WHERE id = {ph}", (community_id,))
            row = c.fetchone()
            community_name = (row["name"] if hasattr(row, "keys") else row[0]) if row else ""

        event = "owner_report_auto" if system else "owner_report"
        url = f"/community/{int(community_id)}/owner?tab=reports"
        for moderator in moderators:
            if moderator.strip().lower() in skip:
                continue
            try:
                locale = notification_copy.recipient_locale(moderator)
                payload = notification_copy.push_payload(event, locale, community=community_name)
                send_push_to_user(moderator, {
                    "title": payload["title"],
                    "body": payload["body"],
                    "url": url,
                    "tag": f"owner-report-{community_id}-{post_id}",
                })
                create_notification(
                    user_id=moderator,
                    from_user=SYSTEM_REPORTER if system else reporter_username,
                    notification_type="owner_report",
                    post_id=post_id,
                    community_id=community_id,
                    message=notification_copy.in_app_text(event, locale, community=community_name),
                    link=url,
                )
                sent += 1
            except Exception as exc:
                logger.warning("owner report notify failed for %s: %s", moderator, exc)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("notify_moderators_of_report failed for community %s: %s", community_id, exc)
    return sent


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
            # Only act on a still-pending row. The app-admin queue reads the
            # same table; when the other surface resolved it first, report
            # that instead of silently overwriting their decision.
            c.execute(
                f"""
                UPDATE post_reports
                SET status = {ph}, reviewed_by = {ph}, reviewed_at = {ph}
                WHERE id = {ph} AND status = 'pending'
                """,
                (new_status, reviewer, _now(), report_id),
            )
            if getattr(c, "rowcount", 1) == 0:
                c.execute(f"SELECT status, reviewed_by FROM post_reports WHERE id = {ph}", (report_id,))
                row = c.fetchone()
                current = (row["status"] if hasattr(row, "keys") else row[0]) if row else "reviewed"
                resolved_by = (row["reviewed_by"] if hasattr(row, "keys") else row[1]) if row else None
                return {"success": True, "already_resolved": True, "status": current,
                        "reviewed_by": resolved_by}, 200
            conn.commit()
    except Exception as exc:
        logger.error("review_report failed: %s", exc)
        return {"success": False, "error": "failed"}, 500
    return {"success": True, "status": new_status}, 200


def remove_reported_post(community_id: int, post_id: Any, reviewer: str) -> Tuple[Dict[str, Any], int]:
    """Delete a reported post and resolve its reports — only if the post
    belongs to this community. The deletion itself runs through the shared
    :func:`post_deletion.delete_post_cascade` so moderation removals clean up
    everything a normal delete does (views, imagine jobs, media, caches)."""
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
    except Exception as exc:
        logger.error("remove_reported_post scope check failed: %s", exc)
        return {"success": False, "error": "failed"}, 500

    from backend.services.post_deletion import delete_post_cascade

    payload, status = delete_post_cascade(int(post_id), actor=reviewer, resolve_reports=True)
    if not payload.get("success"):
        # Non-enumerating: whatever the cascade hit (lock, race-deleted), the
        # moderator just sees the action fail; the welcome-lock message is
        # safe to surface since the viewer already manages this community.
        if status == 403:
            return {"success": False, "error": payload.get("message") or "locked"}, 403
        return {"success": False, "error": "not_found" if status == 404 else "failed"}, status
    return {"success": True}, 200
