"""Google sign-in session hygiene and branch behavior (mocked DB / token).

The route now also has a "link-to-active-session" path so iOS users who are
already logged in (via password) don't end up with a duplicate user record
when they tap Continue with Apple/Google. The tests below pre-seed
``fetchone`` responses for the upstream ``session_identity.user_exists``
lookup (returns None ⇒ session treated as logged out).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from backend.blueprints.auth import auth_bp


@pytest.fixture()
def auth_google_app():
    app = Flask(__name__)
    app.secret_key = "test-google-signin-session"
    app.config.setdefault("SESSION_COOKIE_NAME", "session")
    app.config.setdefault("SESSION_COOKIE_SECURE", False)
    app.config.setdefault("AUTH_SESSION_LIFETIME_DAYS", 30)
    app.register_blueprint(auth_bp)
    return app


@patch("backend.blueprints.auth._ensure_google_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_google_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_google_sign_in_new_user_clears_stale_session_keys(
    mock_get_conn, mock_verify, _mock_persist, _mock_ensure, auth_google_app
):
    mock_verify.return_value = {
        "sub": "google-sub-new",
        "email": "freshsignup@example.com",
        "given_name": "Fresh",
        "family_name": "User",
        "email_verified": True,
    }

    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None

    # First fetchone: session_identity.user_exists("wrong_user") → None ⇒ not
    # a real account, so existing_username stays None and we fall through to
    # the new-user branch. Then google_id lookup, email lookup, username
    # uniqueness probe.
    cursor.fetchone.side_effect = [None, None, None, None]

    with auth_google_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["pending_username"] = "someone_else"
            sess["username"] = "wrong_user"
        resp = client.post("/api/auth/google", json={"id_token": "t", "platform": "web"})
        assert resp.status_code == 200
        js = resp.get_json()
        assert js["success"] is True
        assert js["is_new"] is True
        assert js["username"] == "freshsignup"
        with client.session_transaction() as sess:
            assert "pending_username" not in sess
            assert sess.get("username") == "freshsignup"

    user_insert_calls = [
        call for call in cursor.execute.call_args_list
        if "INSERT INTO users" in str(call.args[0])
    ]
    assert user_insert_calls
    sql = str(user_insert_calls[0].args[0])
    params = user_insert_calls[0].args[1]
    assert "canonical_email" in sql
    assert params[2] == "freshsignup@example.com"


@patch("backend.blueprints.auth._ensure_google_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_google_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_google_sign_in_email_link_returns_existing_username(
    mock_get_conn, mock_verify, _mock_persist, _mock_ensure, auth_google_app
):
    mock_verify.return_value = {
        "sub": "google-sub-link",
        "email": "existing@example.com",
        "given_name": "Ex",
        "family_name": "Isting",
        "email_verified": True,
    }

    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None

    # No session → no user_exists call; google_id lookup miss; email lookup hit.
    cursor.fetchone.side_effect = [None, {"username": "oldaccount"}]

    with auth_google_app.test_client() as client:
        resp = client.post("/api/auth/google", json={"id_token": "t", "platform": "web"})
        assert resp.status_code == 200
        js = resp.get_json()
        assert js["success"] is True
        assert js["is_new"] is False
        assert js["username"] == "oldaccount"
        with client.session_transaction() as sess:
            assert sess.get("username") == "oldaccount"

    lookup_calls = [
        call for call in cursor.execute.call_args_list
        if "canonical_email" in str(call.args[0]) and "SELECT username" in str(call.args[0])
    ]
    assert lookup_calls
    assert lookup_calls[0].args[1] == ("existing@example.com", "existing@example.com")

    link_calls = [
        call for call in cursor.execute.call_args_list
        if "UPDATE users SET google_id" in str(call.args[0])
    ]
    assert link_calls
    assert "canonical_email = COALESCE" in str(link_calls[0].args[0])
    assert link_calls[0].args[1] == ("google-sub-link", "existing@example.com", "oldaccount")


@patch("backend.blueprints.auth._ensure_google_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_google_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_google_sign_in_links_to_active_session_when_email_unknown(
    mock_get_conn, mock_verify, _mock_persist, _mock_ensure, auth_google_app
):
    """Active session + unknown SSO email ⇒ link to current user, not new."""
    mock_verify.return_value = {
        "sub": "google-sub-link-session",
        "email": "private-relay@example.com",
        "email_verified": True,
    }

    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None

    # 1) user_exists("realuser") ⇒ truthy row (session is valid)
    # 2) google_id lookup ⇒ miss
    # 3) email lookup ⇒ miss
    cursor.fetchone.side_effect = [{"1": 1}, None, None]

    with auth_google_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "realuser"
        resp = client.post("/api/auth/google", json={"id_token": "t", "platform": "ios"})
        assert resp.status_code == 200
        js = resp.get_json()
        assert js["success"] is True
        assert js["username"] == "realuser"
        assert js["is_new"] is False
        assert js["linked_to_active_session"] is True

    link_calls = [
        call for call in cursor.execute.call_args_list
        if "UPDATE users SET google_id" in str(call.args[0])
    ]
    assert link_calls
    assert link_calls[0].args[1] == ("google-sub-link-session", "private-relay@example.com", "realuser")

    # We MUST NOT have inserted a new user row.
    insert_calls = [
        call for call in cursor.execute.call_args_list
        if "INSERT INTO users" in str(call.args[0])
    ]
    assert not insert_calls


@patch("backend.blueprints.auth._ensure_google_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_google_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_google_sign_in_link_only_returns_404_when_unknown(
    mock_get_conn, mock_verify, _mock_persist, _mock_ensure, auth_google_app
):
    """link_only=true ⇒ refuse to spawn a new user when SSO id/email don't match."""
    mock_verify.return_value = {
        "sub": "google-sub-strict",
        "email": "stranger@example.com",
        "email_verified": True,
    }

    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None

    # No session ⇒ no user_exists call. google_id miss, email miss.
    cursor.fetchone.side_effect = [None, None]

    with auth_google_app.test_client() as client:
        resp = client.post(
            "/api/auth/google",
            json={"id_token": "t", "platform": "web", "link_only": True},
        )
        assert resp.status_code == 404
        js = resp.get_json()
        assert js["success"] is False
        assert js["error"] == "no_matching_account"
        assert js["sso_provider"] == "google"

    insert_calls = [
        call for call in cursor.execute.call_args_list
        if "INSERT INTO users" in str(call.args[0])
    ]
    assert not insert_calls


