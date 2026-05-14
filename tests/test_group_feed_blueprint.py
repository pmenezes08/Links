"""HTTP smoke for group feed blueprint (key posts access, not chat)."""

from __future__ import annotations

from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _insert_group(community_id: int, name: str, created_by: str) -> int:
    from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

    g_t = "`groups`" if USE_MYSQL else "groups"
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO {g_t} (community_id, name, approval_required, created_by) VALUES ({ph}, {ph}, 0, {ph})",
            (community_id, name, created_by),
        )
        gid = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass
    return int(gid)


def _add_group_member(group_id: int, username: str) -> None:
    from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

    gm_t = "`group_members`" if USE_MYSQL else "group_members"
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO {gm_t} (group_id, username, status) VALUES ({ph}, {ph}, 'member')",
            (group_id, username),
        )
        try:
            conn.commit()
        except Exception:
            pass


def test_group_key_posts_non_member_forbidden(mysql_dsn):
    import bodybuilding_app

    make_user("gf_owner", subscription="premium")
    make_user("gf_stranger", subscription="free")
    cid = make_community("gf-comm-a", tier="free", creator_username="gf_owner")
    gid = _insert_group(cid, "G1", "gf_owner")
    _add_group_member(gid, "gf_owner")

    client = bodybuilding_app.app.test_client()
    _login(client, "gf_stranger")
    r = client.get(f"/api/group_key_posts/{gid}")
    assert r.status_code == 403
    body = r.get_json()
    assert body is not None
    assert body.get("success") is False


def test_group_key_posts_member_empty_list(mysql_dsn):
    import bodybuilding_app

    make_user("gf_owner2", subscription="premium")
    make_user("gf_member", subscription="free")
    cid = make_community("gf-comm-b", tier="free", creator_username="gf_owner2")
    gid = _insert_group(cid, "G2", "gf_owner2")
    _add_group_member(gid, "gf_owner2")
    _add_group_member(gid, "gf_member")

    client = bodybuilding_app.app.test_client()
    _login(client, "gf_member")
    r = client.get(f"/api/group_key_posts/{gid}")
    assert r.status_code == 200
    body = r.get_json()
    assert body is not None
    assert body.get("success") is True
    assert body.get("posts") == []

    ry = client.get(f"/api/group_key_posts/{gid}?tab=yours")
    assert ry.status_code == 200
    jy = ry.get_json()
    assert jy is not None
    assert jy.get("success") is True
    assert jy.get("posts") == []


def test_group_replies_delete_requires_login():
    import bodybuilding_app

    client = bodybuilding_app.app.test_client()
    r = client.post("/api/group_replies/delete", data={"reply_id": 1})
    assert r.status_code == 401
