"""insert_new_community_row + notify schema default."""

from __future__ import annotations

import random

import pytest

from backend.services.community import (
    DEFAULT_NOTIFY_ON_NEW_MEMBER,
    ensure_notify_on_new_member_schema,
    insert_new_community_row,
)
from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

pytestmark = pytest.mark.usefixtures("mysql_dsn")


@pytest.fixture()
def community_owner_user():
    from tests.fixtures import make_user

    return make_user("owner_insert_notify")["username"]


def test_insert_new_community_row_sets_notify_default(community_owner_user):
    username = community_owner_user
    ph = get_sql_placeholder()
    join = "NZ" + str(random.randint(100000, 999999))
    with get_db_connection() as conn:
        c = conn.cursor()
        insert_new_community_row(
            c,
            name="notify-default-test",
            community_type="general",
            creator_username=username,
            join_code=join,
            created_at="2026-01-15 12:00:00",
            description="",
            location="",
            background_path="",
            template="default",
            background_color="#2d3839",
            text_color="#ffffff",
            accent_color="#4db6ac",
            card_color="#1a2526",
            parent_community_id=None,
        )
        cid = int(c.lastrowid)
        c.execute(
            f"SELECT notify_on_new_member FROM communities WHERE id = {ph}",
            (cid,),
        )
        row = c.fetchone()
        val = row["notify_on_new_member"] if hasattr(row, "keys") else row[0]
        assert int(val) == DEFAULT_NOTIFY_ON_NEW_MEMBER
        c.execute(f"DELETE FROM communities WHERE id = {ph}", (cid,))
        try:
            conn.commit()
        except Exception:
            pass


def test_child_community_count_matches_direct_children(community_owner_user):
    """Same COUNT semantics as api_community_feed child_community_count."""
    username = community_owner_user
    ph = get_sql_placeholder()
    j_parent = "NZ" + str(random.randint(100000, 999999))
    j_c1 = "NZ" + str(random.randint(100000, 999999))
    j_c2 = "NZ" + str(random.randint(100000, 999999))
    cid_parent = None
    cid_children = []
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            insert_new_community_row(
                c,
                name="parent-count-test",
                community_type="general",
                creator_username=username,
                join_code=j_parent,
                created_at="2026-01-15 12:00:00",
                description="",
                location="",
                background_path="",
                template="default",
                background_color="#2d3839",
                text_color="#ffffff",
                accent_color="#4db6ac",
                card_color="#1a2526",
                parent_community_id=None,
            )
            cid_parent = int(c.lastrowid)
            for name_suffix, jc in (("a", j_c1), ("b", j_c2)):
                insert_new_community_row(
                    c,
                    name=f"child-count-test-{name_suffix}",
                    community_type="general",
                    creator_username=username,
                    join_code=jc,
                    created_at="2026-01-15 12:01:00",
                    description="",
                    location="",
                    background_path="",
                    template="default",
                    background_color="#2d3839",
                    text_color="#ffffff",
                    accent_color="#4db6ac",
                    card_color="#1a2526",
                    parent_community_id=cid_parent,
                )
                cid_children.append(int(c.lastrowid))
            try:
                conn.commit()
            except Exception:
                pass

            c.execute(
                f"SELECT COUNT(*) AS cnt FROM communities WHERE parent_community_id = {ph}",
                (cid_parent,),
            )
            row = c.fetchone()
            cnt = row["cnt"] if hasattr(row, "keys") else row[0]
            assert int(cnt) == 2
    finally:
        for cid in cid_children:
            try:
                with get_db_connection() as conn:
                    c = conn.cursor()
                    c.execute(f"DELETE FROM communities WHERE id = {ph}", (cid,))
                    conn.commit()
            except Exception:
                pass
        if cid_parent is not None:
            try:
                with get_db_connection() as conn:
                    c = conn.cursor()
                    c.execute(f"DELETE FROM communities WHERE id = {ph}", (cid_parent,))
                    conn.commit()
            except Exception:
                pass


def test_ensure_notify_on_new_member_schema_idempotent():
    with get_db_connection() as conn:
        c = conn.cursor()
        ensure_notify_on_new_member_schema(c, conn)
        if USE_MYSQL:
            c.execute("SHOW COLUMNS FROM communities LIKE 'notify_on_new_member'")
            assert c.fetchone() is not None
        else:
            c.execute("PRAGMA table_info(communities)")
            names = [
                r[1] if isinstance(r, (list, tuple)) else str(r[1])
                for r in (c.fetchall() or [])
            ]
            assert "notify_on_new_member" in names
