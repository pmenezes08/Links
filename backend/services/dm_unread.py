"""DM unread counts excluding one-sided cleared threads (deleted_chat_threads).

Invariant: every message row this module counts as unread must (a) surface as
unread on some thread in /api/chat_threads and (b) be marked read by
``mark_dm_thread_read`` when that thread is opened. Any row that violates this
becomes a "ghost badge" — an app-icon/tab count the user can never clear.
"""

from __future__ import annotations

from backend.services.database import get_sql_placeholder
from backend.services.dm_human_thread import (
    human_pair_thread_key,
    is_private_steve_dm_peer,
)


def count_dm_unread_excluding_cleared(cursor, username: str) -> int:
    """
    Count unread DMs for the receiver, ignoring messages at or before a WhatsApp-style
    clear/delete boundary (deleted_chat_threads) and messages from blocked pairs
    (the thread list hides blocked threads, so counting them would produce an
    uncleareable ghost badge).
    """
    ph = get_sql_placeholder()
    base = f"""
        SELECT COUNT(*) AS cnt FROM messages m
        LEFT JOIN deleted_chat_threads dct
          ON dct.username = m.receiver AND dct.other_username = m.sender
        WHERE m.receiver = {ph} AND m.is_read = 0
          AND (dct.deleted_at IS NULL OR m.timestamp > dct.deleted_at)
    """
    blocked_filter = """
          AND NOT EXISTS (
              SELECT 1 FROM blocked_users bu
              WHERE (bu.blocker_username = m.receiver AND bu.blocked_username = m.sender)
                 OR (bu.blocker_username = m.sender AND bu.blocked_username = m.receiver)
          )
    """
    try:
        cursor.execute(base + blocked_filter, (username,))
        row = cursor.fetchone()
    except Exception:
        # blocked_users table may not exist yet in this environment.
        cursor.execute(base, (username,))
        row = cursor.fetchone()
    if row is None:
        return 0
    if hasattr(row, "keys"):
        return int(list(row.values())[0] or 0)
    return int(row[0] or 0)


def mark_dm_thread_read(cursor, username: str, other_username: str) -> int:
    """Mark every message the viewer can see in this DM thread as read.

    This must clear exactly what the thread displays (dm_messages_where_clause):
    rows from the peer PLUS Steve in-thread rows tagged for this human pair
    (``sender='steve' AND human_dm_thread=<pair key>``). The previous plain
    ``sender = peer`` UPDATE never cleared tagged Steve rows, so the badge count
    (which includes them) stayed above zero forever. Returns rows updated.
    """
    ph = get_sql_placeholder()
    if is_private_steve_dm_peer(other_username):
        # Legacy behaviour: opening the private Steve chat clears all Steve rows.
        cursor.execute(
            f"UPDATE messages SET is_read=1 WHERE sender={ph} AND receiver={ph} AND is_read=0",
            (other_username, username),
        )
        return cursor.rowcount or 0
    thr_key = human_pair_thread_key(username, other_username)
    try:
        cursor.execute(
            f"""
            UPDATE messages SET is_read=1
            WHERE receiver = {ph} AND is_read = 0
              AND (sender = {ph} OR (sender = 'steve' AND human_dm_thread = {ph}))
            """,
            (username, other_username, thr_key),
        )
        return cursor.rowcount or 0
    except Exception:
        # human_dm_thread column may not exist yet in this environment.
        cursor.execute(
            f"UPDATE messages SET is_read=1 WHERE sender={ph} AND receiver={ph} AND is_read=0",
            (other_username, username),
        )
        return cursor.rowcount or 0


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
    # The JOIN on group_chats drops orphaned memberships (group deleted but the
    # member/message rows survived — prod FKs don't cascade everywhere): those
    # groups have no visible chat, so counting them would be a ghost badge.
    sql = f"""
        SELECT COUNT(*) AS cnt
        FROM group_chat_members gcm
        JOIN group_chats gc
          ON gc.id = gcm.group_id
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


def count_unread_notifications(cursor, username: str) -> int:
    """
    Count unread, badge-worthy notifications — everything except ``message`` and
    ``reaction`` rows (those surface in the chat/reaction UIs, not the bell).

    Mirrors the client-side filter the badge poller used to run over the full
    ``/api/notifications`` list, so ``/check_unread_messages`` can return the
    notification count in the same round-trip instead of shipping ~50 rows on a
    high-frequency poll. ``notifications.user_id`` stores the username (see the
    notifications blueprint). The ``type IS NULL`` branch keeps parity with the
    client's exact ``!== 'message' && !== 'reaction'`` check (a NULL type counted).
    """
    ph = get_sql_placeholder()
    sql = f"""
        SELECT COUNT(*) AS cnt FROM notifications
        WHERE user_id = {ph} AND is_read = 0
          AND (type IS NULL OR type NOT IN ('message', 'reaction'))
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
