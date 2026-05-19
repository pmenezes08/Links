"""Steve group agent: package gate, schedule, @Steve cancel."""

from __future__ import annotations

from tests.fixtures import make_community, make_user
from tests.test_group_feed_blueprint import _add_group_member, _insert_group


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def test_groups_create_rejects_agent_without_steve_package(mysql_dsn):
    import bodybuilding_app
    from backend.services import community_billing

    community_billing.ensure_tables()
    make_user("gsa_admin", is_admin=True)
    cid = make_community("gsa-net", tier="paid_l1", creator_username="gsa_admin")

    client = bodybuilding_app.app.test_client()
    _login(client, "gsa_admin")
    r = client.post(
        "/api/groups/create",
        data={
            "community_id": str(cid),
            "name": "Agent Group",
            "approval_required": "0",
            "steve_agent_enabled": "1",
            "steve_agent_preset": "career_expert",
        },
    )
    assert r.status_code == 400
    body = r.get_json()
    assert body is not None
    assert "Steve Community Package" in (body.get("error") or "")


def test_groups_create_accepts_agent_with_steve_package(mysql_dsn):
    import bodybuilding_app
    from backend.services import community_billing

    community_billing.ensure_tables()
    make_user("gsa_admin2", is_admin=True)
    cid = make_community("gsa-net2", tier="paid_l1", creator_username="gsa_admin2")
    community_billing.mark_steve_package_subscription(
        cid,
        subscription_id="sub_gsa_test",
        status="active",
        current_period_end="2030-12-31",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "gsa_admin2")
    r = client.post(
        "/api/groups/create",
        data={
            "community_id": str(cid),
            "name": "Agent Group OK",
            "approval_required": "0",
            "steve_agent_enabled": "1",
            "steve_agent_preset": "career_expert",
        },
    )
    assert r.status_code == 200
    body = r.get_json()
    assert body is not None
    assert body.get("success") is True
    gid = body.get("group_id")
    assert isinstance(gid, int)
    wpid = body.get("welcome_group_post_id")
    assert isinstance(wpid, int)
    from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT username, content, group_id FROM {gp_t} WHERE id = {ph}", (wpid,))
        row = c.fetchone()
    assert row is not None
    u = row["username"] if hasattr(row, "keys") else row[0]
    assert str(u).lower() == "steve"
    content = row["content"] if hasattr(row, "keys") else row[1]
    assert "Career Expert" in (content or "")
    assert "Agent Group OK" in (content or "")
    assert "gsa_admin2" in (content or "")
    gid_db = row["group_id"] if hasattr(row, "keys") else row[2]
    assert int(gid_db) == int(gid)


def test_groups_create_no_agent_welcome_post_without_flag(mysql_dsn):
    import bodybuilding_app
    from backend.services import community_billing
    from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

    community_billing.ensure_tables()
    make_user("gsa_plain", is_admin=True)
    cid = make_community("gsa-plain", tier="paid_l1", creator_username="gsa_plain")
    community_billing.mark_steve_package_subscription(
        cid,
        subscription_id="sub_plain",
        status="active",
        current_period_end="2030-12-31",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "gsa_plain")
    r = client.post(
        "/api/groups/create",
        data={
            "community_id": str(cid),
            "name": "No Agent Group",
            "approval_required": "0",
        },
    )
    assert r.status_code == 200
    body = r.get_json()
    assert body is not None
    assert body.get("welcome_group_post_id") is None
    gid = int(body["group_id"])
    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT COUNT(*) AS c FROM {gp_t} WHERE group_id = {ph}", (gid,))
        row = c.fetchone()
        n = int(row["c"] if hasattr(row, "keys") else row[0])
    assert n == 0


def test_steve_mention_in_group_reply_cancels_schedule(mysql_dsn):
    import bodybuilding_app
    from backend.services import community_billing
    from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

    community_billing.ensure_tables()
    make_user("gsa_owner", is_admin=True)
    make_user("gsa_member", subscription="premium")
    cid = make_community("gsa-net3", tier="paid_l1", creator_username="gsa_owner")
    community_billing.mark_steve_package_subscription(
        cid,
        subscription_id="sub_gsa_3",
        status="active",
        current_period_end="2030-12-31",
    )
    gid = _insert_group(cid, "Gsched", "gsa_owner")
    _add_group_member(gid, "gsa_owner")
    _add_group_member(gid, "gsa_member")

    ph = get_sql_placeholder()
    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    with get_db_connection() as conn:
        c = conn.cursor()
        from backend.services.group_steve_agent import ensure_group_steve_agent_schema

        ensure_group_steve_agent_schema(c)
        c.execute(
            f"INSERT INTO {gp_t} (group_id, username, content, image_path, ask_steve) "
            f"VALUES ({ph}, {ph}, {ph}, NULL, 1)",
            (gid, "gsa_member", "x" * 100),
        )
        post_id = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass

    from backend.services.group_steve_agent import ensure_group_steve_agent_schema, schedule_agent_first_reply

    with get_db_connection() as conn:
        c = conn.cursor()
        ensure_group_steve_agent_schema(c)
        schedule_agent_first_reply(c, int(post_id), "gsa_member")
        try:
            conn.commit()
        except Exception:
            pass

    sch = "`group_steve_agent_schedule`" if USE_MYSQL else "group_steve_agent_schedule"
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT COUNT(*) AS c FROM {sch} WHERE group_post_id = {ph} AND cancelled = 0", (int(post_id),))
        row = c.fetchone()
        pending = int(row["c"] if hasattr(row, "keys") else row[0])
    assert pending == 1

    client = bodybuilding_app.app.test_client()
    _login(client, "gsa_member")
    r = client.post(
        "/api/group_replies",
        data={
            "group_post_id": str(post_id),
            "content": "Hi @Steve quick question",
        },
    )
    assert r.status_code == 200

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT cancelled FROM {sch} WHERE group_post_id = {ph}", (int(post_id),))
        row2 = c.fetchone()
        assert row2 is not None
        cancelled = int(row2["cancelled"] if hasattr(row2, "keys") else row2[0])
    assert cancelled == 1


