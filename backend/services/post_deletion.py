"""Canonical post-deletion cascade, shared by every delete path.

A community post is referenced by more than the ``posts`` row: replies
(and their ``reply_reactions``), ``reactions``, ``post_views`` analytics,
key-post markers (``community_key_posts`` / ``key_posts``, whose restricting
foreign keys block the delete outright), ``notifications`` rows linking to
the post, pending ``imagine_jobs``, its reports, media on disk or in R2, and
two caches (community feed + post detail). The reaction tables matter even
though prod's hand-migrated FKs cascade: the code DDL (fresh installs)
declares those FKs *without* ON DELETE CASCADE, so relying on the database
to clean them up is a latent MySQL 1451 on any new environment. Historically
the monolith's ``delete_post`` did the full cleanup while the app-admin and
owner-moderation paths did lighter, divergent subsets — orphaning views,
jobs, and media. Every deletion now funnels through
:func:`delete_post_cascade` so the cascade can't drift again.

Authorization is the CALLER's job: routes check permission (author /
community owner-admin / app-admin) or community scope before calling in.
The service only enforces the Steve welcome-post delete-lock, which is a
product rule rather than a permission.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

# imagine_jobs status literals (the monolith's IMAGINE_STATUS_* constants are
# monolith-scoped; these mirror them and must stay in sync with the table's
# vocabulary: pending / processing / error).
_IMAGINE_PENDING = "pending"
_IMAGINE_PROCESSING = "processing"
_IMAGINE_ERROR = "error"

# Kept verbatim from the monolith so the /delete_post API response is
# byte-identical after the refactor.
WELCOME_LOCK_MESSAGE = (
    "Steve's welcome post is locked from delete for the first 7 days. "
    "You can delete it after that if you'd rather."
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _fetch_post(c, ph: str, post_id: int) -> Optional[Dict[str, Any]]:
    """Post row as a dict, tolerating environments where ``is_system_post``
    hasn't been backfilled yet (falls back to the legacy projection)."""
    try:
        c.execute(
            f"SELECT username, image_path, video_path, community_id, is_system_post, timestamp "
            f"FROM posts WHERE id = {ph}",
            (post_id,),
        )
        row = c.fetchone()
    except Exception:
        c.execute(
            f"SELECT username, image_path, video_path, community_id FROM posts WHERE id = {ph}",
            (post_id,),
        )
        row = c.fetchone()
    if not row:
        return None
    if hasattr(row, "keys"):
        return dict(row)
    d = {
        "username": row[0],
        "image_path": row[1],
        "video_path": row[2],
        "community_id": row[3],
    }
    if len(row) > 4:
        d["is_system_post"] = row[4]
        d["timestamp"] = row[5]
    return d


def _r2_key_for(path: str) -> Optional[str]:
    """Derive the R2 object key from a stored media path, or None if the
    path isn't recognizably an R2 upload."""
    try:
        from backend.services.r2_storage import R2_ENABLED, R2_PUBLIC_URL, is_r2_url

        if not R2_ENABLED or not path:
            return None
        if is_r2_url(path):
            key = path[len(R2_PUBLIC_URL):].lstrip("/")
            return key or None
    except Exception:
        return None
    return None


def _delete_post_media(image_path: Optional[str], video_path: Optional[str]) -> None:
    """Best-effort media cleanup: local ``static/`` files (legacy uploads)
    and R2 objects (CDN-URL paths). Never raises — a leaked blob is cheaper
    than a failed delete."""
    for path in (image_path, video_path):
        if not path or path == "pending":
            continue
        r2_key = _r2_key_for(path)
        if r2_key:
            try:
                from backend.services.r2_storage import delete_from_r2

                if not delete_from_r2(r2_key):
                    logger.warning("post media R2 delete returned False for key %s", r2_key)
            except Exception as exc:
                logger.warning("post media R2 delete failed for %s: %s", path, exc)
            continue
        if path.startswith("http://") or path.startswith("https://"):
            # Foreign URL (non-R2 CDN, link preview, etc.) — nothing to delete.
            continue
        try:
            file_path = os.path.join("static", path)
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception as exc:
            logger.warning("post media file delete failed for %s: %s", path, exc)


