"""Community task helper utilities."""

from __future__ import annotations

import logging

from backend.services.community import is_community_admin, is_community_owner
from backend.services.database import USE_MYSQL, get_db_connection


logger = logging.getLogger(__name__)


def ensure_tasks_table() -> None:
    """Create the tasks table (and status column) if needed."""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            if USE_MYSQL:
                c.execute(
                    """
                    CREATE TABLE IF NOT EXISTS tasks (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        community_id INT NOT NULL,
                        title VARCHAR(255) NOT NULL,
                        description TEXT,
                        due_date DATE NULL,
                        assigned_to_username VARCHAR(255) NULL,
                        created_by_username VARCHAR(255) NOT NULL,
                        created_at DATETIME NOT NULL DEFAULT NOW(),
                        completed TINYINT(1) NOT NULL DEFAULT 0,
                        INDEX idx_tasks_comm (community_id),
                        INDEX idx_tasks_assignee (assigned_to_username)
                    )
                    """
                )
            else:
                c.execute(
                    """
                    CREATE TABLE IF NOT EXISTS tasks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        community_id INTEGER NOT NULL,
                        title TEXT NOT NULL,
                        description TEXT,
                        due_date TEXT,
                        assigned_to_username TEXT,
                        created_by_username TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT (datetime('now')),
                        completed INTEGER NOT NULL DEFAULT 0
                    )
                    """
                )
            conn.commit()

            try:
                status_sql = (
                    "ALTER TABLE tasks ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'not_started'"
                    if USE_MYSQL
                    else "ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'not_started'"
                )
                c.execute(status_sql)
                conn.commit()
                try:
                    update_sql = "UPDATE tasks SET status='completed' WHERE completed=1"
                    c.execute(update_sql)
                    conn.commit()
                except Exception:
                    pass
            except Exception:
                pass
    except Exception as exc:
        logger.error("ensure_tasks_table error: %s", exc)


def is_community_admin_or_owner(username: str, community_id: int) -> bool:
    """Return True if the user manages the community."""
    if not username or not community_id:
        return False
    return is_community_owner(username, community_id) or is_community_admin(username, community_id)
