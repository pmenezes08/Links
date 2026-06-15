"""Owner Dashboard analytics endpoint.

Locks down the invariants that matter most:

  1. Authorization is server-side and non-enumerating — an outsider (and a
     missing community) get the same 404, never a leak that the community
     exists.
  2. Owner, delegated community admin, and app admin can all read.
  3. Aggregates are correct and **scoped to one community** — community A's
     overview never counts community B's members (the cross-community leak
     guard).
  4. Profile completion buckets (none/partial/complete) match the canonical
     per-member section logic, reported as aggregates only.
  5. Paid teasers are locked-but-present on a free community, with the value
     withheld (never computed/leaked).

Service-level aggregation is exercised through the real HTTP surface so the
auth gate and the JSON contract are covered together.
"""

from __future__ import annotations

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _ensure_profile_columns() -> None:
    """Add the durable profile columns the completion logic reads (the base
    test schema only ships a thin ``users`` table)."""
    with get_db_connection() as conn:
        c = conn.cursor()
        for col, ddl in (
            ("role", "TEXT NULL"),
            ("company", "TEXT NULL"),
            ("linkedin", "TEXT NULL"),
            ("professional_about", "TEXT NULL"),
            ("personal_highlight_answers", "TEXT NULL"),
        ):
            try:
                c.execute(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
            except Exception:
                pass
        try:
            conn.commit()
        except Exception:
            pass


def _add_member(username: str, community_id: int, *, role: str = "member") -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        assert row, f"user {username} must exist"
        uid = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role) "
            f"VALUES ({ph}, {ph}, {ph})",
            (uid, community_id, role),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _set_professional(username: str) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE users SET role = {ph}, company = {ph} WHERE username = {ph}",
            ("Engineer", "Acme", username),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _set_personal_bio(username: str) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if ph == "%s":
            c.execute(
                f"INSERT INTO user_profiles (username, bio) VALUES ({ph}, {ph}) "
                f"ON DUPLICATE KEY UPDATE bio = VALUES(bio)",
                (username, "Here for the community."),
            )
        else:
            c.execute(
                f"INSERT OR REPLACE INTO user_profiles (username, bio) VALUES ({ph}, {ph})",
                (username, "Here for the community."),
            )
        try:
            conn.commit()
        except Exception:
            pass


def _overview(client, community_id: int):
    return client.get(f"/api/community/{community_id}/analytics/overview")


def _overview_scoped(client, community_id: int, scope: str):
    return client.get(f"/api/community/{community_id}/analytics/overview?scope={scope}")


def _set_paid(community_id: int) -> None:
    """Make a community resolve as paid (network rollup is a paid feature)."""
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute("ALTER TABLE communities ADD COLUMN subscription_status VARCHAR(32) NULL")
        except Exception:
            pass
        try:
            c.execute(
                f"UPDATE communities SET tier = 'paid_l1', subscription_status = 'active' WHERE id = {ph}",
                (community_id,),
            )
        except Exception:
            pass
        try:
            conn.commit()
        except Exception:
            pass


def _by_id(body):
    return {m["id"]: m for m in body["metrics"]}


def test_overview_requires_login(mysql_dsn):
    import bodybuilding_app

    client = bodybuilding_app.app.test_client()
    cid = make_community("Dash NoAuth", creator_username="ownerA")
    assert _overview(client, cid).status_code == 401


def test_outsider_and_missing_community_both_404(mysql_dsn):
    import bodybuilding_app

    make_user("ownerA")
    make_user("stranger")
    client = bodybuilding_app.app.test_client()
    cid = make_community("Dash A", creator_username="ownerA")

    _login(client, "stranger")
    assert _overview(client, cid).status_code == 404  # not theirs → closed door

    _login(client, "ownerA")
    assert _overview(client, 99999999).status_code == 404  # missing → same door


