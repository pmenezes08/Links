"""Schema helpers for DM chat lists (archived threads, etc.)."""

from __future__ import annotations

import logging

from backend.services.database import USE_MYSQL

logger = logging.getLogger(__name__)


def ensure_archived_chats_table(cursor) -> None:
    """Create archived_chats table if it doesn't exist."""
    try:
        if USE_MYSQL:
            cursor.execute("SHOW TABLES LIKE 'archived_chats'")
            if not cursor.fetchone():
                cursor.execute(
                    """
                    CREATE TABLE archived_chats (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        username VARCHAR(255) NOT NULL,
                        other_username VARCHAR(255) NOT NULL,
                        archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY unique_archive (username, other_username)
                    )
                    """
                )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS archived_chats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    other_username TEXT NOT NULL,
                    archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(username, other_username)
                )
                """
            )
    except Exception as e:
        logger.warning("Could not create archived_chats table: %s", e)


def ensure_deleted_chat_threads_table(cursor) -> None:
    """Ensure deleted_chat_threads exists (one-sided clear / delete)."""
    try:
        cursor.execute("SELECT 1 FROM deleted_chat_threads LIMIT 1")
    except Exception:
        if USE_MYSQL:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS deleted_chat_threads (
                    username VARCHAR(191) NOT NULL,
                    other_username VARCHAR(191) NOT NULL,
                    deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (username, other_username)
                )
                """
            )
        else:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS deleted_chat_threads (
                    username TEXT NOT NULL,
                    other_username TEXT NOT NULL,
                    deleted_at TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (username, other_username)
                )
                """
            )
