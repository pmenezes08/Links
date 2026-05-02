"""Unit tests for `backend.services.auth_session.establish_login`.

This is the helper that backs the account-isolation guarantee in PR 2:
every successful authentication path (password, Google, invite signup,
remember-me restore, etc.) must funnel through it so:

  * stale session keys are wiped before the new identity is written;
  * a fresh `login_id` (UUID4) is minted and stamped on the session;
  * the session is marked permanent so the cookie is sent back.

Without these properties the client-side login epoch detector cannot
reliably distinguish "same user reloaded" from "new user signed in".
"""

from __future__ import annotations

import uuid

import pytest
from flask import Flask, session

from backend.services import auth_session


@pytest.fixture()
def session_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "test-establish-login"
    return app


def test_establish_login_clears_prior_session_keys(session_app: Flask) -> None:
    """Any leftover keys from a previous identity must NOT survive the call."""
    with session_app.test_request_context("/"):
        session["pending_username"] = "stale_user"
        session["pending_invite_token"] = "abc"
        session["random_pref"] = "keep-me-no"
        session["username"] = "old_user"

        auth_session.establish_login("new_user")

        assert session["username"] == "new_user"
        assert "pending_username" not in session
        assert "pending_invite_token" not in session
        assert "random_pref" not in session


def test_establish_login_mints_unique_login_id(session_app: Flask) -> None:
    """Two calls in the same session must produce different login_id values."""
    with session_app.test_request_context("/"):
        first = auth_session.establish_login("alice")
        second = auth_session.establish_login("alice")
        assert first != second
        # Both must be valid hex UUIDs.
        for token in (first, second):
            assert len(token) == 32
            uuid.UUID(token)  # raises if not a UUID


def test_establish_login_marks_session_permanent(session_app: Flask) -> None:
    """The session cookie has to stick (permanent=True), or the next request loses auth."""
    with session_app.test_request_context("/"):
        auth_session.establish_login("bob")
        assert session.permanent is True


def test_establish_login_records_login_at_unix(session_app: Flask) -> None:
    """The unix timestamp lets observability tools attribute behaviour to the right session."""
    with session_app.test_request_context("/"):
        auth_session.establish_login("carol")
        assert isinstance(session["login_at_unix"], int)
        assert session["login_at_unix"] > 0


def test_establish_login_rejects_empty_username(session_app: Flask) -> None:
    """Don't let callers create a session for the empty username (would auth as everyone)."""
    with session_app.test_request_context("/"):
        with pytest.raises(ValueError):
            auth_session.establish_login("")
