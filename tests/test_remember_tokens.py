from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from http.cookies import SimpleCookie

from flask import Flask, make_response, request, session

from backend.services import remember_tokens
from backend.services.database import get_db_connection, get_sql_placeholder


def _app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.config.update(
        AUTH_SESSION_LIFETIME_DAYS=30,
        SESSION_COOKIE_DOMAIN=None,
        SESSION_COOKIE_NAME="cpoint_session",
    )
    return app


def _cookie_value(set_cookie_header: str, name: str = remember_tokens.COOKIE_NAME) -> str:
    cookie = SimpleCookie()
    cookie.load(set_cookie_header)
    return cookie[name].value


def _row_count() -> int:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("SELECT COUNT(*) AS count FROM remember_tokens")
        row = c.fetchone()
    return row["count"] if hasattr(row, "keys") else row[0]


def _insert_token(username: str, raw: str, expires_at: datetime | None = None) -> str:
    remember_tokens.ensure_tables()
    token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"""
            INSERT INTO remember_tokens (username, token_hash, created_at, expires_at)
            VALUES ({ph}, {ph}, {ph}, {ph})
            """,
            (username, token_hash, datetime.utcnow(), expires_at or (datetime.utcnow() + timedelta(days=30))),
        )
        conn.commit()
    return token_hash


def test_issue_then_restore_round_trip(mysql_dsn):
    app = _app()
    with app.app_context():
        remember_tokens.ensure_tables()
        response = make_response("")
        remember_tokens.issue(response, "alice")
        raw = _cookie_value(response.headers["Set-Cookie"])

    with app.test_request_context("/", environ_overrides={"HTTP_COOKIE": f"remember_token={raw}"}):
        restored = remember_tokens.restore_session(request, session)
        assert restored == "alice"
        assert session["username"] == "alice"
        assert session.permanent is True


def test_revoke_by_cookie_deletes_one_row(mysql_dsn):
    app = _app()
    hash_a = _insert_token("alice", "raw-a")
    _insert_token("bob", "raw-b")

    with app.test_request_context("/", environ_overrides={"HTTP_COOKIE": "remember_token=raw-a"}):
        assert remember_tokens.revoke_by_cookie(request) == 1

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(f"SELECT username FROM remember_tokens WHERE token_hash={ph}", (hash_a,))
        assert c.fetchone() is None

    assert _row_count() == 1


def test_revoke_by_cookie_when_cookie_absent_is_noop(mysql_dsn):
    app = _app()
    _insert_token("alice", "raw-a")

    with app.test_request_context("/"):
        assert remember_tokens.revoke_by_cookie(request) == 0

    assert _row_count() == 1


def test_clear_cookie_attribute_parity(mysql_dsn):
    app = _app()
    with app.app_context():
        issue_response = make_response("")
        remember_tokens.issue(issue_response, "alice")

        clear_response = make_response("")
        remember_tokens.clear_cookie(clear_response)

    issued = SimpleCookie()
    issued.load(issue_response.headers["Set-Cookie"])
    cleared = SimpleCookie()
    cleared.load(clear_response.headers["Set-Cookie"])

    issued_cookie = issued[remember_tokens.COOKIE_NAME]
    cleared_cookie = cleared[remember_tokens.COOKIE_NAME]
    for attr in ("secure", "httponly", "samesite", "path", "domain"):
        assert cleared_cookie[attr] == issued_cookie[attr]
    assert cleared_cookie["max-age"] == "0"


def test_expired_cookie_does_not_restore(mysql_dsn):
    app = _app()
    _insert_token("alice", "expired", datetime.utcnow() - timedelta(days=1))

    with app.test_request_context("/", environ_overrides={"HTTP_COOKIE": "remember_token=expired"}):
        assert remember_tokens.restore_session(request, session) is None
        assert "username" not in session


def test_revoke_for_user_wipes_all(mysql_dsn):
    _insert_token("alice", "a1")
    _insert_token("alice", "a2")
    _insert_token("alice", "a3")
    _insert_token("bob", "b1")

    assert remember_tokens.revoke_for_user("alice") == 3

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("SELECT username FROM remember_tokens")
        rows = c.fetchall()
    assert [row["username"] if hasattr(row, "keys") else row[0] for row in rows] == ["bob"]


def test_ensure_tables_idempotent(mysql_dsn):
    remember_tokens.ensure_tables()
    remember_tokens.ensure_tables()


def test_pending_username_blocks_auto_login_restore(mysql_dsn):
    """Two-step login: remember cookie must not hydrate username while pending_username is set."""
    from backend.blueprints.auth import auth_bp, auto_login_from_remember_token

    raw = secrets.token_urlsafe(16)
    _insert_token("alice", raw)

    app = Flask(__name__)
    app.secret_key = "test-secret-auth-guard"
    app.config.setdefault("AUTH_SESSION_LIFETIME_DAYS", 30)

    app.register_blueprint(auth_bp)

    with app.test_request_context("/", environ_overrides={"HTTP_COOKIE": f"remember_token={raw}"}):
        session["pending_username"] = "eve"
        auto_login_from_remember_token()
        assert session.get("username") is None
