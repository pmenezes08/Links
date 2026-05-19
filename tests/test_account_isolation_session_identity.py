from __future__ import annotations

import pytest
from flask import Flask, session

from backend.blueprints.enterprise import enterprise_bp
from backend.blueprints.me import me_bp
from backend.blueprints.subscriptions import subscriptions_bp
from backend.services import session_identity


def _assert_no_store(resp) -> None:
    assert "no-store" in resp.headers.get("Cache-Control", "")
    assert resp.headers.get("Pragma") == "no-cache"
    assert resp.headers.get("Expires") == "0"


def test_valid_session_username_returns_existing_user(monkeypatch):
    app = Flask(__name__)
    app.secret_key = "test-secret"
    monkeypatch.setattr(session_identity, "user_exists", lambda username: username == "alice")

    with app.test_request_context("/"):
        session["username"] = "alice"
        assert session_identity.valid_session_username(session) == "alice"
        assert session["username"] == "alice"


def test_valid_session_username_clears_missing_user(monkeypatch):
    app = Flask(__name__)
    app.secret_key = "test-secret"
    monkeypatch.setattr(session_identity, "user_exists", lambda _username: False)

    with app.test_request_context("/"):
        session["username"] = "ghost"
        session.permanent = True
        assert session_identity.valid_session_username(session) is None
        assert "username" not in session
        assert session.permanent is False


@pytest.mark.parametrize(
    ("blueprint", "path"),
    [
        (me_bp, "/api/me/entitlements"),
        (subscriptions_bp, "/api/me/subscriptions"),
        (enterprise_bp, "/api/me/enterprise-seats"),
    ],
)
def test_sensitive_blueprints_clear_ghost_session_and_return_no_store_401(monkeypatch, blueprint, path):
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(blueprint)
    monkeypatch.setattr(session_identity, "user_exists", lambda _username: False)

    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "ghost"
            sess.permanent = True

        resp = client.get(path)
        assert resp.status_code == 401
        assert resp.get_json()["success"] is False
        _assert_no_store(resp)

        with client.session_transaction() as sess:
            assert "username" not in sess
