"""HTTP smoke coverage for pending username community invites."""

from __future__ import annotations

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import fill_community_members, make_community, make_user


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
    assert "username" not in create_data
    assert "invite_id" not in create_data
    assert create_data["message"] == "If that user exists, we will send an invite."
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
    accept_json = accept_resp.get_json()
    assert accept_json["success"] is True
    assert accept_json["introduce_thread_post_id"]
    assert accept_json["next_url"] == f"/community_feed_react/{community_id}?joined=1"
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
        c.execute(
            f"""
            SELECT welcome_card_key, is_system_post
            FROM posts
            WHERE id = {ph} AND community_id = {ph}
            """,
            (accept_json["introduce_thread_post_id"], community_id),
        )
        intro_row = c.fetchone()
        assert intro_row
        assert (intro_row["welcome_card_key"] if hasattr(intro_row, "keys") else intro_row[0]) == "cold_start.introduce_yourself.v1"
        assert int(intro_row["is_system_post"] if hasattr(intro_row, "keys") else intro_row[1]) == 1


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
    assert create_resp.status_code == 200

    _login(client, "target_username_decline")
    pending_resp = client.get("/api/community/invites/pending")
    assert pending_resp.status_code == 200
    invite_id = pending_resp.get_json()["invites"][0]["id"]
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


def test_email_invite_existing_user_requires_explicit_accept(mysql_dsn, monkeypatch):
    import bodybuilding_app
    from backend.services import community_invites as invites_svc

    monkeypatch.setattr(bodybuilding_app, "_send_email_via_resend", lambda *args, **kwargs: True)
    invites_svc._legacy_helpers.cache_clear()

    make_user("owner_email_invite", subscription="premium", email="owner-email-invite@example.com")
    make_user("target_email_invite", subscription="free", email="target-email-invite@example.com")
    community_id = make_community(
        "email-invite-explicit-accept",
        tier="free",
        creator_username="owner_email_invite",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_email_invite")
    create_resp = client.post(
        "/api/community/invite",
        json={"community_id": community_id, "email": "target-email-invite@example.com"},
    )
    assert create_resp.status_code == 200
    assert create_resp.get_json()["success"] is True
    assert not _member_exists("target_email_invite", community_id)

    _login(client, "target_email_invite")
    pending_resp = client.get("/api/community/invites/pending?include_email=true")
    assert pending_resp.status_code == 200
    pending = pending_resp.get_json()["invites"]
    assert len(pending) == 1
    assert pending[0]["community_name"] == "email-invite-explicit-accept"
    assert pending[0]["expires_at"]

    accept_resp = client.post(f"/api/community/invites/{pending[0]['id']}/accept")
    assert accept_resp.status_code == 200
    assert accept_resp.get_json()["success"] is True
    assert _member_exists("target_email_invite", community_id)


def test_expired_token_invite_cannot_add_member(mysql_dsn, monkeypatch):
    import bodybuilding_app
    from backend.services import community_invites as invites_svc

    monkeypatch.setattr(bodybuilding_app, "_send_email_via_resend", lambda *args, **kwargs: True)
    invites_svc._legacy_helpers.cache_clear()

    make_user("owner_expired_token", subscription="premium", email="owner-expired-token@example.com")
    make_user("target_expired_token", subscription="free", email="target-expired-token@example.com")
    community_id = make_community(
        "expired-token-invite",
        tier="free",
        creator_username="owner_expired_token",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_expired_token")
    create_resp = client.post(
        "/api/community/invite",
        json={"community_id": community_id, "email": "target-expired-token@example.com"},
    )
    assert create_resp.status_code == 200

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"SELECT id, token FROM community_invitations WHERE community_id = {ph} AND invited_email = {ph}",
            (community_id, "target-expired-token@example.com"),
        )
        row = c.fetchone()
        assert row
        invite_id = row["id"] if hasattr(row, "keys") else row[0]
        token = row["token"] if hasattr(row, "keys") else row[1]
        c.execute(
            f"UPDATE community_invitations SET expires_at = '2000-01-01 00:00:00' WHERE id = {ph}",
            (invite_id,),
        )
        conn.commit()

    _login(client, "target_expired_token")
    accept_resp = client.post(f"/api/community/invites/token/{token}/accept")
    assert accept_resp.status_code == 410
    body = accept_resp.get_json()
    assert body["success"] is False
    assert body["error_code"] == "invite_expired"
    assert not _member_exists("target_expired_token", community_id)


def test_email_invite_matches_canonical_email_on_accept(mysql_dsn, monkeypatch):
    import bodybuilding_app
    from backend.services import community_invites as invites_svc
    from backend.services.email_normalization import canonicalize_with_policy

    monkeypatch.setattr(bodybuilding_app, "_send_email_via_resend", lambda *args, **kwargs: True)
    invites_svc._legacy_helpers.cache_clear()

    make_user("owner_canonical_invite", subscription="premium", email="owner-canonical@example.com")
    make_user("target_canonical_invite", subscription="free", email="targetcanonical@gmail.com")
    community_id = make_community(
        "canonical-email-invite",
        tier="free",
        creator_username="owner_canonical_invite",
    )

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"UPDATE users SET canonical_email = {ph} WHERE username = {ph}",
            (canonicalize_with_policy("targetcanonical@gmail.com"), "target_canonical_invite"),
        )
        conn.commit()

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_canonical_invite")
    create_resp = client.post(
        "/api/community/invite",
        json={"community_id": community_id, "email": "target.canonical+tag@gmail.com"},
    )
    assert create_resp.status_code == 200
    assert not _member_exists("target_canonical_invite", community_id)

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"SELECT token FROM community_invitations WHERE community_id = {ph} AND invited_email = {ph}",
            (community_id, "target.canonical+tag@gmail.com"),
        )
        row = c.fetchone()
        assert row
        token = row["token"] if hasattr(row, "keys") else row[0]

    _login(client, "target_canonical_invite")
    accept_resp = client.post(f"/api/community/invites/token/{token}/accept")
    assert accept_resp.status_code == 200
    assert accept_resp.get_json()["success"] is True
    assert _member_exists("target_canonical_invite", community_id)


