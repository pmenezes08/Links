"""Helpers for tagging Steve-mediated messages that belong to a human–human DM thread."""

from __future__ import annotations

from backend.services.database import USE_MYSQL

_HUMAN_THREAD_COLUMN_READY = False


def human_pair_thread_key(peer_a: str, peer_b: str) -> str:
    """Canonical key matching Firestore ``dm_conversations`` document IDs (sorted lowercase pair)."""
    a, b = sorted([peer_a.lower(), peer_b.lower()])
    return f"{a}_{b}"


def is_private_steve_dm_peer(peer: str) -> bool:
    return (peer or "").strip().lower() == "steve"


def dm_messages_where_clause(
    ph: str,
    *,
    viewer: str,
    peer: str,
    thr_key: str,
) -> tuple[str, tuple]:
    """SQL WHERE + params for messages visible in a DM thread (MySQL/SQLite).

    Private Steve chats exclude @Steve in-thread rows (``human_dm_thread`` set for
    another human pair). Human-human threads include Steve only when tagged for that pair.
    """
    if is_private_steve_dm_peer(peer):
        where = (
            f"((sender = {ph} AND receiver = {ph})"
            f" OR (sender = {ph} AND receiver = {ph}"
            f" AND (human_dm_thread IS NULL OR human_dm_thread = '')))"
        )
        params = (viewer, peer, peer, viewer)
    else:
        where = (
            f"(((sender = {ph} AND receiver = {ph})"
            f" OR (sender = {ph} AND receiver = {ph}))"
            f" OR (sender = 'steve' AND human_dm_thread = {ph}))"
        )
        params = (viewer, peer, peer, viewer, thr_key)
    return where, params


def dm_last_message_where_clause(
    ph: str,
    *,
    viewer: str,
    peer: str,
) -> tuple[str, tuple]:
    """Thread-list preview query: same isolation rules as :func:`dm_messages_where_clause`."""
    if is_private_steve_dm_peer(peer):
        where = (
            f"((sender = {ph} AND receiver = {ph})"
            f" OR (sender = {ph} AND receiver = {ph}"
            f" AND (human_dm_thread IS NULL OR human_dm_thread = '')))"
        )
        params = (viewer, peer, peer, viewer)
    else:
        thr_key = human_pair_thread_key(viewer, peer)
        where = (
            f"(((sender = {ph} AND receiver = {ph})"
            f" OR (sender = {ph} AND receiver = {ph}))"
            f" OR (sender = 'steve' AND human_dm_thread = {ph}))"
        )
        params = (viewer, peer, peer, viewer, thr_key)
    return where, params


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

