"""G2 sanity: login-flow APIs stay on unverified-user allowlist after auth_bp move."""

from __future__ import annotations


def test_check_pending_and_clear_stale_in_allowlist_tuple():
    """`_block_unverified_users` must still allow these paths (string-matched)."""
    import bodybuilding_app as bb

    src = open(bb.__file__, encoding="utf-8").read()
    assert "'/api/check_pending_login'" in src
    assert "'/api/clear_stale_session'" in src