def delete_post_cascade(
    post_id: int,
    *,
    actor: str,
    resolve_reports: bool = False,
    enforce_welcome_lock: bool = True,
) -> Tuple[Dict[str, Any], int]:
    """Delete ``post_id`` and everything that references it.

    Returns ``(payload, http_status)``:
      * ``({"success": True, "community_id": ...}, 200)`` on success
      * ``({"success": False, "error": "not_found"}, 404)`` if the post is gone
      * ``({"success": False, "error": "welcome_locked", "message": ...}, 403)``
        when the Steve welcome post is still inside its 7-day delete lock

    ``resolve_reports=True`` (moderation paths) marks every report on the
    post reviewed-by-``actor`` before the delete, so the audit trail
    survives the post itself.
    """
    if not post_id:
        return {"success": False, "error": "not_found"}, 404

    community_id: Optional[int] = None
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()

            post = _fetch_post(c, ph, int(post_id))
            if not post:
                return {"success": False, "error": "not_found"}, 404
            community_id = post.get("community_id")

            if enforce_welcome_lock:
                try:
                    from backend.services.steve_community_welcome import is_within_delete_lock

                    if is_within_delete_lock(post):
                        return {
                            "success": False,
                            "error": "welcome_locked",
                            "message": WELCOME_LOCK_MESSAGE,
                        }, 403
                except Exception as lock_err:  # pragma: no cover - defensive
                    logger.warning("delete cascade: welcome lock check failed (non-fatal): %s", lock_err)

            # Cancel in-flight imagine jobs so workers don't render onto a
            # deleted post.
            try:
                c.execute(
                    f"UPDATE imagine_jobs SET status = {ph} "
                    f"WHERE target_type = {ph} AND target_id = {ph} AND status IN ({ph}, {ph})",
                    (_IMAGINE_ERROR, "post", post_id, _IMAGINE_PENDING, _IMAGINE_PROCESSING),
                )
            except Exception as exc:
                logger.warning("could not cancel imagine jobs for post %s: %s", post_id, exc)

            if resolve_reports:
                try:
                    c.execute(
                        f"UPDATE post_reports SET status = 'reviewed', reviewed_by = {ph}, reviewed_at = {ph} "
                        f"WHERE post_id = {ph}",
                        (actor, _now(), post_id),
                    )
                except Exception as exc:
                    logger.warning("could not resolve reports for post %s: %s", post_id, exc)

            _delete_post_media(post.get("image_path"), post.get("video_path"))

            # reply_reactions FK-references replies(id) without ON DELETE
            # CASCADE in the code DDL — clear it before the replies rows.
            try:
                c.execute(
                    f"DELETE FROM reply_reactions WHERE reply_id IN "
                    f"(SELECT id FROM replies WHERE post_id = {ph})",
                    (post_id,),
                )
            except Exception as exc:
                logger.warning("could not delete reply_reactions for post %s: %s", post_id, exc)
            c.execute(f"DELETE FROM replies WHERE post_id = {ph}", (post_id,))
            try:
                c.execute(f"DELETE FROM reactions WHERE post_id = {ph}", (post_id,))
            except Exception as exc:
                logger.warning("could not delete reactions for post %s: %s", post_id, exc)
            try:
                c.execute(f"DELETE FROM post_views WHERE post_id = {ph}", (post_id,))
            except Exception as exc:
                logger.warning("could not delete post_views for post %s: %s", post_id, exc)
            # Notifications keep a post_id pointer (no FK in prod, plain FK in
            # the code DDL) — drop them so bells never deep-link to a dead post.
            try:
                c.execute(f"DELETE FROM notifications WHERE post_id = {ph}", (post_id,))
            except Exception as exc:
                logger.warning("could not delete notifications for post %s: %s", post_id, exc)
            # Key-post markers hold restricting FKs on posts(id) — clear them
            # before the posts row or MySQL rejects the delete (error 1451).
            for key_table in ("community_key_posts", "key_posts"):
                try:
                    c.execute(f"DELETE FROM {key_table} WHERE post_id = {ph}", (post_id,))
                except Exception as exc:
                    logger.warning(
                        "could not delete %s rows for post %s: %s", key_table, post_id, exc
                    )
            c.execute(f"DELETE FROM posts WHERE id = {ph}", (post_id,))
            conn.commit()
    except Exception as exc:
        logger.error("delete_post_cascade failed for post %s: %s", post_id, exc, exc_info=True)
        return {"success": False, "error": "failed"}, 500

    # Best-effort cache invalidation — function-local imports keep this free
    # of import cycles, and a cache miss self-heals via TTL.
    if community_id:
        try:
            from bodybuilding_app import invalidate_community_cache

            invalidate_community_cache(community_id)
        except Exception as cache_err:
            logger.warning("feed cache invalidate after delete failed: %s", cache_err)
    try:
        from backend.services.post_detail_cache import invalidate_post_detail

        invalidate_post_detail(post_id, scope="community")
    except Exception as cache_err:
        logger.warning("post detail cache invalidate after delete failed: %s", cache_err)

    logger.info("post %s deleted by %s (reports_resolved=%s)", post_id, actor, resolve_reports)
    return {"success": True, "community_id": community_id}, 200
