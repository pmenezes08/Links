"""Login-epoch regression tests (PR 2).

Verifies the end-to-end contract:
  * each successful login mints a fresh `login_id`;
  * `/api/profile_me` echoes the current `login_id` back to the client;
  * logging out + logging back in produces a different `login_id` so the
    client's mismatch detector trips and triggers `resetAllAccountState`.

The Google sign-in flow is exercised here too because that's the path
that originally allowed previous-account chat threads to leak into a new
identity (see commit summary).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from backend.blueprints.auth import auth_bp
from backend.blueprints.profile_me import profile_me_bp


@pytest.fixture()
def login_epoch_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "test-login-epoch"
    app.register_blueprint(auth_bp)
    app.register_blueprint(profile_me_bp)
    return app


def _stub_profile(username: str = "alice") -> dict:
    return {
        "username": username,
        "email": f"{username}@example.com",
        "subscription": "free",
        "display_name": username.title(),
        "personal": {"display_name": username.title()},
        "professional": {"interests": []},
    }


@patch("backend.blueprints.profile_me.load_profile")
@patch("backend.blueprints.auth._ensure_google_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_google_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_google_signin_mints_new_login_id_each_time(
    mock_get_conn,
    mock_verify,
    _mock_persist,
    _mock_ensure,
    mock_loader,
    login_epoch_app: Flask,
) -> None:
    """Two successive Google sign-ins for the same user must yield different login_id values."""
    mock_verify.return_value = {
        "sub": "google-sub-eve",
        "email": "eve@example.com",
        "given_name": "Eve",
        "family_name": "Returning",
        "email_verified": True,
    }

    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None

    cursor.fetchone.side_effect = [{"username": "eve", "email": "eve@example.com"}] * 2
    mock_loader.return_value = _stub_profile("eve")

    with login_epoch_app.test_client() as client:
        first_login = client.post("/api/auth/google", json={"id_token": "t1", "platform": "web"}).get_json()
        assert first_login["login_id"]
        first = client.get("/api/profile_me?_nocache=1").get_json()
        first_login_id = first["login_id"]
        assert first_login_id == first_login["login_id"]

        second_login = client.post("/api/auth/google", json={"id_token": "t2", "platform": "web"}).get_json()
        assert second_login["login_id"]
        second = client.get("/api/profile_me?_nocache=1").get_json()
        second_login_id = second["login_id"]
        assert second_login_id == second_login["login_id"]

        assert first_login_id != second_login_id, "establish_login must mint a new epoch on every call"


@patch("backend.blueprints.profile_me.load_profile")
@patch("backend.blueprints.auth._ensure_google_id_column")
@patch("backend.blueprints.auth._apply_login_persistence", return_value=0)
@patch("backend.blueprints.auth._verify_google_id_token")
@patch("backend.blueprints.auth.get_db_connection")
def test_logout_then_login_yields_fresh_login_id(
    mock_get_conn,
    mock_verify,
    _mock_persist,
    _mock_ensure,
    mock_loader,
    login_epoch_app: Flask,
) -> None:
    """The classic leak scenario: log out then sign in; epoch must change."""
    mock_verify.return_value = {
        "sub": "google-sub-frank",
        "email": "frank@example.com",
        "given_name": "Frank",
        "family_name": "Tester",
        "email_verified": True,
    }
    cm = MagicMock()
    cursor = MagicMock()
    cm.cursor.return_value = cursor
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None
    cursor.fetchone.side_effect = [
        {"username": "frank", "email": "frank@example.com"},
        {"username": "frank", "email": "frank@example.com"},
    ]
    mock_loader.return_value = _stub_profile("frank")

    with login_epoch_app.test_client() as client:
        client.post("/api/auth/google", json={"id_token": "t1", "platform": "web"})
        before = client.get("/api/profile_me?_nocache=1").get_json()["login_id"]
        assert before

        with patch("backend.blueprints.auth.deactivate_for_install", return_value={"native_push_tokens": 0, "fcm_tokens": 0}), \
             patch("backend.blueprints.auth.remember_tokens.revoke_by_cookie", return_value=0):
            client.get("/logout", follow_redirects=False)

        client.post("/api/auth/google", json={"id_token": "t2", "platform": "web"})
        after = client.get("/api/profile_me?_nocache=1").get_json()["login_id"]
        assert after
        assert before != after, "Logout + new login must produce a fresh login_id"


@patch("backend.blueprints.profile_me.load_profile")
def test_profile_me_login_id_present_after_session_login(
    mock_loader, login_epoch_app: Flask,
) -> None:
    """Even when callers set the session manually (e.g. tests / admin tooling), the epoch flows through."""
    mock_loader.return_value = _stub_profile()
    with login_epoch_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "alice"
            sess["login_id"] = "manual-epoch-1234"
        body = client.get("/api/profile_me?_nocache=1").get_json()
    assert body["login_id"] == "manual-epoch-1234"
