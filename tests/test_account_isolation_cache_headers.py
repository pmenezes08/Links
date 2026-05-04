from __future__ import annotations

import pytest
from flask import Flask

from backend.blueprints.dm_chats import dm_chats_bp
from backend.blueprints.enterprise import enterprise_bp
from backend.blueprints.group_chat import group_chat_bp
from backend.blueprints.me import me_bp
from backend.blueprints.notifications import notifications_bp
from backend.blueprints.subscriptions import subscriptions_bp


def _assert_no_store(resp) -> None:
    assert "no-store" in resp.headers.get("Cache-Control", "")
    assert resp.headers.get("Pragma") == "no-cache"
    assert resp.headers.get("Expires") == "0"


@pytest.mark.parametrize(
    ("blueprint", "path"),
    [
        (me_bp, "/api/me/entitlements"),
        (subscriptions_bp, "/api/me/subscriptions"),
        (dm_chats_bp, "/api/chat_threads"),
        (group_chat_bp, "/api/group_chat/list"),
        (notifications_bp, "/api/notifications/badge-count"),
        (enterprise_bp, "/api/me/enterprise-seats"),
    ],
)
def test_sensitive_blueprint_responses_are_no_store(blueprint, path):
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(blueprint)

    with app.test_client() as client:
        resp = client.get(path)

    _assert_no_store(resp)