@patch("backend.blueprints.auth._ensure_google_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_google_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_google_sign_in_returns_conflict_when_session_user_differs(
    mock_get_conn, mock_verify, _mock_persist, _mock_ensure, auth_google_app
):
    """Active session A + google_id maps to user B ⇒ 409, don't switch identity."""
    mock_verify.return_value = {
        "sub": "google-sub-existing",
        "email": "userb@example.com",
        "email_verified": True,
    }

    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None

    # 1) user_exists("user_a") ⇒ truthy
    # 2) google_id lookup ⇒ existing user_b
    cursor.fetchone.side_effect = [{"1": 1}, {"username": "user_b"}]

    with auth_google_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "user_a"
        resp = client.post("/api/auth/google", json={"id_token": "t", "platform": "ios"})
        assert resp.status_code == 409
        js = resp.get_json()
        assert js["success"] is False
        assert js["error"] == "sso_belongs_to_other_user"
        assert js["username_on_token"] == "user_b"
        # Session must be untouched.
        with client.session_transaction() as sess:
            assert sess.get("username") == "user_a"


@patch("backend.blueprints.auth._ensure_apple_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_apple_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_apple_sign_in_new_user_uses_private_relay_email(
    mock_get_conn, mock_verify, _mock_persist, _mock_ensure, auth_google_app
):
    mock_verify.return_value = {
        "sub": "apple-sub-new",
        "email": "relay@privaterelay.appleid.com",
        "email_verified": "true",
    }

    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None

    # No session ⇒ no user_exists call. apple_id miss, email miss, username
    # uniqueness probe miss.
    cursor.fetchone.side_effect = [None, None, None]

    with auth_google_app.test_client() as client:
        resp = client.post(
            "/api/auth/apple",
            json={
                "id_token": "t",
                "apple_user": "apple-sub-new",
                "given_name": "Relay",
                "family_name": "User",
            },
        )
        assert resp.status_code == 200
        js = resp.get_json()
        assert js["success"] is True
        assert js["is_new"] is True
        assert js["username"] == "relay"
        with client.session_transaction() as sess:
            assert sess.get("username") == "relay"

    user_insert_calls = [
        call for call in cursor.execute.call_args_list
        if "INSERT INTO users" in str(call.args[0])
    ]
    assert user_insert_calls
    sql = str(user_insert_calls[0].args[0])
    params = user_insert_calls[0].args[1]
    assert "apple_id" in sql
    assert params[1] == "relay@privaterelay.appleid.com"
    assert params[6] == "apple-sub-new"


