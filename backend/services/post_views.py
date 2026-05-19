"""Community post view tracking via the ``post_views`` table."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


def ensure_post_views_table(c) -> None:
    """Ensure the post_views table exists for tracking unique post views."""
    try:
        if USE_MYSQL:
            c.execute(
                """CREATE TABLE IF NOT EXISTS post_views (
                          id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          post_id INTEGER NOT NULL,
                          username VARCHAR(191) NOT NULL,
                          viewed_at DATETIME NOT NULL,
                          UNIQUE(post_id, username),
                          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                          FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
                        )"""
            )
        else:
            c.execute(
                """CREATE TABLE IF NOT EXISTS post_views (
                          id INTEGER PRIMARY KEY AUTOINCREMENT,
                          post_id INTEGER NOT NULL,
                          username VARCHAR(191) NOT NULL,
                          viewed_at TEXT NOT NULL,
                          UNIQUE(post_id, username),
                          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                          FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
                        )"""
            )
    except Exception as e:
        logger.warning("Could not ensure post_views table: %s", e)


def count_post_views_excluding_admin(c, post_id: int) -> Optional[int]:
    """Return the number of views for a post ignoring admin activity."""
    try:
        post_ph = get_sql_placeholder()
        admin_ph = get_sql_placeholder()
        c.execute(
            f"SELECT COUNT(*) as cnt FROM post_views WHERE post_id = {post_ph} AND LOWER(username) <> LOWER({admin_ph})",
            (post_id, "admin"),
        )
        row = c.fetchone()
        count = row["cnt"] if hasattr(row, "keys") else (row[0] if row else 0)
        return int(count or 0)
    except Exception as count_err:
        logger.warning("Failed counting post views for post %s: %s", post_id, count_err)
        return None


def upsert_post_view(c, post_id: int, username: Optional[str]) -> Optional[int]:
    """Record a unique view for (post_id, username) and return display view count (excl. platform admin)."""
    ensure_post_views_table(c)
    if not username:
        return count_post_views_excluding_admin(c, post_id)

    # Remove legacy rows for the platform "admin" login so public counts stay meaningful
    try:
        post_ph = get_sql_placeholder()
        admin_ph = get_sql_placeholder()
        c.execute(
            f"DELETE FROM post_views WHERE post_id = {post_ph} AND LOWER(username) = LOWER({admin_ph})",
            (post_id, "admin"),
        )
    except Exception as cleanup_err:
        logger.warning("Failed cleaning admin views for post %s: %s", post_id, cleanup_err)

    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        if USE_MYSQL:
            c.execute(
                "INSERT IGNORE INTO post_views (post_id, username, viewed_at) VALUES (%s,%s,%s)",
                (post_id, username, now_str),
            )
        else:
            c.execute(
                "INSERT OR IGNORE INTO post_views (post_id, username, viewed_at) VALUES (?,?,?)",
                (post_id, username, now_str),
            )
    except Exception as insert_err:
        logger.warning(
            "Failed inserting post_view for post %s and user %s: %s",
            post_id,
            username,
            insert_err,
        )
    return count_post_views_excluding_admin(c, post_id)


def record_community_post_view(username: str, post_id: int) -> Dict[str, Any]:
    """Membership check, persist view, clear related notifications, invalidate feed cache."""
    from redis_cache import invalidate_community_cache, invalidate_user_parent_dashboard

    try:
        post_id = int(post_id)
    except (TypeError, ValueError):
        return {"success": False, "error": "post_id required", "http_status": 400}

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"SELECT community_id, username FROM posts WHERE id = {ph}",
                (post_id,),
            )
            row = c.fetchone()
            if not row:
                return {"success": False, "error": "Post not found", "http_status": 404}
            community_id = row["community_id"] if hasattr(row, "keys") else row[0]
            post_owner = row["username"] if hasattr(row, "keys") else row[1]

            if community_id:
                if username not in ("admin", post_owner):
                    c.execute(
                        f"""
                        SELECT 1 FROM user_communities uc
                        JOIN users u ON uc.user_id = u.id
                        WHERE u.username = {ph} AND uc.community_id = {ph}
                        LIMIT 1
                        """,
                        (username, community_id),
                    )
                    if not c.fetchone():
                        return {"success": False, "error": "Forbidden", "http_status": 403}

            try:
                view_count = upsert_post_view(c, post_id, username)
                conn.commit()
            except Exception as view_err:
                logger.warning("Failed to record post view for %s: %s", post_id, view_err)
                view_count = None

            try:
                c.execute(
                    f"UPDATE notifications SET is_read = 1 WHERE user_id = {ph} AND post_id = {ph} AND is_read = 0",
                    (username, post_id),
                )
                conn.commit()
            except Exception as notif_err:
                logger.debug(
                    "post_view notif clear for %s/%s: %s", username, post_id, notif_err
                )

            try:
                if community_id:
                    invalidate_community_cache(community_id)
                if username:
                    invalidate_user_parent_dashboard(username)
            except Exception as inv_err:
                logger.warning(
                    "Failed to invalidate cache after post view (community=%s user=%s): %s",
                    community_id,
                    username,
                    inv_err,
                )

            return {
                "success": True,
                "view_count": int(view_count or 0),
                "post_id": post_id,
                "http_status": 200,
            }
    except Exception as e:
        logger.error("Error saving post view for %s: %s", post_id, e)
        return {"success": False, "error": "Server error", "http_status": 500}
