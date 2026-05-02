"""Unit tests for OAuth email verification timestamp helpers."""

from __future__ import annotations

from unittest.mock import MagicMock

from backend.services.oauth_email_verification import (
    apply_oauth_email_verified,
    first_oauth_verified_at_iso,
)


def test_first_oauth_verified_at_iso_looks_like_iso():
    s = first_oauth_verified_at_iso()
    assert isinstance(s, str)
    assert len(s) >= 10
    assert "T" in s or "-" in s


def test_apply_oauth_email_verified_noop_when_not_verified_sqlite_placeholder():
    cur = MagicMock()
    apply_oauth_email_verified(cur, "?", "alice", False)
    cur.execute.assert_not_called()


def test_apply_oauth_email_verified_runs_update_with_coalesce_mysql_placeholder():
    cur = MagicMock()
    apply_oauth_email_verified(cur, "%s", "bob", True)
    assert cur.execute.call_count == 1
    stmt, params = cur.execute.call_args[0]
    assert "COALESCE(email_verified_at" in stmt
    assert "email_verified = 1" in stmt
    assert "WHERE username" in stmt
    assert len(params) == 2
    assert params[1] == "bob"
    assert isinstance(params[0], str)
