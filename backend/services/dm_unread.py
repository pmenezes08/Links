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


def count_group_unread_excluding_cleared(cursor, username: str) -> int:
    """
    Count unread group-chat messages across ALL of the user's groups in ONE query.

    Replaces the per-group ``COUNT`` loop in ``/check_unread_messages`` (one query
    per group membership — an N+1 on a badge endpoint polled on every feed/post/
    group mount). A message is unread for the user when its ``id`` is greater than
    the user's per-group ``last_read_message_id`` (0 when there is no receipt), it
    is not deleted, and it was not sent by the user. The single JOIN reproduces the
    loop's semantics exactly.
    """
    ph = get_sql_placeholder()
    sql = f"""
        SELECT COUNT(*) AS cnt
        FROM group_chat_members gcm
        LEFT JOIN group_chat_read_receipts gcr
          ON gcr.group_id = gcm.group_id AND gcr.username = gcm.username
        JOIN group_chat_messages m
          ON m.group_id = gcm.group_id
         AND m.id > COALESCE(gcr.last_read_message_id, 0)
         AND m.is_deleted = 0
         AND m.sender_username != {ph}
        WHERE gcm.username = {ph}
    """
    cursor.execute(sql, (username, username))
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
