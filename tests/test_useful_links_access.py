"""Regression tests for Links & Docs access parity with the community feed.

After we tightened the ``/get_links`` access guard, ancestor admins lost
visibility because the helper only checked direct membership in the
*immediate* parent. These tests pin the access matrix end-to-end (HTTP
+ DB) for the common shapes:

  * App admin (any community)
  * Community creator (their own community)
  * Direct member (their community)
  * Ancestor-community admin (sub-community visibility via the parent
    chain)
  * Non-member (denied)

We also verify that a corrupted schema (missing ``useful_docs.details`` or
``useful_docs.group_id`` columns) no longer silently drops the entire
docs list, but degrades to a successful response with a usable subset.
"""

from __future__ import annotations

from datetime import datetime

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _attach_member(username: str, community_id: int, role: str = "member") -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        user_id = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"""
            INSERT INTO user_communities (user_id, community_id, role, joined_at)
            VALUES ({ph}, {ph}, {ph}, {ph})
            """,
            (user_id, community_id, role,
             datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()


def _insert_link(community_id: int, username: str, description: str = "tutorial") -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO useful_links (community_id, group_id, username, url, description, created_at)
            VALUES ({ph}, NULL, {ph}, {ph}, {ph}, {ph})
            """,
            (community_id, username, "https://example.com",
             description, datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()
        return int(c.lastrowid)


def _insert_doc(
    community_id: int, username: str, description: str = "manual",
    details: str = "see chapter 3",
) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO useful_docs (community_id, group_id, username, file_path, description, details, created_at)
            VALUES ({ph}, NULL, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (community_id, username, "https://r2.example/docs/foo.pdf",
             description, details,
             datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()
        return int(c.lastrowid)


def test_get_links_returns_payload_for_direct_member(mysql_dsn):
    import bodybuilding_app

    make_user("links_owner", subscription="premium")
    make_user("links_member", subscription="free")
    community_id = make_community("links-direct", creator_username="links_owner")
    _attach_member("links_member", community_id)
    _insert_link(community_id, "links_owner", description="for members")
    _insert_doc(community_id, "links_owner", description="member doc")

    client = bodybuilding_app.app.test_client()
    _login(client, "links_member")

    resp = client.get(f"/get_links?community_id={community_id}")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert len(payload["links"]) == 1
    assert payload["links"][0]["description"] == "for members"
    assert len(payload["docs"]) == 1
    assert payload["docs"][0]["description"] == "member doc"


def test_get_links_allows_creator(mysql_dsn):
    import bodybuilding_app

    make_user("links_creator_only", subscription="premium")
    community_id = make_community("links-creator", creator_username="links_creator_only")
    _insert_link(community_id, "links_creator_only", description="creator-only")

    client = bodybuilding_app.app.test_client()
    _login(client, "links_creator_only")

    resp = client.get(f"/get_links?community_id={community_id}")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert payload["links"][0]["description"] == "creator-only"


def test_get_links_denies_non_member(mysql_dsn):
    import bodybuilding_app

    make_user("links_outsider_owner", subscription="premium")
    make_user("links_outsider", subscription="free")
    community_id = make_community("links-outsider", creator_username="links_outsider_owner")
    _insert_link(community_id, "links_outsider_owner")

    client = bodybuilding_app.app.test_client()
    _login(client, "links_outsider")

    resp = client.get(f"/get_links?community_id={community_id}")
    assert resp.status_code == 403


def test_get_links_allows_ancestor_admin(mysql_dsn):
    """Admin/owner of a parent community should keep visibility into
    sub-community Links & Docs (parity with ``api_community_feed``)."""
    import bodybuilding_app

    make_user("anc_admin_creator", subscription="premium")
    make_user("anc_admin", subscription="premium")
    parent_id = make_community("anc-parent", creator_username="anc_admin_creator")
    sub_id = make_community(
        "anc-sub",
        creator_username="anc_admin_creator",
        parent_community_id=parent_id,
    )
    _attach_member("anc_admin", parent_id, role="admin")
    _insert_link(sub_id, "anc_admin_creator", description="sub-only link")

    client = bodybuilding_app.app.test_client()
    _login(client, "anc_admin")

    resp = client.get(f"/get_links?community_id={sub_id}")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert any(l["description"] == "sub-only link" for l in payload["links"])


def test_get_links_invalid_community_id_returns_400(mysql_dsn):
    import bodybuilding_app

    make_user("invalid_cid_user", subscription="free")
    client = bodybuilding_app.app.test_client()
    _login(client, "invalid_cid_user")

    resp = client.get("/get_links?community_id=not-an-int")
    assert resp.status_code == 400


def test_get_links_invalid_group_id_returns_400(mysql_dsn):
    import bodybuilding_app

    make_user("invalid_gid_owner", subscription="premium")
    community_id = make_community("invalid-gid", creator_username="invalid_gid_owner")

    client = bodybuilding_app.app.test_client()
    _login(client, "invalid_gid_owner")

    resp = client.get(
        f"/get_links?community_id={community_id}&group_id=not-an-int"
    )
    assert resp.status_code == 400


def test_useful_docs_missing_details_column_does_not_drop_docs(mysql_dsn):
    """If a deployment is missing the ``details`` column, docs should still
    load with empty details strings rather than the whole list being
    silently dropped."""
    import bodybuilding_app

    make_user("missing_details_owner", subscription="premium")
    community_id = make_community(
        "missing-details", creator_username="missing_details_owner"
    )
    doc_id = _insert_doc(
        community_id, "missing_details_owner",
        description="legacy doc", details="should not surface",
    )

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("ALTER TABLE useful_docs DROP COLUMN details")
        conn.commit()

    try:
        client = bodybuilding_app.app.test_client()
        _login(client, "missing_details_owner")

        resp = client.get(f"/get_links?community_id={community_id}")
        assert resp.status_code == 200
        payload = resp.get_json()
        assert payload["success"] is True
        assert len(payload["docs"]) == 1
        assert payload["docs"][0]["id"] == doc_id
        assert payload["docs"][0]["details"] == ""
    finally:
        with get_db_connection() as conn:
            c = conn.cursor()
            try:
                c.execute("ALTER TABLE useful_docs ADD COLUMN details TEXT")
            except Exception:
                pass
            conn.commit()


def test_useful_docs_missing_group_id_falls_back_to_community_filter(mysql_dsn):
    """A schema missing ``group_id`` should fall back to the
    community-only filter rather than returning an empty docs list."""
    import bodybuilding_app

    make_user("missing_gid_owner", subscription="premium")
    community_id = make_community(
        "missing-gid", creator_username="missing_gid_owner"
    )
    _insert_doc(
        community_id, "missing_gid_owner",
        description="visible despite missing group_id",
    )

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("ALTER TABLE useful_docs DROP COLUMN group_id")
        c.execute("ALTER TABLE useful_links DROP COLUMN group_id")
        conn.commit()

    try:
        client = bodybuilding_app.app.test_client()
        _login(client, "missing_gid_owner")

        resp = client.get(f"/get_links?community_id={community_id}")
        assert resp.status_code == 200
        payload = resp.get_json()
        assert payload["success"] is True
        assert len(payload["docs"]) == 1
        assert payload["docs"][0]["description"] == "visible despite missing group_id"
    finally:
        with get_db_connection() as conn:
            c = conn.cursor()
            try:
                c.execute("ALTER TABLE useful_docs ADD COLUMN group_id INT NULL")
            except Exception:
                pass
            try:
                c.execute("ALTER TABLE useful_links ADD COLUMN group_id INT NULL")
            except Exception:
                pass
            conn.commit()