def test_owner_sees_correct_aggregates_and_locked_teasers(mysql_dsn):
    import bodybuilding_app

    _ensure_profile_columns()
    make_user("ownerA")
    make_user("m_none")
    make_user("m_pro")
    make_user("m_both")
    client = bodybuilding_app.app.test_client()

    A = make_community("Dash A", tier="free", creator_username="ownerA")
    for u in ("m_none", "m_pro", "m_both"):
        _add_member(u, A)
    _set_professional("m_pro")
    _set_professional("m_both")
    _set_personal_bio("m_both")

    # The platform 'admin' is a silent member of every community and must be
    # excluded from every stat.
    make_user("admin")
    _add_member("admin", A)

    _login(client, "ownerA")
    resp = _overview(client, A)
    assert resp.status_code == 200
    body = resp.get_json()

    assert body["community"]["id"] == A
    assert body["community"]["is_paid"] is False

    metrics = _by_id(body)
    assert metrics["members"]["value"]["count"] == 3   # admin excluded

    comp = metrics["profile_completion"]["value"]
    assert comp["total"] == 3
    assert comp["complete"] == 1   # m_both: professional + personal
    assert comp["partial"] == 1    # m_pro: professional only
    assert comp["none"] == 1       # m_none: neither

    # Paid teasers present but locked on a free community, value withheld.
    assert metrics["activation"]["tier"] == "paid"
    assert metrics["activation"]["locked"] is True
    assert metrics["activation"]["value"] is None

    # Steve narration is a template choice + numbers, never an AI call here.
    assert body["steve"]["read_key"]


def test_no_cross_community_leak(mysql_dsn):
    import bodybuilding_app

    _ensure_profile_columns()
    for u in ("ownerA", "ownerB", "a1", "a2", "b1"):
        make_user(u)
    client = bodybuilding_app.app.test_client()

    A = make_community("Dash A", creator_username="ownerA")
    B = make_community("Dash B", creator_username="ownerB")
    _add_member("a1", A)
    _add_member("a2", A)
    _add_member("b1", B)

    _login(client, "ownerA")
    a_body = _overview(client, A).get_json()
    assert _by_id(a_body)["members"]["value"]["count"] == 2  # only A's members

    # Owner of A cannot read B's analytics at all.
    assert _overview(client, B).status_code == 404


def test_delegated_admin_and_app_admin_can_view(mysql_dsn):
    import bodybuilding_app

    _ensure_profile_columns()
    make_user("ownerA")
    make_user("modA")
    make_user("siteadmin", is_admin=True)
    client = bodybuilding_app.app.test_client()

    A = make_community("Dash A", creator_username="ownerA")
    _add_member("modA", A, role="admin")

    _login(client, "modA")
    assert _overview(client, A).status_code == 200

    _login(client, "siteadmin")
    assert _overview(client, A).status_code == 200


def test_spaces_lists_subcommunities_and_groups(mysql_dsn):
    import bodybuilding_app

    make_user("ownerA")
    client = bodybuilding_app.app.test_client()

    A = make_community("Dash A", creator_username="ownerA")
    make_community("Sub One", creator_username="ownerA", parent_community_id=A)

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO `groups` (name, community_id) VALUES ({ph}, {ph})",
            ("Group One", A),
        )
        try:
            conn.commit()
        except Exception:
            pass

    _login(client, "ownerA")
    resp = client.get(f"/api/community/{A}/analytics/spaces")
    assert resp.status_code == 200
    body = resp.get_json()
    assert any(s["name"] == "Sub One" for s in body["subcommunities"])
    assert any(g["name"] == "Group One" for g in body["groups"])


