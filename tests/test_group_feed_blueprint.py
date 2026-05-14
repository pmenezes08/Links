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


def _insert_group_post(group_id: int, username: str, content: str = "hello") -> int:
    from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO {gp_t} (group_id, username, content, image_path) VALUES ({ph}, {ph}, {ph}, NULL)",
            (group_id, username, content),
        )
        pid = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass
    return int(pid)


def _insert_group_reply(
    group_post_id: int,
    username: str,
    content: str = "reply body",
    parent_reply_id: int | None = None,
) -> int:
    from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

    gr_t = "`group_replies`" if USE_MYSQL else "group_replies"
    ph = get_sql_placeholder()
    now = "2020-01-01 12:00:00"
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO {gr_t} (group_post_id, parent_reply_id, username, content, image_path, created_at) "
            f"VALUES ({ph},{ph},{ph},{ph}, NULL, {ph})",
            (group_post_id, parent_reply_id, username, content, now),
        )
        rid = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass
    return int(rid)


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


def test_group_feed_200_when_poll_loader_raises(mysql_dsn, monkeypatch):
    """Missing or broken poll tables must not 500 the whole feed."""
    import bodybuilding_app

    def _boom(*_a, **_kw):
        raise Exception('(1146, "Table \'cpoint.group_polls\' doesn\'t exist")')

    monkeypatch.setattr(
        "backend.services.group_feed_detail.load_polls_for_group_posts",
        _boom,
    )

    make_user("gf_pe_owner", subscription="premium")
    make_user("gf_pe_mem", subscription="free")
    cid = make_community("gf-poll-res", tier="free", creator_username="gf_pe_owner")
    gid = _insert_group(cid, "GRes", "gf_pe_owner")
    _add_group_member(gid, "gf_pe_owner")
    _add_group_member(gid, "gf_pe_mem")
    _insert_group_post(gid, "gf_pe_owner", "one post so poll loader runs")

    client = bodybuilding_app.app.test_client()
    _login(client, "gf_pe_mem")
    r = client.get(f"/api/group_feed?group_id={gid}")
    assert r.status_code == 200
    body = r.get_json()
    assert body is not None
    assert body.get("success") is True
    posts = body.get("posts") or []
    assert len(posts) >= 1
    assert posts[0].get("poll") is None


def test_group_reply_thread_get_member(mysql_dsn):
    import bodybuilding_app

    make_user("gf_tr_owner", subscription="premium")
    make_user("gf_tr_membf", subscription="free")
    cid = make_community("gf-tr-a", tier="free", creator_username="gf_tr_owner")
    gid = _insert_group(cid, "GThr", "gf_tr_owner")
    _add_group_member(gid, "gf_tr_owner")
    _add_group_member(gid, "gf_tr_membf")
    pid = _insert_group_post(gid, "gf_tr_owner", "post for thread")
    rid = _insert_group_reply(pid, "gf_tr_owner", "top reply")

    client = bodybuilding_app.app.test_client()
    _login(client, "gf_tr_membf")
    r = client.get(f"/api/group_reply/{rid}")
    assert r.status_code == 200
    body = r.get_json()
    assert body is not None
    assert body.get("success") is True
    assert body.get("reply", {}).get("id") == rid
    assert body.get("post", {}).get("id") == pid
    assert body.get("post", {}).get("is_group_post") is True


def test_group_reply_thread_non_member_forbidden(mysql_dsn):
    import bodybuilding_app

    make_user("gf_tr_owner2", subscription="premium")
    make_user("gf_tr_str", subscription="free")
    cid = make_community("gf-tr-b", tier="free", creator_username="gf_tr_owner2")
    gid = _insert_group(cid, "GThrB", "gf_tr_owner2")
    _add_group_member(gid, "gf_tr_owner2")
    pid = _insert_group_post(gid, "gf_tr_owner2", "post")
    rid = _insert_group_reply(pid, "gf_tr_owner2", "repl")

    client = bodybuilding_app.app.test_client()
    _login(client, "gf_tr_str")
    r = client.get(f"/api/group_reply/{rid}")
    assert r.status_code == 403
    body = r.get_json()
    assert body is not None
    assert body.get("success") is False
