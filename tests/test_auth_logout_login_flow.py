"""G2: Auth blueprint behaviours (logout, pending login API, remember-me guard)."""

from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.auth import auth_bp


@pytest.fixture()
def auth_only_app():
    """Minimal Flask app with only auth blueprint (fast; no monolith)."""
    app = Flask(__name__)
    app.secret_key = "test-auth-logout-flow"
    app.config.setdefault("SESSION_COOKIE_NAME", "session")
    app.config.setdefault("SESSION_COOKIE_SECURE", False)
    app.config.setdefault("AUTH_SESSION_LIFETIME_DAYS", 30)
    app.register_blueprint(auth_bp)
    return app


def test_check_pending_login_response_has_no_debug_keys(auth_only_app):
    with auth_only_app.test_client() as client:
        resp = client.get("/api/check_pending_login")
        assert resp.status_code == 200
        js = resp.get_json()
        assert isinstance(js, dict)
        assert "session_keys" not in js
        assert "debug" not in js
        assert set(js.keys()) <= {"success", "pending_username", "error"}


def test_logout_monolith_redirects():
    """Logout route clears session and redirects (full app)."""
    from bodybuilding_app import app as monolith

    with monolith.test_client() as client:
        rv = client.get("/logout", follow_redirects=False)
        assert rv.status_code in (302, 303, 301)