def test_owner_communities_lists_owned_and_managed(mysql_dsn):
    import bodybuilding_app

    make_user("ownerA")
    make_user("ownerB")
    make_user("modA")
    client = bodybuilding_app.app.test_client()

    a1 = make_community("Alpha One", creator_username="ownerA")
    a2 = make_community("Alpha Two", creator_username="ownerA")
    b = make_community("Bravo", creator_username="ownerB")
    _add_member("modA", a1, role="admin")

    _login(client, "ownerA")
    resp = client.get("/api/owner/communities")
    assert resp.status_code == 200
    owned = resp.get_json()["communities"]
    ids = {c["id"] for c in owned}
    assert ids == {a1, a2}                 # owns both, not Bravo
    assert b not in ids
    assert all(c["is_owner"] for c in owned)

    _login(client, "modA")
    managed = client.get("/api/owner/communities").get_json()["communities"]
    by_id = {c["id"]: c for c in managed}
    assert a1 in by_id                     # delegated admin sees the community
    assert by_id[a1]["is_owner"] is False
    assert by_id[a1]["role"] == "admin"


def test_switcher_lists_root_networks_only(mysql_dsn):
    import bodybuilding_app

    make_user("ownerR")
    client = bodybuilding_app.app.test_client()
    root = make_community("Root Net", creator_username="ownerR")
    sub = make_community("Sub One", creator_username="ownerR", parent_community_id=root)
    make_community("Sub Deep", creator_username="ownerR", parent_community_id=sub)

    _login(client, "ownerR")
    communities = client.get("/api/owner/communities").get_json()["communities"]
    ids = {c["id"] for c in communities}
    assert ids == {root}            # the two sub-communities are absorbed into the root entry
    assert communities[0]["spaces"] == 2   # subtree summary counts both descendants


_INVITES_DDL = """
CREATE TABLE community_invitations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    community_id INT,
    invited_username VARCHAR(191) NULL,
    invited_email VARCHAR(255) NULL,
    invited_by_username VARCHAR(191) NULL,
    token VARCHAR(255) NULL,
    status VARCHAR(50) DEFAULT 'pending',
    used TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
"""


def _seed_invitations(community_id, rows):
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute("DROP TABLE IF EXISTS community_invitations")
        except Exception:
            pass
        c.execute(_INVITES_DDL)
        for uname, email, status in rows:
            c.execute(
                f"INSERT INTO community_invitations (community_id, invited_username, invited_email, status) "
                f"VALUES ({ph}, {ph}, {ph}, {ph})",
                (community_id, uname, email, status),
            )
        try:
            conn.commit()
        except Exception:
            pass


def test_invites_are_unique_and_exclude_admin_and_qr(mysql_dsn):
    import bodybuilding_app

    make_user("ownerA")
    client = bodybuilding_app.app.test_client()
    a = make_community("Dash A", creator_username="ownerA")

    _seed_invitations(a, [
        ("bob", None, "pending"),                                  # bob invited twice...
        ("bob", None, "accepted"),                                 # ...and accepted
        (None, "carol@x.com", "pending"),                          # carol invited twice...
        (None, "carol@x.com", "accepted"),                         # ...and accepted
        (None, "qr-invite-abcd1234@placeholder.local", "pending"),  # open link → not a person
        ("admin", None, "accepted"),                               # admin → excluded
    ])

    _login(client, "ownerA")
    invites = _by_id(_overview(client, a).get_json())["invites"]["value"]
    assert invites["sent"] == 2       # bob + carol (QR + admin excluded, dupes collapsed)
    assert invites["accepted"] == 2   # bob + carol accepted (admin excluded)


