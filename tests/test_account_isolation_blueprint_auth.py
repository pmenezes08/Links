from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.communities import communities_bp
from backend.blueprints.dm_chats import dm_chats_bp
from backend.blueprints.group_chat import group_chat_bp
from backend.blueprints.notifications import notifications_bp
from backend.services import session_identity


def _assert_no_store(resp) -> None:
    assert "no-store" in resp.headers.get("Cache-Control", "")
    assert resp.headers.get("Pragma") == "no-cache"
    assert resp.headers.get("Expires") == "0"


@pytest.mark.parametrize(
    ("blueprint", "path", "expected_error"),
    [
        (dm_chats_bp, "/api/chat_threads", "unauthenticated"),
        (group_chat_bp, "/api/group_chat/list", "Login required"),
        (notifications_bp, "/api/notifications/badge-count", "unauthenticated"),
        (communities_bp, "/api/user_communities_hierarchical", "unauthenticated"),
    ],
)
def test_remaining_blueprints_clear_ghost_session_and_return_json_401(
    monkeypatch, blueprint, path, expected_error
):
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
        body = resp.get_json()
        assert body["success"] is False
        assert body["error"] == expected_error
        _assert_no_store(resp)

        with client.session_transaction() as sess:
            assert "username" not in sess


def test_communities_html_without_session_still_redirects():
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.add_url_rule("/login", endpoint="auth.login", view_func=lambda: "login")
    app.register_blueprint(communities_bp)

    with app.test_client() as client:
        resp = client.get("/communities")

    assert resp.status_code == 302
    assert resp.headers["Location"].endswith("/login")
