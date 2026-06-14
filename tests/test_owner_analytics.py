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