@patch("backend.blueprints.auth._ensure_apple_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_apple_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_apple_sign_in_email_link_returns_existing_username(
    mock_get_conn, mock_verify, _mock_persist, _mock_ensure, auth_google_app
):
    mock_verify.return_value = {
        "sub": "apple-sub-link",
        "email": "existing@example.com",
        "email_verified": True,
    }

    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None

    # No session ⇒ no user_exists call. apple_id miss, email lookup hit.
    cursor.fetchone.side_effect = [None, {"username": "oldaccount"}]

    with auth_google_app.test_client() as client:
        resp = client.post("/api/auth/apple", json={"id_token": "t"})
        assert resp.status_code == 200
        js = resp.get_json()
        assert js["success"] is True
        assert js["is_new"] is False
        assert js["username"] == "oldaccount"
        with client.session_transaction() as sess:
            assert sess.get("username") == "oldaccount"

    link_calls = [
        call for call in cursor.execute.call_args_list
        if "UPDATE users SET apple_id" in str(call.args[0])
    ]
    assert link_calls
    assert "canonical_email = COALESCE" in str(link_calls[0].args[0])
    assert link_calls[0].args[1] == ("apple-sub-link", "existing@example.com", "oldaccount")


@patch("backend.blueprints.auth._ensure_apple_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_apple_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_apple_sign_in_links_private_relay_to_active_session(
    mock_get_conn, mock_verify, _mock_persist, _mock_ensure, auth_google_app
):
    """Active session + Apple Hide-My-Email ⇒ link Apple to current user.

    Before this change, iOS users who tapped Continue with Apple while
    already logged in via password ended up with a brand-new ``users`` row
    that had no community memberships, which surfaced as 403s on
    ``/get_links``. The link-to-session path keeps the existing account.
    """
    mock_verify.return_value = {
        "sub": "apple-sub-relay",
        "email": "anon@privaterelay.appleid.com",
        "email_verified": True,
    }

    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None

    # 1) user_exists("paulo") ⇒ truthy ⇒ existing_username = "paulo"
    # 2) apple_id lookup ⇒ miss
    # 3) email lookup ⇒ miss (private relay address)
    cursor.fetchone.side_effect = [{"1": 1}, None, None]

    with auth_google_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "paulo"
        resp = client.post("/api/auth/apple", json={"id_token": "t"})
        assert resp.status_code == 200
        js = resp.get_json()
        assert js["success"] is True
        assert js["username"] == "paulo"
        assert js["is_new"] is False
        assert js["linked_to_active_session"] is True

    link_calls = [
        call for call in cursor.execute.call_args_list
        if "UPDATE users SET apple_id" in str(call.args[0])
    ]
    assert link_calls
    assert link_calls[0].args[1] == (
        "apple-sub-relay",
        "anon@privaterelay.appleid.com",
        "paulo",
    )

    insert_calls = [
        call for call in cursor.execute.call_args_list
        if "INSERT INTO users" in str(call.args[0])
    ]
    assert not insert_calls


@patch("backend.blueprints.auth._ensure_apple_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_apple_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_apple_sign_in_link_only_returns_404_when_unknown(
    mock_get_conn, mock_verify, _mock_persist, _mock_ensure, auth_google_app
):
    mock_verify.return_value = {
        "sub": "apple-sub-strict",
        "email": "unknown@example.com",
        "email_verified": True,
    }

    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None

    # No session ⇒ no user_exists call. apple_id miss, email miss.
    cursor.fetchone.side_effect = [None, None]

    with auth_google_app.test_client() as client:
        resp = client.post(
            "/api/auth/apple",
            json={"id_token": "t", "link_only": True},
        )
        assert resp.status_code == 404
        js = resp.get_json()
        assert js["success"] is False
        assert js["error"] == "no_matching_account"
        assert js["sso_provider"] == "apple"

    insert_calls = [
        call for call in cursor.execute.call_args_list
        if "INSERT INTO users" in str(call.args[0])
    ]
    assert not insert_calls


@patch("backend.blueprints.auth._ensure_apple_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_apple_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_apple_sign_in_returns_conflict_when_session_user_differs(
    mock_get_conn, mock_verify, _mock_persist, _mock_ensure, auth_google_app
):
    mock_verify.return_value = {
        "sub": "apple-sub-existing",
        "email": "userb@example.com",
        "email_verified": True,
    }

    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None

    # 1) user_exists("user_a") ⇒ truthy
    # 2) apple_id lookup ⇒ user_b row
    cursor.fetchone.side_effect = [{"1": 1}, {"username": "user_b"}]

    with auth_google_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "user_a"
        resp = client.post("/api/auth/apple", json={"id_token": "t"})
        assert resp.status_code == 409
        js = resp.get_json()
        assert js["success"] is False
        assert js["error"] == "sso_belongs_to_other_user"
        assert js["username_on_token"] == "user_b"
        with client.session_transaction() as sess:
            assert sess.get("username") == "user_a"