def test_paid_network_scope_rolls_up_subtree_deduped(mysql_dsn):
    import bodybuilding_app

    _ensure_profile_columns()
    for u in ("ownerR", "u_root", "u_sub", "u_both"):
        make_user(u)
    client = bodybuilding_app.app.test_client()
    root = make_community("Root Net", creator_username="ownerR")
    sub = make_community("Sub One", creator_username="ownerR", parent_community_id=root)
    _set_paid(root)
    _add_member("u_root", root)
    _add_member("u_sub", sub)
    _add_member("u_both", root)
    _add_member("u_both", sub)  # in both → must count once

    _login(client, "ownerR")
    body = _overview_scoped(client, root, "network").get_json()
    assert body["scope"] == "network"
    assert body["network"]["available"] is True
    assert body["network"]["locked"] is False
    assert _by_id(body)["members"]["value"]["count"] == 3        # deduped across subtree
    assert _by_id(body)["spaces"]["value"]["subcommunities"] == 1

    selfbody = _overview_scoped(client, root, "self").get_json()
    assert selfbody["scope"] == "self"
    assert _by_id(selfbody)["members"]["value"]["count"] == 2     # root only (sub members excluded)


def test_free_network_scope_is_locked_with_teaser(mysql_dsn):
    import bodybuilding_app

    for u in ("ownerF", "u1", "u2"):
        make_user(u)
    client = bodybuilding_app.app.test_client()
    root = make_community("Free Net", creator_username="ownerF")  # free (not paid)
    sub = make_community("Free Sub", creator_username="ownerF", parent_community_id=root)
    _add_member("u1", root)
    _add_member("u2", sub)

    _login(client, "ownerF")
    body = _overview_scoped(client, root, "network").get_json()
    assert body["scope"] == "self"                 # network is paid → falls back
    assert body["network"]["available"] is True
    assert body["network"]["locked"] is True
    assert body["network"]["teaser_members"] == 2  # distinct across the subtree (upsell hook)
    assert _by_id(body)["members"]["value"]["count"] == 1  # apex only


def test_subadmin_cannot_aggregate_root(mysql_dsn):
    import bodybuilding_app

    for u in ("ownerR", "modS", "u_root"):
        make_user(u)
    client = bodybuilding_app.app.test_client()
    root = make_community("Root", creator_username="ownerR")
    sub = make_community("Sub", creator_username="ownerR", parent_community_id=root)
    _set_paid(root)
    _add_member("u_root", root)
    _add_member("modS", sub, role="admin")  # delegated admin of the SUB only

    _login(client, "modS")
    assert _overview_scoped(client, root, "network").status_code == 404   # can't reach the root apex
    subresp = _overview_scoped(client, sub, "network")
    assert subresp.status_code == 200
    # network scope on their own sub spans only the sub — never the root's members
    assert _by_id(subresp.get_json())["members"]["value"]["count"] == 1


def test_sibling_network_excluded_from_rollup(mysql_dsn):
    import bodybuilding_app

    for u in ("ownerA", "ownerB", "a1", "b1"):
        make_user(u)
    client = bodybuilding_app.app.test_client()
    root_a = make_community("Root A", creator_username="ownerA")
    sub_a = make_community("Sub A", creator_username="ownerA", parent_community_id=root_a)
    root_b = make_community("Root B", creator_username="ownerB")  # separate network
    _set_paid(root_a)
    _add_member("a1", sub_a)
    _add_member("b1", root_b)

    _login(client, "ownerA")
    body = _overview_scoped(client, root_a, "network").get_json()
    assert _by_id(body)["members"]["value"]["count"] == 1  # a1 only — B's member never in the rollup


