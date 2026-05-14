"""View tracking for ``group_posts`` (separate from community ``post_views`` / ``posts`` FK)."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from backend.services.database import USE_MYSQL

logger = logging.getLogger(__name__)


def ensure_group_post_views_table(cursor) -> None:
    try:
        if USE_MYSQL:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS `group_post_views` (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    group_post_id INTEGER NOT NULL,
                    username VARCHAR(191) NOT NULL,
                    viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_grp_post_view (group_post_id, username),
                    KEY idx_grp_post_views_post (group_post_id),
                    CONSTRAINT fk_grp_post_views_post
                        FOREIGN KEY (group_post_id)
                        REFERENCES `group_posts`(id) ON DELETE CASCADE
                )
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS group_post_views (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_post_id INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    viewed_at TEXT DEFAULT (datetime('now')),
                    UNIQUE(group_post_id, username),
                    FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE CASCADE
                )
                """
            )
    except Exception as e:
        logger.warning("Could not ensure group_post_views table: %s", e)


def count_group_post_views_excluding_admin(cursor, ph: str, group_post_id: int) -> int:
    try:
        tbl = "`group_post_views`" if USE_MYSQL else "group_post_views"
        cursor.execute(
            f"""
            SELECT COUNT(*) as cnt FROM {tbl}
            WHERE group_post_id = {ph} AND LOWER(username) <> LOWER({ph})
            """,
            (group_post_id, "admin"),
        )
        row = cursor.fetchone()
        if row and hasattr(row, "keys"):
            return int(row.get("cnt") or 0)
        return int(row[0]) if row else 0
    except Exception:
        return 0


def batch_group_post_view_counts_excluding_admin(
    cursor, ph: str, post_ids: list[int]
) -> dict[int, int]:
    """Map group_post_id -> view count (excluding platform admin username)."""
    if not post_ids:
        return {}
    ensure_group_post_views_table(cursor)
    out: dict[int, int] = {int(pid): 0 for pid in post_ids}
    try:
        tbl = "`group_post_views`" if USE_MYSQL else "group_post_views"
        pl = ",".join([ph] * len(post_ids))
        cursor.execute(
            f"""
            SELECT group_post_id, COUNT(*) as cnt FROM {tbl}
            WHERE group_post_id IN ({pl}) AND LOWER(username) <> LOWER({ph})
            GROUP BY group_post_id
            """,
            tuple(post_ids) + ("admin",),
        )
        for row in cursor.fetchall() or []:
            gid = row["group_post_id"] if hasattr(row, "keys") else row[0]
            cnt = row["cnt"] if hasattr(row, "keys") else row[1]
            if gid is not None:
                out[int(gid)] = int(cnt or 0)
    except Exception as e:
        logger.warning("batch_group_post_view_counts_excluding_admin: %s", e)
    return out


def upsert_group_post_view(
    cursor, ph: str, group_post_id: int, username: Optional[str]
) -> int:
    ensure_group_post_views_table(cursor)
    if not username:
        return count_group_post_views_excluding_admin(cursor, ph, group_post_id)
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    tbl = "`group_post_views`" if USE_MYSQL else "group_post_views"
    try:
        if USE_MYSQL:
            cursor.execute(
                f"INSERT IGNORE INTO {tbl} (group_post_id, username, viewed_at) VALUES (%s,%s,%s)",
                (group_post_id, username, now_str),
            )
        else:
            cursor.execute(
                f"INSERT OR IGNORE INTO {tbl} (group_post_id, username, viewed_at) VALUES (?,?,?)",
                (group_post_id, username, now_str),
            )
    except Exception as e:
        logger.warning("Failed inserting group_post_view for %s: %s", group_post_id, e)
    return count_group_post_views_excluding_admin(cursor, ph, group_post_id)
