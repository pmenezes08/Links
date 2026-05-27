"""Password reset routes and service behaviour."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from flask import Flask
from werkzeug.security import generate_password_hash

from backend.blueprints.auth import auth_bp
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services import password_reset as pw_reset
from backend.services.email_normalization import canonical_email

from tests.fixtures import make_user


@pytest.fixture()
def auth_only_app():
    app = Flask(__name__)
    app.secret_key = "test-password-reset"
    app.register_blueprint(auth_bp)
    return app


@pytest.fixture()
def mysql_db(mysql_dsn):
    """Reload DB module after MySQL env is active (import-order safe)."""
    import importlib

    import backend.services.database as db_mod

    importlib.reload(db_mod)
    import backend.services.password_reset as pw_mod

    importlib.reload(pw_mod)
    yield mysql_dsn


@pytest.fixture()
def patch_send(monkeypatch):
    sent = []

    def _fake_send(to_email, subject, html, *, text=None):
        sent.append({"to": to_email, "subject": subject})
        return True

    monkeypatch.setattr("backend.services.transactional_email.send", _fake_send)
    return sent


def _insert_user(*, username: str, email: str) -> None:
    from backend.services.database import get_db_connection, get_sql_placeholder

    make_user(username, email=email, subscription="free")
    ph = get_sql_placeholder()
    hashed = generate_password_hash("oldpass123")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            UPDATE users
            SET password = {ph}, canonical_email = {ph}
            WHERE username = {ph}
            """,
            (hashed, canonical_email(email), username),
        )
        conn.commit()


def test_request_password_reset_unknown_email_returns_success(auth_only_app, patch_send):
    with auth_only_app.test_client() as client:
        resp = client.post(
            "/request_password_reset",
            json={"email": "nobody-reset-test@example.com"},
        )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get("success") is True
    assert len(patch_send) == 0


def test_request_password_reset_known_user_creates_token_and_sends(
    auth_only_app, mysql_db, patch_send,
):
    email = "pwreset-known@example.com"
    username = "pwreset_known_user"
    _insert_user(username=username, email=email)

    with auth_only_app.test_client() as client:
        resp = client.post("/request_password_reset", json={"email": email})
    assert resp.status_code == 200
    assert resp.get_json().get("success") is True
    assert len(patch_send) == 1
    assert patch_send[0]["to"] == email

    from backend.services.database import get_db_connection, get_sql_placeholder

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT token, used FROM password_reset_tokens WHERE username = {ph} ORDER BY id DESC LIMIT 1",
            (username,),
        )
        row = cursor.fetchone()
    assert row is not None
    used = row["used"] if hasattr(row, "keys") else row[1]
    assert not used


def test_complete_reset_updates_password(auth_only_app, mysql_db, patch_send):
    email = "pwreset-complete@example.com"
    username = "pwreset_complete_user"
    _insert_user(username=username, email=email)

    with auth_only_app.test_client() as client:
        client.post("/request_password_reset", json={"email": email})

    from backend.services.database import get_db_connection, get_sql_placeholder

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"SELECT token FROM password_reset_tokens WHERE username = {ph} ORDER BY id DESC LIMIT 1",
            (username,),
        )
        row = cursor.fetchone()
    token = row["token"] if hasattr(row, "keys") else row[0]

    ok, _msg = pw_reset.complete_reset(token, "newpass456", "newpass456")
    assert ok is True

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"SELECT password, used FROM users WHERE username = {ph}", (username,))
        user_row = cursor.fetchone()
        cursor.execute(
            f"SELECT used FROM password_reset_tokens WHERE token = {ph}",
            (token,),
        )
        tok_row = cursor.fetchone()

    from werkzeug.security import check_password_hash

    pwd = user_row["password"] if hasattr(user_row, "keys") else user_row[0]
    assert check_password_hash(pwd, "newpass456")
    used = tok_row["used"] if hasattr(tok_row, "keys") else tok_row[0]
    assert used


def test_expired_token_rejected(auth_only_app, mysql_db):
    email = "pwreset-expired@example.com"
    username = "pwreset_expired_user"
    _insert_user(username=username, email=email)
    token = "expired-token-test"
    old_time = (datetime.now() - timedelta(hours=25)).isoformat()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            INSERT INTO password_reset_tokens (username, email, token, created_at, used)
            VALUES ({ph}, {ph}, {ph}, {ph}, 0)
            """,
            (username, email, token, old_time),
        )
        conn.commit()

    import backend.services.password_reset as pw_mod

    assert pw_mod.get_token_context(token) is None
    ok, msg = pw_mod.complete_reset(token, "newpass456", "newpass456")
    assert ok is False
    assert "expired" in msg.lower() or "invalid" in msg.lower()
