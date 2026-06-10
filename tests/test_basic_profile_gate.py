from __future__ import annotations

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def test_basic_profile_status_reports_missing_fields(mysql_dsn):
    from backend.services.basic_profile_gate import basic_profile_status

    make_user("basic_profile_missing", basic_profile_complete=False)

    status = basic_profile_status("basic_profile_missing")

    assert status["complete"] is False
    assert status["missing_fields"] == ["first_name", "last_name", "profile_picture"]


def test_basic_profile_status_complete_after_fields(mysql_dsn):
    from backend.services.basic_profile_gate import basic_profile_status

    make_user("basic_profile_complete")

    status = basic_profile_status("basic_profile_complete")

    assert status["complete"] is True
    assert status["missing_fields"] == []
    assert status["profile"]["first_name"]
    assert status["profile"]["last_name"]
    assert status["profile"]["profile_picture"]


def test_basic_profile_api_and_feed_read_stay_open_for_incomplete_user(mysql_dsn):
    import bodybuilding_app

    make_user("basic_profile_reader", basic_profile_complete=False)
    community_id = make_community(
        "basic-profile-reader-community",
        creator_username="basic_profile_reader",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "basic_profile_reader")

    status_resp = client.get("/api/me/basic_profile")
    assert status_resp.status_code == 200
    status_json = status_resp.get_json()
    assert status_json["success"] is True
    assert status_json["basic_profile"]["complete"] is False

    feed_resp = client.get(f"/api/community_feed/{community_id}")
    assert feed_resp.status_code == 200
    assert feed_resp.get_json()["success"] is True


def test_post_status_requires_basic_profile(mysql_dsn):
    import bodybuilding_app

    make_user("basic_profile_blocked", basic_profile_complete=False)
    community_id = make_community(
        "basic-profile-blocked-community",
        creator_username="basic_profile_blocked",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "basic_profile_blocked")

    resp = client.post(
        "/post_status",
        data={"content": "Hello room", "community_id": str(community_id)},
        headers={"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"},
    )

    assert resp.status_code == 412
    payload = resp.get_json()
    assert payload["success"] is False
    assert payload["error_code"] == "basic_profile_required"
    assert payload["basic_profile"]["complete"] is False


def test_invite_accept_stays_open_when_invitee_profile_incomplete(mysql_dsn, monkeypatch):
    import bodybuilding_app

    monkeypatch.setattr(bodybuilding_app, "send_push_to_user", lambda username, payload: None)

    make_user("basic_profile_inviter")
    make_user("basic_profile_invitee", basic_profile_complete=False)
    community_id = make_community(
        "basic-profile-invite-community",
        creator_username="basic_profile_inviter",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "basic_profile_inviter")
    create_resp = client.post(
        "/api/community/invite_username",
        json={"community_id": community_id, "username": "basic_profile_invitee"},
    )
    assert create_resp.status_code == 200

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"SELECT id FROM community_invitations WHERE community_id = {ph} AND invited_username = {ph}",
            (community_id, "basic_profile_invitee"),
        )
        row = c.fetchone()
        invite_id = row["id"] if hasattr(row, "keys") else row[0]

    _login(client, "basic_profile_invitee")
    accept_resp = client.post(f"/api/community/invites/{invite_id}/accept")
    assert accept_resp.status_code == 200
    assert accept_resp.get_json()["success"] is True
