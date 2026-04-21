"""DM unread counts excluding one-sided cleared threads (deleted_chat_threads)."""

from __future__ import annotations

from backend.services.database import get_sql_placeholder


def count_dm_unread_excluding_cleared(cursor, username: str) -> int:
    """
    Count unread DMs for the receiver, ignoring messages at or before a WhatsApp-style
    clear/delete boundary (deleted_chat_threads).
    """
    ph = get_sql_placeholder()
    sql = f"""
        SELECT COUNT(*) AS cnt FROM messages m
        LEFT JOIN deleted_chat_threads dct
          ON dct.username = m.receiver AND dct.other_username = m.sender
        WHERE m.receiver = {ph} AND m.is_read = 0
          AND (dct.deleted_at IS NULL OR m.timestamp > dct.deleted_at)
    """
    cursor.execute(sql, (username,))
    row = cursor.fetchone()
    if row is None:
        return 0
    if hasattr(row, "keys"):
        return int(list(row.values())[0] or 0)
    return int(row[0] or 0)


def mark_dm_received_before_clear_as_read(cursor, username: str, other_username: str) -> None:
    """After deleted_chat_threads row is set for this pair, mark pre-clear unread rows as read."""
    ph = get_sql_placeholder()
    cursor.execute(
        f"SELECT deleted_at FROM deleted_chat_threads WHERE username = {ph} AND other_username = {ph}",
        (username, other_username),
    )
    row = cursor.fetchone()
    if not row:
        return
    da = row["deleted_at"] if hasattr(row, "keys") else row[0]
    if not da:
        return
    da_s = str(da)
    cursor.execute(
        f"""
        UPDATE messages SET is_read = 1
        WHERE receiver = {ph} AND sender = {ph} AND is_read = 0 AND timestamp <= {ph}
        """,
        (username, other_username, da_s),
    )