def test_declining_qr_invite_does_not_invalidate_shared_link(mysql_dsn):
    import bodybuilding_app

    make_user("owner_qr_decline", subscription="premium", email="owner-qr-decline@example.com")
    make_user("first_qr_viewer", subscription="free", email="first-qr-viewer@example.com")
    make_user("second_qr_viewer", subscription="free", email="second-qr-viewer@example.com")
    community_id = make_community(
        "qr-decline-shared-link",
        tier="free",
        creator_username="owner_qr_decline",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_qr_decline")
    create_resp = client.post("/api/community/invite_link", json={"community_id": community_id})
    assert create_resp.status_code == 200
    invite_url = create_resp.get_json()["invite_url"]
    token = invite_url.rsplit("/", 1)[-1]

    _login(client, "first_qr_viewer")
    decline_resp = client.post(f"/api/community/invites/token/{token}/decline")
    assert decline_resp.status_code == 200
    assert decline_resp.get_json()["success"] is True
    assert not _member_exists("first_qr_viewer", community_id)

    _login(client, "second_qr_viewer")
    accept_resp = client.post(f"/api/community/invites/token/{token}/accept")
    assert accept_resp.status_code == 200
    assert accept_resp.get_json()["success"] is True
    assert _member_exists("second_qr_viewer", community_id)


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


def test_username_invite_does_not_enumerate_missing_user(mysql_dsn, monkeypatch):
    import bodybuilding_app

    pushed = []
    monkeypatch.setattr(bodybuilding_app, "send_push_to_user", lambda username, payload: pushed.append((username, payload)))

    make_user("owner_username_missing", subscription="premium")
    community_id = make_community(
        "username-invite-missing",
        tier="free",
        creator_username="owner_username_missing",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_username_missing")
    resp = client.post(
        "/api/community/invite_username",
        json={"community_id": community_id, "username": "definitely_missing_username"},
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["message"] == "If that user exists, we will send an invite."
    assert "username" not in body
    assert "invite_id" not in body
    assert pushed == []
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(f"SELECT COUNT(*) as cnt FROM community_invitations WHERE community_id = {ph}", (community_id,))
        row = c.fetchone()
        assert int(row["cnt"] if hasattr(row, "keys") else row[0]) == 0


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


def test_invite_preview_invalid_token_localized_pt_pt(mysql_dsn):
    import bodybuilding_app

    client = bodybuilding_app.app.test_client()
    resp = client.get(
        "/api/invite_preview/not-a-real-token",
        headers={"Accept-Language": "pt-PT"},
    )
    assert resp.status_code == 404
    body = resp.get_json()
    assert body["success"] is False
    assert body["message_key"] == "communities.invite.invalid_invitation"
    assert body["error"] == "Convite inválido."


def test_bulk_invite_reports_send_failures_honestly(mysql_dsn, monkeypatch):
    import bodybuilding_app
    from backend.services import community_invites as invites_svc

    def fake_send(to_email, subject, html, text):
        return not to_email.startswith("bounce")

    monkeypatch.setattr(bodybuilding_app, "_send_email_via_resend", fake_send)
    invites_svc._legacy_helpers.cache_clear()
    monkeypatch.setattr(invites_svc, "BULK_SEND_DELAY_SECONDS", 0)

    make_user("owner_bulk_invite", subscription="premium")
    community_id = make_community(
        "bulk-invite-failures",
        tier="free",
        creator_username="owner_bulk_invite",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_bulk_invite")

    resp = client.post(
        "/api/community/invite_bulk",
        json={
            "community_id": community_id,
            "emails": [
                "new1@example.com",
                "bounce@example.com",
                "not-an-email",
                "new1@example.com",  # duplicate, deduped silently
            ],
        },
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["sent"] == 1
    assert data["failed"] == 2
    errors = {e["email"]: e["error"] for e in data["errors"]}
    assert "bounce@example.com" in errors
    assert "not-an-email" in errors

    # The bounced row must be dropped so a retry can re-create it; the
    # delivered one stays pending.
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT invited_email FROM community_invitations WHERE community_id = {ph} AND used = 0",
            (community_id,),
        )
        rows = sorted(
            (r["invited_email"] if hasattr(r, "keys") else r[0]) for r in c.fetchall()
        )
    assert rows == ["new1@example.com"]


def test_bulk_invite_refuses_batch_exceeding_capacity(mysql_dsn, monkeypatch):
    import bodybuilding_app
    from backend.services import community_invites as invites_svc
    from backend.services import entitlements as entitlements_svc

    monkeypatch.setattr(bodybuilding_app, "_send_email_via_resend", lambda *a, **k: True)
    invites_svc._legacy_helpers.cache_clear()
    monkeypatch.setattr(invites_svc, "BULK_SEND_DELAY_SECONDS", 0)
    monkeypatch.setattr(
        entitlements_svc,
        "resolve_entitlements",
        lambda username: {"members_per_owned_community": 3},
    )

    make_user("owner_bulk_cap", subscription="free")
    community_id = make_community(
        "bulk-invite-cap",
        tier="free",
        creator_username="owner_bulk_cap",
    )
    fill_community_members(community_id, 2, prefix="bulkcap")

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_bulk_cap")

    resp = client.post(
        "/api/community/invite_bulk",
        json={
            "community_id": community_id,
            "emails": ["cap1@example.com", "cap2@example.com"],
        },
    )
    assert resp.status_code == 403
    data = resp.get_json()
    assert data["success"] is False
    assert data["reason_code"] == "community_member_limit"
    assert data["requested_invites"] == 2

    # Nothing was created: the whole batch is refused up front.
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT COUNT(*) AS n FROM community_invitations WHERE community_id = {ph}",
            (community_id,),
        )
        row = c.fetchone()
        count = row["n"] if hasattr(row, "keys") else row[0]
    assert int(count) == 0


def test_bulk_invite_enforces_per_request_maximum(mysql_dsn, monkeypatch):
    import bodybuilding_app
    from backend.services import community_invites as invites_svc

    monkeypatch.setattr(bodybuilding_app, "_send_email_via_resend", lambda *a, **k: True)
    invites_svc._legacy_helpers.cache_clear()

    make_user("owner_bulk_max", subscription="premium")
    community_id = make_community(
        "bulk-invite-max",
        tier="free",
        creator_username="owner_bulk_max",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "owner_bulk_max")

    too_many = [f"user{i}@example.com" for i in range(invites_svc.MAX_BULK_INVITES_PER_REQUEST + 1)]
    resp = client.post(
        "/api/community/invite_bulk",
        json={"community_id": community_id, "emails": too_many},
    )
    assert resp.status_code == 400
    data = resp.get_json()
    assert data["success"] is False
    assert data["max_per_request"] == invites_svc.MAX_BULK_INVITES_PER_REQUEST