def _ensure_activity_tables():
    """The DAU union query touches these; create them (empty) so it doesn't
    error out on a missing table in the test schema."""
    ddls = [
        "CREATE TABLE IF NOT EXISTS community_visit_history (id INT PRIMARY KEY AUTO_INCREMENT, "
        "username VARCHAR(191), community_id INT, visit_time DATETIME)",
        "CREATE TABLE IF NOT EXISTS group_posts (id INT PRIMARY KEY AUTO_INCREMENT, group_id INT, "
        "username VARCHAR(191), content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS group_replies (id INT PRIMARY KEY AUTO_INCREMENT, group_post_id INT, "
        "parent_reply_id INT NULL, username VARCHAR(191), content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    ]
    with get_db_connection() as conn:
        c = conn.cursor()
        for ddl in ddls:
            try:
                c.execute(ddl)
            except Exception:
                pass
        try:
            conn.commit()
        except Exception:
            pass


def test_dau_counts_recent_activity(mysql_dsn):
    import bodybuilding_app

    _ensure_activity_tables()
    make_user("ownerA")
    make_user("m1")
    client = bodybuilding_app.app.test_client()
    a = make_community("Dash A", creator_username="ownerA")
    _add_member("m1", a)

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO posts (community_id, username, content) VALUES ({ph}, {ph}, {ph})",
            (a, "m1", "hello today"),
        )
        try:
            conn.commit()
        except Exception:
            pass

    _login(client, "ownerA")
    active = _by_id(_overview(client, a).get_json())["active"]["value"]
    assert active["dau"] >= 1   # m1 posted today
    assert active["wau"] >= 1
    assert active["mau"] >= 1


def test_leaderboards_rank_contributors(mysql_dsn):
    import bodybuilding_app

    make_user("ownerA")
    make_user("alice")
    make_user("bob")
    client = bodybuilding_app.app.test_client()
    a = make_community("Dash A", creator_username="ownerA")
    _add_member("alice", a)
    _add_member("bob", a)

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        for _ in range(3):
            c.execute(f"INSERT INTO posts (community_id, username, content) VALUES ({ph}, {ph}, {ph})", (a, "alice", "p"))
        c.execute(f"INSERT INTO posts (community_id, username, content) VALUES ({ph}, {ph}, {ph})", (a, "bob", "p"))
        try:
            conn.commit()
        except Exception:
            pass

    _login(client, "ownerA")
    posters = _by_id(_overview(client, a).get_json())["leaderboards"]["value"]["posters"]
    assert posters[0]["username"] == "alice"
    assert posters[0]["count"] == 3            # summed; alice out-posts bob
    assert any(p["username"] == "bob" for p in posters)


def _ensure_comm_tables():
    ddls = [
        "CREATE TABLE IF NOT EXISTS messages (id INT PRIMARY KEY AUTO_INCREMENT, sender VARCHAR(191), "
        "receiver VARCHAR(191), message TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS group_chat_messages (id INT PRIMARY KEY AUTO_INCREMENT, group_id INT, "
        "sender_username VARCHAR(191), message_text TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
        "CREATE TABLE IF NOT EXISTS group_chat_members (id INT PRIMARY KEY AUTO_INCREMENT, group_id INT, username VARCHAR(191))",
    ]
    with get_db_connection() as conn:
        c = conn.cursor()
        for ddl in ddls:
            try:
                c.execute(ddl)
            except Exception:
                pass
        for t in ("messages", "group_chat_messages", "group_chat_members"):
            try:
                c.execute(f"DELETE FROM {t}")
            except Exception:
                pass
        try:
            conn.commit()
        except Exception:
            pass


def test_members_communicating_counts_member_to_member(mysql_dsn):
    import bodybuilding_app

    _ensure_comm_tables()
    make_user("ownerA")
    make_user("alice")
    make_user("bob")
    make_user("carol")
    make_user("stranger")
    client = bodybuilding_app.app.test_client()
    a = make_community("Dash A", creator_username="ownerA")
    for u in ("alice", "bob", "carol"):
        _add_member(u, a)

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        # alice <-> bob (both members); carol DMs a non-member (must not count)
        for s, r in (("alice", "bob"), ("bob", "alice"), ("carol", "stranger")):
            c.execute(f"INSERT INTO messages (sender, receiver, message) VALUES ({ph}, {ph}, {ph})", (s, r, "hi"))
        try:
            conn.commit()
        except Exception:
            pass

    _login(client, "ownerA")
    comm = _by_id(_overview(client, a).get_json())["communicating"]["value"]
    assert comm["count"] == 2   # alice + bob; carol messaged a non-member → excluded
    assert comm["total"] == 3
