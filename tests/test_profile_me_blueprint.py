"""Tests for `backend.blueprints.profile_me`.

The endpoint is the canonical "who am I right now" round-trip and is the
delivery channel for the login epoch (`login_id`) the client uses to
detect cross-account leakage. We exercise three things here without
touching the real DB:

  * unauthenticated callers get 401;
  * a successful response includes the session's `login_id` so the
    client can compare it to its cached value;
  * the response is stamped with `Cache-Control: no-store` (defense in
    depth on top of the global policy in PR 1).
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from flask import Flask

from backend.blueprints.profile_me import profile_me_bp
from backend.services import auth_session


@pytest.fixture()
def profile_me_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "test-profile-me"
    app.register_blueprint(profile_me_bp)
    return app


def _stub_profile() -> dict:
    return {
        "username": "alice",
        "email": "alice@example.com",
        "subscription": "premium",
        "display_name": "Alice",
        "personal": {"display_name": "Alice"},
        "professional": {"interests": []},
    }


def test_profile_me_requires_auth(profile_me_app: Flask) -> None:
    with profile_me_app.test_client() as client:
        resp = client.get("/api/profile_me")
    assert resp.status_code == 401
    assert resp.get_json() == {"success": False, "error": "Authentication required"}


@patch("backend.blueprints.profile_me.load_profile")
def test_profile_me_returns_login_id_from_session(mock_loader, profile_me_app: Flask) -> None:
    mock_loader.return_value = _stub_profile()

    with profile_me_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "alice"
            sess["login_id"] = "deadbeef0001"

        # `?_nocache=1` keeps Redis out of the test path so the assertion
        # about the loader being invoked is deterministic regardless of
        # whether the dev box has a real Redis or the in-memory shim.
        resp = client.get("/api/profile_me?_nocache=1")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["profile"]["username"] == "alice"
        assert body["login_id"] == "deadbeef0001"

        cc = (resp.headers.get("Cache-Control") or "").lower()
        assert "no-store" in cc


@patch("backend.blueprints.profile_me.load_profile", return_value=None)
def test_profile_me_returns_404_when_user_missing(_mock, profile_me_app: Flask) -> None:
    with profile_me_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "ghost_user_404"
            sess["login_id"] = "anything"
        resp = client.get("/api/profile_me?_nocache=1")
    assert resp.status_code == 404


@patch("backend.blueprints.profile_me.load_profile", side_effect=Exception("boom"))
def test_profile_me_returns_500_on_loader_exception(_mock, profile_me_app: Flask) -> None:
    """Use a unique username + ?_nocache=1 so we always hit the loader, not Redis."""
    with profile_me_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "boom_user_loader_500"
            sess["login_id"] = "x"
        resp = client.get("/api/profile_me?_nocache=1")
    assert resp.status_code == 500


@patch("backend.blueprints.profile_me.load_profile")
def test_profile_me_login_id_changes_with_establish_login(mock_loader, profile_me_app: Flask) -> None:
    """End-to-end: establish_login produces a value that flows through to the JSON body."""
    mock_loader.return_value = _stub_profile()

    with profile_me_app.test_client() as client:
        # Use the helper inside an actual request context.
        with profile_me_app.test_request_context("/api/profile_me"):
            login_id = auth_session.establish_login("alice")

        # Re-issue the call with the session that test_client maintains; copy
        # the login_id manually so the test client's session mirrors what
        # establish_login would have done in production.
        with client.session_transaction() as sess:
            sess["username"] = "alice"
            sess["login_id"] = login_id

        resp = client.get("/api/profile_me?_nocache=1")
        assert resp.get_json()["login_id"] == login_id
