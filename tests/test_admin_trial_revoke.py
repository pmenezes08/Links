"""Admin POST ``/api/admin/users/<u>/trial/revoke`` + ``user_trial`` service."""

from __future__ import annotations

import pytest
from flask import Flask

import backend.blueprints.admin_users as admin_users_mod
from backend.services import knowledge_base, subscription_audit, user_trial
from tests.fixtures import days_ago, make_user


@pytest.fixture
def client(mysql_dsn, monkeypatch):
    knowledge_base.ensure_tables()
    subscription_audit.ensure_tables()
    user_trial.ensure_trial_columns()
    monkeypatch.setattr(admin_users_mod, "is_app_admin", lambda username: username == "admin")

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(admin_users_mod.admin_users_bp)
    with app.test_client() as c:
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def test_revoke_trial_requires_admin_session(client):
    make_user("admin", is_admin=True)
    make_user("trial_u", subscription="free", created_at=days_ago(5))
    _login(client, "trial_u")
    resp = client.post(
        "/api/admin/users/trial_u/trial/revoke",
        json={"reason": "needed"},
    )
    assert resp.status_code == 403


def test_revoke_trial_requires_reason(client):
    make_user("admin", is_admin=True)
    make_user("trial_u", subscription="free", created_at=days_ago(5))
    _login(client, "admin")
    resp = client.post("/api/admin/users/trial_u/trial/revoke", json={})
    assert resp.status_code == 400


def test_revoke_trial_400_when_not_trial_tier(client):
    make_user("admin", is_admin=True)
    make_user("old_free", subscription="free", created_at=days_ago(60))
    _login(client, "admin")
    resp = client.post(
        "/api/admin/users/old_free/trial/revoke",
        json={"reason": "mistake"},
    )
    assert resp.status_code == 400


def test_revoke_trial_sets_column_and_audit(client):
    make_user("admin", is_admin=True)
    make_user("trial_u", subscription="free", created_at=days_ago(5))
    _login(client, "admin")
    resp = client.post(
        "/api/admin/users/trial_u/trial/revoke",
        json={"reason": "abuse"},
    )
    assert resp.status_code == 200
    rows = subscription_audit.list_for_user("trial_u", limit=10)
    assert any(r.get("action") == "trial_revoked_by_admin" for r in rows)
    assert user_trial.trial_revoked_at("trial_u")


def test_revoke_trial_idempotent_second_call(client):
    make_user("admin", is_admin=True)
    make_user("trial_u", subscription="free", created_at=days_ago(5))
    _login(client, "admin")
    assert client.post(
        "/api/admin/users/trial_u/trial/revoke",
        json={"reason": "first"},
    ).status_code == 200
    assert client.post(
        "/api/admin/users/trial_u/trial/revoke",
        json={"reason": "second"},
    ).status_code == 200


def test_manage_includes_trial_revoked_at_after_revoke(client):
    make_user("admin", is_admin=True)
    make_user("trial_u", subscription="free", created_at=days_ago(5))
    _login(client, "admin")
    client.post("/api/admin/users/trial_u/trial/revoke", json={"reason": "x"})
    resp = client.get("/api/admin/users/trial_u/manage")
    assert resp.status_code == 200
    js = resp.get_json()
    assert js.get("trial_revoked_at")
