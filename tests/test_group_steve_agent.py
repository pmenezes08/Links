"""Steve group agent: package gate, schedule, @Steve cancel."""

from __future__ import annotations

import pytest

from tests.fixtures import make_community, make_user
from tests.test_group_feed_blueprint import _add_group_member, _insert_group


_schema_ready = False


@pytest.fixture(autouse=True)
def _ensure_group_schema(mysql_dsn):
    """Add the ``groups`` columns this suite writes that the conftest's
    minimal shape lacks (``approval_required``, ``created_by``).

    Deliberately surgical: running the monolith's full ``add_missing_tables()``
    here instead breaks under MySQL when it runs before other suites have
    created their tables (its legacy DDL indexes a TEXT ``date`` column,
    errno 1170). Steve-agent columns are handled by the route itself via
    ``ensure_group_steve_agent_schema``.
    """
    global _schema_ready
    if not _schema_ready:
        from backend.services.database import get_db_connection

        with get_db_connection() as conn:
            c = conn.cursor()
            for ddl in (
                "ALTER TABLE `groups` ADD COLUMN approval_required TINYINT(1) NOT NULL DEFAULT 0",
                "ALTER TABLE `groups` ADD COLUMN created_by VARCHAR(191) NULL",
                # FK-free minimal clones (same pattern as test_owner_analytics):
                # production DDL declares FKs to users(username) that the
                # conftest schema can't satisfy.
                """
                CREATE TABLE IF NOT EXISTS `group_members` (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    group_id INT NOT NULL,
                    username VARCHAR(191) NOT NULL,
                    status VARCHAR(32) DEFAULT 'member',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_gm (group_id, username)
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS `group_posts` (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    group_id INT NOT NULL,
                    username VARCHAR(191) NOT NULL,
                    content TEXT,
                    image_path TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS `group_replies` (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    group_post_id INT NOT NULL,
                    parent_reply_id INT NULL,
                    username VARCHAR(191) NOT NULL,
                    content TEXT,
                    image_path TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS `group_post_reactions` (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    group_post_id INT NOT NULL,
                    username VARCHAR(191) NOT NULL,
                    reaction VARCHAR(32) NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_gpr (group_post_id, username)
                )
                """,
                """
                CREATE TABLE IF NOT EXISTS `group_reply_reactions` (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    group_reply_id INT NOT NULL,
                    username VARCHAR(191) NOT NULL,
                    reaction VARCHAR(32) NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_grr (group_reply_id, username)
                )
                """,
            ):
                try:
                    c.execute(ddl)
                except Exception:
                    pass
            try:
                conn.commit()
            except Exception:
                pass
        _schema_ready = True


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

    make_user("grp_res_u")
    cid = make_community("grp-res-comm", tier="free", creator_username="grp_res_u")
    gid = _insert_group(cid, "GrpRes", "grp_res_u")
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        # Minimal FK-free shapes (calling the monolith's add_missing_tables()
        # here instead hits errno 1170 under MySQL depending on suite order —
        # see the module fixture's docstring).
        for ddl in (
            """
            CREATE TABLE IF NOT EXISTS useful_links (
                id INT PRIMARY KEY AUTO_INCREMENT,
                community_id INT NULL,
                group_id INT NULL,
                username VARCHAR(191),
                url TEXT,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS useful_docs (
                id INT PRIMARY KEY AUTO_INCREMENT,
                community_id INT NULL,
                group_id INT NULL,
                username VARCHAR(191),
                file_path TEXT,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """,
        ):
            try:
                c.execute(ddl)
            except Exception:
                pass
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


# ── Group creation permissions (2026-07: opened up from app-admin-only) ──
#
# /api/groups/create was historically gated to is_app_admin_or_paulo, which
# blocked every real community owner — including the first Enterprise owner.
# The rule is now: app admin OR owner/admin of the target community or of
# its root network. Free-plan roots still keep groups at the parent level,
# but Enterprise roots are structure-exempt at any depth.


