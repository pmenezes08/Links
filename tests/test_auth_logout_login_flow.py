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
    """Logout route clears session and redirects to welcome (full app)."""
    from bodybuilding_app import app as monolith

    with monolith.test_client() as client:
        rv = client.get("/logout", follow_redirects=False)
        assert rv.status_code in (302, 303, 301)
        loc = rv.headers.get("Location") or ""
        assert "/welcome" in loc


def test_logout_does_not_reissue_remember_token_after_silent_restore(mysql_dsn):
    """RC-1 regression: /logout response must not carry a fresh remember_token cookie
    even when ``before_app_request`` silently restored the session from remember-me.

    Before the May-2026 hotfix, ``rotate_remember_token_after_auto_login`` re-issued a
    new ``remember_token`` (and ``native_push_install_id``) on the /logout response itself,
    silently keeping the user signed in on Capacitor.
    """
    from datetime import datetime, timedelta
    import hashlib

    from backend.services import remember_tokens
    from backend.services.database import get_db_connection, get_sql_placeholder
    from bodybuilding_app import app as monolith
    from tests.fixtures import make_user

    make_user("rc1_user")
    raw = "rc1-raw-token"
    token_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    remember_tokens.ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(
            f"INSERT INTO remember_tokens (username, token_hash, created_at, expires_at) "
            f"VALUES ({ph}, {ph}, {ph}, {ph})",
            ("rc1_user", token_hash, datetime.utcnow(), datetime.utcnow() + timedelta(days=30)),
        )
        conn.commit()

    with monolith.test_client() as client:
        client.set_cookie("remember_token", raw, domain="localhost", path="/")
        rv = client.get("/logout", follow_redirects=False)

    set_cookies = rv.headers.getlist("Set-Cookie")
    remember_set_cookies = [h for h in set_cookies if h.startswith("remember_token=")]
    assert remember_set_cookies, "expected /logout to set the remember_token cookie at all"
    for header in remember_set_cookies:
        prefix = header.split(";", 1)[0]
        value = prefix.split("=", 1)[1] if "=" in prefix else ""
        assert value == "" or value == '""', (
            f"/logout must only EXPIRE remember_token (empty value), but got: {header}"
        )

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(f"SELECT COUNT(*) AS n FROM remember_tokens WHERE username={ph}", ("rc1_user",))
        row = c.fetchone()
        count = row["n"] if hasattr(row, "keys") else row[0]
    assert count == 0, "all remember_token rows for the user must be revoked on logout"


def test_logout_revokes_all_user_remember_rows(mysql_dsn):
    """PR-D: logout must revoke every remember-me row for the user, not just one."""
    from datetime import datetime, timedelta
    import hashlib

    from backend.services import remember_tokens
    from backend.services.database import get_db_connection, get_sql_placeholder
    from bodybuilding_app import app as monolith
    from tests.fixtures import make_user

    make_user("multi_device_user")
    make_user("other_user")
    remember_tokens.ensure_tables()

    raws = ["device-a", "device-b", "device-c"]
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        for raw in raws:
            c.execute(
                f"INSERT INTO remember_tokens (username, token_hash, created_at, expires_at) "
                f"VALUES ({ph}, {ph}, {ph}, {ph})",
                (
                    "multi_device_user",
                    hashlib.sha256(raw.encode("utf-8")).hexdigest(),
                    datetime.utcnow(),
                    datetime.utcnow() + timedelta(days=30),
                ),
            )
        c.execute(
            f"INSERT INTO remember_tokens (username, token_hash, created_at, expires_at) "
            f"VALUES ({ph}, {ph}, {ph}, {ph})",
            (
                "other_user",
                hashlib.sha256(b"keep-me").hexdigest(),
                datetime.utcnow(),
                datetime.utcnow() + timedelta(days=30),
            ),
        )
        conn.commit()

    with monolith.test_client() as client:
        client.set_cookie("remember_token", "device-a", domain="localhost", path="/")
        rv = client.get("/logout", follow_redirects=False)
        assert rv.status_code in (301, 302, 303)

    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()
        c.execute(f"SELECT COUNT(*) AS n FROM remember_tokens WHERE username={ph}", ("multi_device_user",))
        row = c.fetchone()
        target_count = row["n"] if hasattr(row, "keys") else row[0]
        c.execute(f"SELECT COUNT(*) AS n FROM remember_tokens WHERE username={ph}", ("other_user",))
        row = c.fetchone()
        other_count = row["n"] if hasattr(row, "keys") else row[0]

    assert target_count == 0, "logout must revoke every remember_token row for the user"
    assert other_count == 1, "logout must NOT touch other users' remember_token rows"


def test_clear_cookie_sweeps_legacy_domains(mysql_dsn):
    """PR-D: ``remember_tokens.clear_cookie`` must expire the cookie under host-only
    AND legacy ``.c-point.co`` / ``app.c-point.co`` domains, mirroring the session-cookie sweep."""
    from flask import Flask, make_response
    from backend.services import remember_tokens

    app = Flask(__name__)
    app.config.update(SESSION_COOKIE_DOMAIN=None)

    with app.app_context():
        resp = make_response("")
        remember_tokens.clear_cookie(resp)

    set_cookies = resp.headers.getlist("Set-Cookie")
    remember_set_cookies = [h for h in set_cookies if h.startswith("remember_token=")]
    assert any("Domain=.c-point.co" in h or "Domain=c-point.co" in h for h in remember_set_cookies), \
        "expected a Set-Cookie expiring remember_token for legacy .c-point.co domain"
    assert any("Domain=app.c-point.co" in h for h in remember_set_cookies), \
        "expected a Set-Cookie expiring remember_token for legacy app.c-point.co domain"
    assert any("Domain=" not in h for h in remember_set_cookies), \
        "expected a host-only Set-Cookie expiring remember_token (no Domain attribute)"
