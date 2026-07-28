"""Tests for the ``/check_unread_messages`` badge counts (``backend.services.dm_unread``).

Group count: the single batched JOIN must reproduce the former per-group ``COUNT``
loop — a message is unread for the user only when its ``id`` is greater than the
user's per-group ``last_read_message_id`` (0 with no receipt), it is not deleted,
it was not sent by the user, and the user belongs to a group that still exists.

Ghost-badge invariant: the badge must never count rows the thread list can't
surface (blocked pairs, orphaned group memberships) — those would show a badge
number the user has no way to clear.
"""

from __future__ import annotations

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.dm_unread import (
    count_dm_unread_excluding_cleared,
    count_group_unread_excluding_cleared,
    count_unread_notifications,
)
from tests.fixtures import make_user


def _ensure_dm_tables() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """CREATE TABLE IF NOT EXISTS messages (
                id INT PRIMARY KEY AUTO_INCREMENT,
                sender VARCHAR(191) NOT NULL,
                receiver VARCHAR(191) NOT NULL,
                message TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_read TINYINT(1) DEFAULT 0,
                is_encrypted TINYINT(1) DEFAULT 0,
                human_dm_thread VARCHAR(191) NULL
            )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS deleted_chat_threads (
                username VARCHAR(191) NOT NULL,
                other_username VARCHAR(191) NOT NULL,
                deleted_at DATETIME NULL,
                PRIMARY KEY (username, other_username)
            )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS blocked_users (
                id INT PRIMARY KEY AUTO_INCREMENT,
                blocker_username VARCHAR(191) NOT NULL,
                blocked_username VARCHAR(191) NOT NULL
            )"""
        )
        conn.commit()


def _ensure_group_tables() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        if USE_MYSQL:
            c.execute(
                """CREATE TABLE IF NOT EXISTS group_chats (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    name VARCHAR(100) NOT NULL,
                    creator_username VARCHAR(100) NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )"""
            )
            c.execute(
                """CREATE TABLE IF NOT EXISTS group_chat_members (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    group_id INT NOT NULL,
                    username VARCHAR(100) NOT NULL,
                    UNIQUE KEY unique_member (group_id, username)
                )"""
            )
            c.execute(
                """CREATE TABLE IF NOT EXISTS group_chat_messages (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    group_id INT NOT NULL,
                    sender_username VARCHAR(100) NOT NULL,
                    message_text TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_deleted TINYINT DEFAULT 0
                )"""
            )
            c.execute(
                """CREATE TABLE IF NOT EXISTS group_chat_read_receipts (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    group_id INT NOT NULL,
                    username VARCHAR(100) NOT NULL,
                    last_read_message_id INT DEFAULT 0,
                    last_read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_receipt (group_id, username)
                )"""
            )
        conn.commit()


