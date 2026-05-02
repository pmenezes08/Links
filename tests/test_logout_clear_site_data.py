"""Verify Clear-Site-Data and no-store headers on logout / delete_account.

Browsers that honour ``Clear-Site-Data`` (Chrome, Edge, Firefox) wipe Cache
Storage, IndexedDB, localStorage, sessionStorage, cookies, and SW
registrations for the origin in one shot when this header is set on the
logout response. It is the strongest server-side guarantee we can give that
no leftover client-side state from the previous session survives — and
tests it strictly so future PRs cannot accidentally drop it.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from backend.blueprints.auth import auth_bp
from backend.services import auth_session


@pytest.fixture()
def auth_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "test-logout-clear-site-data"
    app.config.setdefault("SESSION_COOKIE_NAME", "session")
    app.config.setdefault("SESSION_COOKIE_SECURE", False)
    app.register_blueprint(auth_bp)
    return app


# ── auth_session.clear_site_data unit ────────────────────────────────────


def test_clear_site_data_sets_expected_directives() -> None:
    """The header must list cache, cookies, and storage with double-quoted tokens."""

    class _Resp:
        headers: dict[str, str] = {}

    out = auth_session.clear_site_data(_Resp())
    header = out.headers["Clear-Site-Data"]
    assert '"cache"' in header
    assert '"cookies"' in header
    assert '"storage"' in header
    # Ordering and exact wording is part of the contract; if a future PR
    # changes it, the corresponding test in PR 2's accountStateReset must
    # be updated together.
    assert header == '"cache", "cookies", "storage"'


def test_clear_site_data_returns_same_response() -> None:
    """The helper is a fluent header stamp; it must not return a new object."""

    class _Resp:
        headers: dict[str, str] = {}

    inp = _Resp()
    out = auth_session.clear_site_data(inp)
    assert out is inp


# ── /logout integration ──────────────────────────────────────────────────


@patch("backend.blueprints.auth.deactivate_for_install", return_value={"native_push_tokens": 0, "fcm_tokens": 0})
@patch("backend.blueprints.auth.remember_tokens.revoke_by_cookie", return_value=0)
def test_logout_response_carries_clear_site_data(
    _mock_revoke, _mock_deact, auth_app: Flask,
) -> None:
    with auth_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "tester"
        resp = client.get("/logout", follow_redirects=False)
    # /logout redirects to /welcome; we still expect the headers on the redirect.
    assert resp.status_code in (301, 302)
    assert resp.headers.get("Clear-Site-Data") == '"cache", "cookies", "storage"'
    cc = (resp.headers.get("Cache-Control") or "").lower()
    assert "no-store" in cc, cc


@patch("backend.blueprints.auth.deactivate_for_install", return_value={"native_push_tokens": 0, "fcm_tokens": 0})
@patch("backend.blueprints.auth.remember_tokens.revoke_by_cookie", return_value=0)
def test_logout_works_for_anonymous_session(
    _mock_revoke, _mock_deact, auth_app: Flask,
) -> None:
    """Anonymous /logout must still attach the cleanup headers (no special-case)."""
    with auth_app.test_client() as client:
        resp = client.get("/logout", follow_redirects=False)
    assert resp.headers.get("Clear-Site-Data") == '"cache", "cookies", "storage"'


# ── /delete_account integration ──────────────────────────────────────────


@patch("backend.blueprints.auth.delete_user_in_connection")
@patch("backend.blueprints.auth.get_db_connection")
def test_delete_account_response_carries_clear_site_data(
    mock_get_conn, mock_delete, auth_app: Flask,
) -> None:
    cm = MagicMock()
    cm.commit = MagicMock()
    mock_get_conn.return_value.__enter__.return_value = cm
    mock_get_conn.return_value.__exit__.return_value = None
    mock_delete.return_value = []  # no former community ids

    with auth_app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "deleted_user"
        resp = client.post("/delete_account")

    assert resp.status_code == 200
    assert resp.headers.get("Clear-Site-Data") == '"cache", "cookies", "storage"'
    cc = (resp.headers.get("Cache-Control") or "").lower()
    assert "no-store" in cc, cc
    js = resp.get_json()
    assert js["success"] is True


def test_delete_account_requires_session(auth_app: Flask) -> None:
    """No session means no delete; verify the gate before checking headers."""
    with auth_app.test_client() as client:
        resp = client.post("/delete_account")
    # _session_required_api decorator returns 401 for unauthenticated callers.
    assert resp.status_code in (401, 403)
