"""Tests for the relocated `/api/check_admin` endpoint (PR 2).

The route used to live in `bodybuilding_app.py` behind the monolith's
`@login_required` decorator, which redirected unauthenticated callers to
the login page. The new home in `backend.blueprints.me` returns a JSON
body for both authenticated and unauthenticated callers (the client UI
just hides the badge if `is_admin` is False), so we exercise both
branches here.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from flask import Flask

from backend.blueprints.me import me_bp


@pytest.fixture()
def me_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "test-check-admin"
    app.register_blueprint(me_bp)
    return app


def test_check_admin_returns_false_for_anonymous(me_app: Flask) -> None:
    """Public callers should get `{is_admin: False}` rather than 401, so the UI degrades cleanly."""
    with me_app.test_client() as client:
        resp = client.get("/api/check_admin")
    assert resp.status_code == 200
    assert resp.get_json() == {"is_admin": False}


@patch("backend.blueprints.me.is_app_admin")
def test_check_admin_returns_true_for_admin(mock_is_app_admin, me_app: Flask) -> None:
    mock_is_app_admin.return_value = True
    with me_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "paulo"
        resp = client.get("/api/check_admin")
    assert resp.status_code == 200
    assert resp.get_json() == {"is_admin": True}
    mock_is_app_admin.assert_called_once_with("paulo")


@patch("backend.blueprints.me.is_app_admin")
def test_check_admin_returns_false_for_non_admin(mock_is_app_admin, me_app: Flask) -> None:
    mock_is_app_admin.return_value = False
    with me_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "joe"
        resp = client.get("/api/check_admin")
    assert resp.get_json() == {"is_admin": False}


@patch("backend.blueprints.me.is_app_admin")
def test_check_admin_response_has_no_store(mock_is_app_admin, me_app: Flask) -> None:
    """PR 1's policy: any /api/* must not be cached. Verify it survived the move."""
    from backend.services.http_headers import init_app

    init_app(me_app)
    mock_is_app_admin.return_value = True
    with me_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "paulo"
        resp = client.get("/api/check_admin")
    cc = (resp.headers.get("Cache-Control") or "").lower()
    assert "no-store" in cc
