"""Age gate service + POST /api/me/age-confirmation (Option A, no DOB)."""

from __future__ import annotations

from datetime import timedelta

import pytest
from flask import Flask

from backend.blueprints.me import me_bp
from backend.services import user_age_gate
from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_user


@pytest.fixture
def client(mysql_dsn):
    user_age_gate.ensure_age_gate_columns()
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(me_bp)
    with app.test_client() as c:
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _read_age_columns(username: str):
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT age_confirmed_at, age_consent_given, underage_delete_scheduled_at, is_active
            FROM users WHERE username = {ph}
            """,
            (username,),
        )
        return c.fetchone()


def test_confirm_sets_columns(client):
    make_user("adult_u")
    _login(client, "adult_u")
    resp = client.post("/api/me/age-confirmation", json={"confirmed": True})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["status"] == "confirmed"
    assert data.get("age_confirmed_at")

    row = _read_age_columns("adult_u")
    assert row["age_confirmed_at"] is not None
    assert int(row["age_consent_given"]) == 1
    assert row["underage_delete_scheduled_at"] is None
    assert int(row["is_active"]) == 1


def test_confirm_idempotent(client):
    make_user("adult_u2")
    _login(client, "adult_u2")
    assert client.post("/api/me/age-confirmation", json={"confirmed": True}).status_code == 200
    resp = client.post("/api/me/age-confirmation", json={"confirmed": True})
    assert resp.status_code == 200
    assert resp.get_json().get("already_confirmed") is True


def test_underage_schedules_deletion_not_immediate_delete(client):
    make_user("minor_u")
    _login(client, "minor_u")
    resp = client.post("/api/me/age-confirmation", json={"confirmed": False})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["status"] == "scheduled_deletion"
    assert data.get("purge_at")

    row = _read_age_columns("minor_u")
    assert row["age_confirmed_at"] is None
    assert int(row["age_consent_given"]) == 0
    assert row["underage_delete_scheduled_at"] is not None
    assert int(row["is_active"]) == 0

    status = user_age_gate.get_age_gate_status("minor_u")
    assert status["status"] == "scheduled_deletion"


def test_underage_clears_session(client):
    make_user("minor_u2")
    _login(client, "minor_u2")
    client.post("/api/me/age-confirmation", json={"confirmed": False})
    with client.session_transaction() as sess:
        assert "username" not in sess


def test_age_confirmation_requires_auth(client):
    resp = client.post("/api/me/age-confirmation", json={"confirmed": True})
    assert resp.status_code == 401


def test_age_confirmation_requires_body(client):
    make_user("adult_u3")
    _login(client, "adult_u3")
    resp = client.post("/api/me/age-confirmation", json={})
    assert resp.status_code == 400


def test_purge_due_underage_accounts(mysql_dsn):
    make_user("due_minor")
    user_age_gate.ensure_age_gate_columns()
    past = user_age_gate.utc_now() - timedelta(days=1)
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            UPDATE users
            SET age_consent_given = 0,
                underage_delete_scheduled_at = {ph},
                is_active = 0
            WHERE username = {ph}
            """,
            (past, "due_minor"),
        )
        conn.commit()

    dry = user_age_gate.purge_due_underage_accounts(dry_run=True)
    assert dry["due"] >= 1

    result = user_age_gate.purge_due_underage_accounts(dry_run=False, limit=10)
    assert result["purged"] >= 1

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT username FROM users WHERE username = {ph}", ("due_minor",))
        assert c.fetchone() is None


def test_purge_underage_cron_requires_secret_and_supports_dry_run(monkeypatch):
    monkeypatch.setenv("CRON_SHARED_SECRET", "cron-test-secret")
    monkeypatch.delenv("FLASK_ENV", raising=False)

    def _fake_purge(**kwargs):
        return {"purged": 0, "due": 2, "dry_run": bool(kwargs.get("dry_run"))}

    monkeypatch.setattr(user_age_gate, "purge_due_underage_accounts", _fake_purge)

    app = Flask(__name__)
    app.register_blueprint(me_bp)
    cron_client = app.test_client()

    forbidden = cron_client.post("/api/cron/purge-underage?dry_run=1")
    assert forbidden.status_code == 403

    allowed = cron_client.post(
        "/api/cron/purge-underage?dry_run=1",
        headers={"X-Cron-Secret": "cron-test-secret"},
    )
    assert allowed.status_code == 200
    payload = allowed.get_json()
    assert payload["success"] is True
    assert payload["dry_run"] is True
    assert payload["purged"] == 0
    assert payload["due"] == 2


def test_purge_underage_cron_hides_error_details_in_production(monkeypatch):
    monkeypatch.setenv("CRON_SHARED_SECRET", "cron-test-secret")
    monkeypatch.setenv("FLASK_ENV", "production")

    def _fake_purge(**kwargs):
        return {"purged": 0, "due": 1, "errors": ["leaked_user:boom"]}

    monkeypatch.setattr(user_age_gate, "purge_due_underage_accounts", _fake_purge)

    app = Flask(__name__)
    app.register_blueprint(me_bp)
    resp = app.test_client().post(
        "/api/cron/purge-underage",
        headers={"X-Cron-Secret": "cron-test-secret"},
    )
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert payload["error_count"] == 1
    assert "errors" not in payload
    assert "leaked_user" not in str(payload)