def test_groups_create_allows_community_owner(mysql_dsn):
    """A plain (non-app-admin) owner can create a group in their community."""
    import bodybuilding_app
    from backend.services.database import get_db_connection, get_sql_placeholder

    make_user("grp_owner_plain", subscription="premium")
    cid = make_community("grp-owner-net", tier="paid_l1", creator_username="grp_owner_plain")

    client = bodybuilding_app.app.test_client()
    _login(client, "grp_owner_plain")
    r = client.post(
        "/api/groups/create",
        data={"community_id": str(cid), "name": "Owner Group", "approval_required": "0"},
    )
    assert r.status_code == 200
    body = r.get_json() or {}
    assert body.get("success") is True

    # The creator must be a member of their own group immediately —
    # otherwise the UI shows it under "Available" with a Join button.
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT status FROM `group_members` WHERE group_id = {ph} AND username = {ph}",
            (int(body["group_id"]), "grp_owner_plain"),
        )
        row = c.fetchone()
    assert row is not None
    assert (row["status"] if hasattr(row, "keys") else row[0]) == "member"


def test_groups_create_rejects_regular_member(mysql_dsn):
    """Someone who neither owns nor administers the community gets 403."""
    import bodybuilding_app

    make_user("grp_owner_x", subscription="premium")
    make_user("grp_rando")
    cid = make_community("grp-perm-net", tier="paid_l1", creator_username="grp_owner_x")

    client = bodybuilding_app.app.test_client()
    _login(client, "grp_rando")
    r = client.post(
        "/api/groups/create",
        data={"community_id": str(cid), "name": "Sneaky Group", "approval_required": "0"},
    )
    assert r.status_code == 403


def test_groups_create_root_owner_can_create_in_sub(mysql_dsn):
    """Owning the root grants group creation inside its sub-communities."""
    import bodybuilding_app

    make_user("grp_root_owner", subscription="premium")
    root = make_community("grp-root-net", tier="paid_l1", creator_username="grp_root_owner")
    sub = make_community("grp-sub-net", tier="free", parent_community_id=root)

    client = bodybuilding_app.app.test_client()
    _login(client, "grp_root_owner")
    r = client.post(
        "/api/groups/create",
        data={"community_id": str(sub), "name": "Sub Group", "approval_required": "0"},
    )
    assert r.status_code == 200
    assert (r.get_json() or {}).get("success") is True


def test_groups_create_free_owner_allowed_on_sub_level(mysql_dsn):
    """Groups live at any level, on any tier.

    Until July 2026 a Free-plan root owner got 403 'groups only at the
    parent community level' for every sub-community — a leftover from when
    only app admins created groups. Owners must be able to organise their
    own tree.
    """
    import bodybuilding_app

    make_user("grp_free_owner", subscription="free")
    root = make_community("grp-free-root", tier="free", creator_username="grp_free_owner")
    sub = make_community("grp-free-sub", tier="free", parent_community_id=root)

    client = bodybuilding_app.app.test_client()
    _login(client, "grp_free_owner")
    r = client.post(
        "/api/groups/create",
        data={"community_id": str(sub), "name": "Sub Group", "approval_required": "0"},
    )
    assert r.status_code == 200
    assert (r.get_json() or {}).get("success") is True


def test_groups_create_at_any_nesting_depth(mysql_dsn):
    """Root owner can create a group in a grandchild community."""
    import bodybuilding_app

    make_user("grp_deep_owner", subscription="free")
    root = make_community("grp-deep-root", tier="free", creator_username="grp_deep_owner")
    sub = make_community("grp-deep-sub", tier="free", parent_community_id=root)
    nested = make_community("grp-deep-nested", tier="free", parent_community_id=sub)

    client = bodybuilding_app.app.test_client()
    _login(client, "grp_deep_owner")
    r = client.post(
        "/api/groups/create",
        data={"community_id": str(nested), "name": "Deep Group", "approval_required": "0"},
    )
    assert r.status_code == 200
    assert (r.get_json() or {}).get("success") is True


def test_groups_create_enterprise_sub_by_free_owner(mysql_dsn):
    """The TAP shape: Free personal plan + Enterprise root ⇒ groups anywhere."""
    import bodybuilding_app

    make_user("grp_ent_owner", subscription="free")
    root = make_community("grp-ent-root", tier="enterprise", creator_username="grp_ent_owner")
    sub = make_community("grp-ent-sub", tier="free", parent_community_id=root)

    client = bodybuilding_app.app.test_client()
    _login(client, "grp_ent_owner")
    r = client.post(
        "/api/groups/create",
        data={"community_id": str(sub), "name": "Crew Group", "approval_required": "0"},
    )
    assert r.status_code == 200
    assert (r.get_json() or {}).get("success") is True


