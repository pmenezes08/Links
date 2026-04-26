"""HTTP smoke coverage for pending username community invites."""

from __future__ import annotations

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _member_exists(username: str, community_id: int) -> bool:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        user_row = c.fetchone()
        assert user_row
        user_id = user_row["id"] if hasattr(user_row, "keys") else user_row[0]
        c.execute(
            f"SELECT 1 FROM user_communities WHERE user_id = {ph} AND community_id = {ph}",
            (user_id, community_id),
        )
        return c.fetchone() is not None


def test_username_invite_accepts_into_community(mysql_dsn, monkeypatch):
    import bodybuilding_app

    pushed = []
    monkeypatch.setattr(bodybuilding_app, "send_push_to_user", lambda username, payload: pushed.append((username, payload)))

    make_user("owner_username_invite", subscription="premium")
    make_user("target_username_invite", subscription="free")
    community_id = make_community(
        "username-invite-accept",
        tier="free",
        creator_username="owner_username_invite",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_username_invite")

    create_resp = client.post(
        "/api/community/invite_username",
        json={"community_id": community_id, "username": "target_username_invite"},
    )
    assert create_resp.status_code == 200
    create_data = create_resp.get_json()
    assert create_data["success"] is True
    assert create_data["username"] == "target_username_invite"
    assert pushed and pushed[0][0] == "target_username_invite"
    assert "You've been invited to community username-invite-accept by username owner_username_invite" in pushed[0][1]["body"]
    assert not _member_exists("target_username_invite", community_id)

    _login(client, "target_username_invite")
    pending_resp = client.get("/api/community/invites/pending")
    assert pending_resp.status_code == 200
    pending = pending_resp.get_json()["invites"]
    assert len(pending) == 1
    assert pending[0]["community_name"] == "username-invite-accept"

    accept_resp = client.post(f"/api/community/invites/{pending[0]['id']}/accept")
    assert accept_resp.status_code == 200
    assert accept_resp.get_json()["success"] is True
    assert _member_exists("target_username_invite", community_id)

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"SELECT status, used FROM community_invitations WHERE id = {ph}",
            (pending[0]["id"],),
        )
        row = c.fetchone()
        assert row
        assert (row["status"] if hasattr(row, "keys") else row[0]) == "accepted"
        assert int(row["used"] if hasattr(row, "keys") else row[1]) == 1


def test_username_invite_decline_does_not_add_member(mysql_dsn, monkeypatch):
    import bodybuilding_app

    monkeypatch.setattr(bodybuilding_app, "send_push_to_user", lambda username, payload: None)

    make_user("owner_username_decline", subscription="premium")
    make_user("target_username_decline", subscription="free")
    community_id = make_community(
        "username-invite-decline",
        tier="free",
        creator_username="owner_username_decline",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_username_decline")
    create_resp = client.post(
        "/api/community/invite_username",
        json={"community_id": community_id, "username": "target_username_decline"},
    )
    invite_id = create_resp.get_json()["invite_id"]

    _login(client, "target_username_decline")
    decline_resp = client.post(f"/api/community/invites/{invite_id}/decline")
    assert decline_resp.status_code == 200
    assert decline_resp.get_json()["success"] is True
    assert not _member_exists("target_username_decline", community_id)

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"SELECT status, used FROM community_invitations WHERE id = {ph}",
            (invite_id,),
        )
        row = c.fetchone()
        assert row
        assert (row["status"] if hasattr(row, "keys") else row[0]) == "declined"
        assert int(row["used"] if hasattr(row, "keys") else row[1]) == 0


def test_non_admin_cannot_create_username_invite(mysql_dsn):
    import bodybuilding_app

    make_user("owner_username_forbidden", subscription="premium")
    make_user("outsider_username_forbidden", subscription="free")
    make_user("target_username_forbidden", subscription="free")
    community_id = make_community(
        "username-invite-forbidden",
        tier="free",
        creator_username="owner_username_forbidden",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "outsider_username_forbidden")
    resp = client.post(
        "/api/community/invite_username",
        json={"community_id": community_id, "username": "target_username_forbidden"},
    )
    assert resp.status_code == 403
    assert resp.get_json()["success"] is False


def test_username_invite_rejects_sub_community(mysql_dsn, monkeypatch):
    import bodybuilding_app

    monkeypatch.setattr(bodybuilding_app, "send_push_to_user", lambda username, payload: None)

    make_user("owner_username_root_only", subscription="premium")
    make_user("target_username_root_only", subscription="free")
    root_id = make_community(
        "username-invite-root-only",
        tier="free",
        creator_username="owner_username_root_only",
    )
    child_id = make_community(
        "username-invite-child-only",
        tier="free",
        creator_username="owner_username_root_only",
        parent_community_id=root_id,
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_username_root_only")

    resp = client.post(
        "/api/community/invite_username",
        json={"community_id": child_id, "username": "target_username_root_only"},
    )
    assert resp.status_code == 400
    assert resp.get_json()["success"] is False
    assert not _member_exists("target_username_root_only", child_id)


def test_manageable_communities_lists_roots_only(mysql_dsn):
    import bodybuilding_app

    make_user("owner_username_manageable_roots", subscription="premium")
    make_user("target_username_manageable_roots", subscription="free")
    root_id = make_community(
        "username-invite-manageable-root",
        tier="free",
        creator_username="owner_username_manageable_roots",
    )
    child_id = make_community(
        "username-invite-manageable-child",
        tier="free",
        creator_username="owner_username_manageable_roots",
        parent_community_id=root_id,
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_username_manageable_roots")

    resp = client.get("/api/community/manageable?target_username=target_username_manageable_roots")
    assert resp.status_code == 200
    community_ids = {community["id"] for community in resp.get_json()["communities"]}
    assert root_id in community_ids
    assert child_id not in community_ids


def test_hierarchical_communities_include_creator_owned_without_membership(mysql_dsn):
    import bodybuilding_app

    make_user("JohnDoe", subscription="premium")
    root_id = make_community(
        "johndoe-owned-without-membership",
        tier="free",
        creator_username="JohnDoe",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "JohnDoe")

    resp = client.get("/api/user_communities_hierarchical")

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["username"] == "JohnDoe"
    community_ids = {community["id"] for community in body["communities"]}
    assert root_id in community_ids