def test_short_ask_steve_post_does_not_create_schedule(mysql_dsn):
    import bodybuilding_app
    from backend.services import community_billing
    from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

    community_billing.ensure_tables()
    make_user("gsa_admin4", is_admin=True)
    cid = make_community("gsa-net4", tier="paid_l1", creator_username="gsa_admin4")
    community_billing.mark_steve_package_subscription(
        cid,
        subscription_id="sub_gsa_4",
        status="active",
        current_period_end="2030-12-31",
    )

    ph = get_sql_placeholder()
    g_t = "`groups`" if USE_MYSQL else "groups"
    with get_db_connection() as conn:
        c = conn.cursor()
        from backend.services.group_steve_agent import ensure_group_steve_agent_schema, PRESET_CAREER_EXPERT

        ensure_group_steve_agent_schema(c)
        c.execute(
            f"""
            INSERT INTO {g_t} (community_id, name, approval_required, created_by,
                steve_agent_enabled, steve_agent_preset, steve_proactive_enabled)
            VALUES ({ph}, {ph}, 0, {ph}, 1, {ph}, 0)
            """,
            (cid, "Shorty Group", "gsa_admin4", PRESET_CAREER_EXPERT),
        )
        gid = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass
    gid = int(gid)
    _add_group_member(gid, "gsa_admin4")

    client = bodybuilding_app.app.test_client()
    _login(client, "gsa_admin4")
    r = client.post(
        "/api/group_posts",
        data={
            "group_id": str(gid),
            "content": "short",
            "ask_steve": "1",
        },
    )
    assert r.status_code == 200

    gp_t = "`group_posts`" if USE_MYSQL else "group_posts"
    sch = "`group_steve_agent_schedule`" if USE_MYSQL else "group_steve_agent_schedule"
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM {gp_t} WHERE group_id = {ph} ORDER BY id DESC LIMIT 1", (gid,))
        pr = c.fetchone()
        assert pr is not None
        pid = int(pr["id"] if hasattr(pr, "keys") else pr[0])
        c.execute(f"SELECT COUNT(*) AS c FROM {sch} WHERE group_post_id = {ph}", (pid,))
        row = c.fetchone()
        n = int(row["c"] if hasattr(row, "keys") else row[0])
    assert n == 0


def test_group_steve_does_not_build_community_context(monkeypatch, mysql_dsn):
    """Exclusive-group Steve must not call _build_steve_community_context (parent-community bundle)."""
    import bodybuilding_app as ba
    from tests.test_group_feed_blueprint import _add_group_member, _insert_group, _insert_group_post

    make_user("gsc_owner", subscription="premium")
    make_user("gsc_member", subscription="premium")
    cid = make_community("gsc-comm", tier="free", creator_username="gsc_owner")
    gid = _insert_group(cid, "Gctx", "gsc_owner")
    _add_group_member(gid, "gsc_owner")
    _add_group_member(gid, "gsc_member")
    pid = _insert_group_post(gid, "gsc_owner", "hello group post for steve context test")

    class _Resp:
        output_text = "Steve says OK."

    class _Client:
        def __init__(self, *a, **k):
            pass

        class _R:
            @staticmethod
            def create(**kwargs):
                return _Resp()

        responses = _R()

    monkeypatch.setattr(ba, "XAI_API_KEY", "test-key")
    monkeypatch.setattr(ba, "OpenAI", _Client)

    def _forbidden(*args, **kwargs):
        raise AssertionError("_build_steve_community_context must not run for group Steve")

    monkeypatch.setattr(ba, "_build_steve_community_context", _forbidden)

    client = ba.app.test_client()
    with client.session_transaction() as sess:
        sess["username"] = "gsc_member"

    r = client.post(
        "/api/ai/steve_reply",
        json={
            "post_id": pid,
            "user_message": "What is on the community calendar this week?",
            "community_id": cid,
            "is_group_post": True,
        },
    )
    assert r.status_code == 200
    body = r.get_json()
    assert body is not None
    assert body.get("success") is True


def test_build_steve_group_resource_context_includes_scoped_links_and_docs(mysql_dsn):
    """``useful_links`` / ``useful_docs`` rows with ``group_id`` appear in group resource context."""
    from datetime import datetime

    import bodybuilding_app as ba
    from backend.services.database import get_db_connection, get_sql_placeholder

    from tests.test_group_feed_blueprint import _insert_group

    ba.add_missing_tables()
    make_user("grp_res_u")
    cid = make_community("grp-res-comm", tier="free", creator_username="grp_res_u")
    gid = _insert_group(cid, "GrpRes", "grp_res_u")
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO useful_links (community_id, group_id, username, url, description, created_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (None, gid, "grp_res_u", "https://group-only.example/doc", "Group-scoped link label", ts),
        )
        c.execute(
            f"""
            INSERT INTO useful_docs (community_id, group_id, username, file_path, description, created_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (None, gid, "grp_res_u", "/nonexistent.pdf", "Group-scoped doc title", ts),
        )
        conn.commit()
        out = ba._build_steve_group_resource_context(c, gid, ph)
    assert "Useful links in this group" in out
    assert "Group-scoped link label" in out
    assert "https://group-only.example/doc" in out
    assert "Group documents" in out
    assert "Group-scoped doc title" in out