def test_count_group_unread_excluding_cleared_matches_loop_semantics(mysql_dsn):
    _ensure_group_tables()
    make_user("gu_member")
    make_user("gu_other")
    make_user("gu_lurker")  # belongs to no groups

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()

        def new_group(name: str) -> int:
            c.execute(
                f"INSERT INTO group_chats (name, creator_username) VALUES ({ph}, {ph})",
                (name, "gu_other"),
            )
            return c.lastrowid

        def add_member(gid: int, user: str) -> None:
            c.execute(
                f"INSERT INTO group_chat_members (group_id, username) VALUES ({ph}, {ph})",
                (gid, user),
            )

        def msg(gid: int, sender: str, deleted: int = 0) -> int:
            c.execute(
                f"INSERT INTO group_chat_messages (group_id, sender_username, message_text, is_deleted) "
                f"VALUES ({ph}, {ph}, {ph}, {ph})",
                (gid, sender, "x", deleted),
            )
            return c.lastrowid

        # Group A: member has a read receipt at a2.
        ga = new_group("A")
        add_member(ga, "gu_member")
        add_member(ga, "gu_other")
        msg(ga, "gu_other")             # a1 (read)
        a2 = msg(ga, "gu_other")        # a2 (read boundary)
        c.execute(
            f"INSERT INTO group_chat_read_receipts (group_id, username, last_read_message_id) "
            f"VALUES ({ph}, {ph}, {ph})",
            (ga, "gu_member", a2),
        )
        msg(ga, "gu_member")            # own message after boundary -> not counted
        msg(ga, "gu_other")             # other after boundary       -> COUNTED
        msg(ga, "gu_other", deleted=1)  # deleted                    -> not counted

        # Group B: member, no receipt (last_read defaults to 0).
        gb = new_group("B")
        add_member(gb, "gu_member")
        add_member(gb, "gu_other")
        msg(gb, "gu_other")             # other, id > 0              -> COUNTED
        msg(gb, "gu_member")            # own                        -> not counted

        # Group C: member is NOT in this group.
        gc = new_group("C")
        add_member(gc, "gu_other")
        msg(gc, "gu_other")             # not a member               -> not counted

        # Group D: orphaned membership — group_chats row deleted but member +
        # message rows survived (prod FKs don't cascade everywhere). No visible
        # chat exists, so counting it would be an uncleareable ghost badge.
        gd = new_group("D")
        add_member(gd, "gu_member")
        add_member(gd, "gu_other")
        msg(gd, "gu_other")             # orphaned group             -> not counted
        c.execute(f"DELETE FROM group_chats WHERE id = {ph}", (gd,))

        conn.commit()

        # gu_member: one fresh message in A + one in B.
        assert count_group_unread_excluding_cleared(c, "gu_member") == 2
        # gu_lurker has no memberships -> zero.
        assert count_group_unread_excluding_cleared(c, "gu_lurker") == 0


def test_count_unread_notifications_excludes_message_and_reaction(mysql_dsn):
    """The notification badge count rides /check_unread_messages and must mirror the
    client's old filter: unread notifications, excluding 'message' and 'reaction'
    types (those surface in the chat/reaction UIs, not the bell)."""
    make_user("nu_user")
    make_user("nu_other")

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()

        def notif(user: str, ntype: str, is_read: int = 0) -> None:
            c.execute(
                f"INSERT INTO notifications (user_id, from_user, type, is_read) "
                f"VALUES ({ph}, {ph}, {ph}, {ph})",
                (user, "nu_other", ntype, is_read),
            )

        notif("nu_user", "follow")             # COUNTED
        notif("nu_user", "post_reply")         # COUNTED
        notif("nu_user", "message")            # excluded (chat badge owns this)
        notif("nu_user", "reaction")           # excluded (reaction UI)
        notif("nu_user", "follow", is_read=1)  # excluded (already read)
        notif("nu_other", "follow")            # excluded (different user)
        conn.commit()

        assert count_unread_notifications(c, "nu_user") == 2
        assert count_unread_notifications(c, "nu_other") == 1


def test_dm_badge_excludes_blocked_pairs(mysql_dsn):
    """The thread list hides blocked threads entirely, so unread rows from a
    blocked pair must not count toward the badge — they would be a permanent
    ghost badge with no visible thread to open and clear them."""
    _ensure_dm_tables()
    make_user("bl_user")
    make_user("bl_friend")
    make_user("bl_blocked")
    make_user("bl_blocker")

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()

        # ``timestamp`` is supplied explicitly: whichever suite created the
        # shared CI ``messages`` table first decides its schema, and some
        # variants declare the column with no default (insert -> error 1364).
        ts = "2026-07-28 10:00:00"

        def dm(sender: str, receiver: str) -> None:
            c.execute(
                f"INSERT INTO messages (sender, receiver, message, timestamp, is_read) "
                f"VALUES ({ph}, {ph}, {ph}, {ph}, 0)",
                (sender, receiver, "x", ts),
            )

        dm("bl_friend", "bl_user")    # COUNTED
        dm("bl_blocked", "bl_user")   # excluded: bl_user blocked them
        dm("bl_blocker", "bl_user")   # excluded: they blocked bl_user
        c.execute(
            f"INSERT INTO blocked_users (blocker_username, blocked_username) VALUES ({ph}, {ph})",
            ("bl_user", "bl_blocked"),
        )
        c.execute(
            f"INSERT INTO blocked_users (blocker_username, blocked_username) VALUES ({ph}, {ph})",
            ("bl_blocker", "bl_user"),
        )
        conn.commit()

        assert count_dm_unread_excluding_cleared(c, "bl_user") == 1
