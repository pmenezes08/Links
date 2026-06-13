"""Tests for ``backend.services.dm_unread.count_group_unread_excluding_cleared``.

The single batched JOIN must reproduce the former per-group ``COUNT`` loop in
``/check_unread_messages``: a message is unread for the user only when its ``id``
is greater than the user's per-group ``last_read_message_id`` (0 with no receipt),
it is not deleted, it was not sent by the user, and the user belongs to the group.
"""

from __future__ import annotations

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.dm_unread import count_group_unread_excluding_cleared
from tests.fixtures import make_user


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

        conn.commit()

        # gu_member: one fresh message in A + one in B.
        assert count_group_unread_excluding_cleared(c, "gu_member") == 2
        # gu_lurker has no memberships -> zero.
        assert count_group_unread_excluding_cleared(c, "gu_lurker") == 0
