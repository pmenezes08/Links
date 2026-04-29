"""Helpers for tagging Steve-mediated messages that belong to a human–human DM thread."""

from __future__ import annotations

from backend.services.database import USE_MYSQL

_HUMAN_THREAD_COLUMN_READY = False


def human_pair_thread_key(peer_a: str, peer_b: str) -> str:
    """Canonical key matching Firestore ``dm_conversations`` document IDs (sorted lowercase pair)."""
    a, b = sorted([peer_a.lower(), peer_b.lower()])
    return f"{a}_{b}"


def ensure_human_dm_thread_column(cursor) -> None:
    """Add ``human_dm_thread`` column to ``messages`` if missing (MySQL + SQLite)."""
    global _HUMAN_THREAD_COLUMN_READY  # pylint: disable=global-statement
    if _HUMAN_THREAD_COLUMN_READY:
        return
    try:
        if USE_MYSQL:
            cursor.execute(
                "ALTER TABLE messages ADD COLUMN human_dm_thread VARCHAR(191) NULL"
            )
        else:
            cursor.execute("ALTER TABLE messages ADD COLUMN human_dm_thread TEXT")
        try:
            cursor.connection.commit()
        except Exception:
            pass
    except Exception:
        pass

    try:
        if USE_MYSQL:
            cursor.execute(
                "ALTER TABLE messages ADD INDEX idx_messages_human_dm_thread "
                "(human_dm_thread)"
            )
        else:
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_msgs_human_dm ON messages(human_dm_thread)"
            )
        try:
            cursor.connection.commit()
        except Exception:
            pass
    except Exception:
        pass

    _HUMAN_THREAD_COLUMN_READY = True

