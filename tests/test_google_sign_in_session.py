"""Google sign-in session hygiene and branch behavior (mocked DB / token)."""

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

    cursor.fetchone.side_effect = [None, None, None]

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