def _join_community(username: str, community_id: int) -> None:
    from backend.services.database import get_db_connection, get_sql_placeholder

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        uid = int(row["id"] if hasattr(row, "keys") else row[0])
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role) VALUES ({ph}, {ph}, 'member')",
            (uid, community_id),
        )
        try:
            conn.commit()
        except Exception:
            pass


def test_groups_my_enrichment_and_request_flow(mysql_dsn):
    """End-to-end: approval-required group → pending request → owner sees
    counts and approves → requester becomes a member.

    Also pins the /api/groups/my enrichment (member_count, pending_count,
    approval_required, status='pending' rows in `joined`)."""
    import bodybuilding_app

    make_user("greq_owner", subscription="premium")
    make_user("greq_member")
    make_user("greq_rando")
    cid = make_community("greq-net", tier="paid_l1", creator_username="greq_owner")
    # /api/groups/my early-returns empty for users with no user_communities
    # rows — owners are community members in prod, so mirror that here.
    _join_community("greq_owner", cid)
    _join_community("greq_member", cid)

    owner = bodybuilding_app.app.test_client()
    _login(owner, "greq_owner")
    r = owner.post(
        "/api/groups/create",
        data={"community_id": str(cid), "name": "Crew Room", "approval_required": "1"},
    )
    gid = (r.get_json() or {}).get("group_id")
    assert gid

    member = bodybuilding_app.app.test_client()
    _login(member, "greq_member")
    r2 = member.post("/api/groups/join", data={"group_id": str(gid)})
    assert (r2.get_json() or {}).get("success") is True

    # Requester sees the group as pending inside `joined`.
    j3 = member.get("/api/groups/my").get_json()
    mine = [g for g in j3["joined"] if g["group_id"] == gid]
    assert mine and mine[0]["status"] == "pending"

    # Owner card data: 1 member (the creator), 1 pending, approval flag on.
    j4 = owner.get("/api/groups/my").get_json()
    own = [g for g in j4["joined"] if g["group_id"] == gid][0]
    assert own["status"] == "member"
    assert own["member_count"] == 1
    assert own["pending_count"] == 1
    assert own["approval_required"] is True

    # Requests list is owner/admin territory.
    j5 = owner.get(f"/api/groups/{gid}/requests").get_json()
    assert [x["username"] for x in j5["requests"]] == ["greq_member"]

    rando = bodybuilding_app.app.test_client()
    _login(rando, "greq_rando")
    assert rando.get(f"/api/groups/{gid}/requests").status_code == 403

    # Approve → requester is a member, queue empties, counts move.
    r6 = owner.post(
        f"/api/groups/{gid}/requests/decide",
        json={"username": "greq_member", "decision": "approve"},
    )
    assert (r6.get_json() or {}).get("success") is True
    assert (owner.get(f"/api/groups/{gid}/requests").get_json() or {})["requests"] == []
    j8 = member.get("/api/groups/my").get_json()
    mine2 = [g for g in j8["joined"] if g["group_id"] == gid]
    assert mine2 and mine2[0]["status"] == "member"


def test_group_request_deny_removes_the_row(mysql_dsn):
    import bodybuilding_app

    make_user("gden_owner", subscription="premium")
    make_user("gden_member")
    cid = make_community("gden-net", tier="paid_l1", creator_username="gden_owner")
    _join_community("gden_owner", cid)
    _join_community("gden_member", cid)

    owner = bodybuilding_app.app.test_client()
    _login(owner, "gden_owner")
    gid = (owner.post(
        "/api/groups/create",
        data={"community_id": str(cid), "name": "Deny Room", "approval_required": "1"},
    ).get_json() or {}).get("group_id")

    member = bodybuilding_app.app.test_client()
    _login(member, "gden_member")
    member.post("/api/groups/join", data={"group_id": str(gid)})

    r = owner.post(
        f"/api/groups/{gid}/requests/decide",
        json={"username": "gden_member", "decision": "deny"},
    )
    assert (r.get_json() or {}).get("success") is True
    # Denied → no membership row at all: not pending, not member.
    j = member.get("/api/groups/my").get_json()
    assert not [g for g in j["joined"] if g["group_id"] == gid]
    # Idempotent: deciding again is success with changed=False.
    r2 = owner.post(
        f"/api/groups/{gid}/requests/decide",
        json={"username": "gden_member", "decision": "deny"},
    )
    body2 = r2.get_json() or {}
    assert body2.get("success") is True
    assert body2.get("changed") is False
