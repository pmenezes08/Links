"""Phase F2 / G7: canonical is_app_admin preserves legacy `admin` username behaviour."""

from __future__ import annotations

from backend.services.community import is_app_admin


def test_is_app_admin_legacy_username_admin_returns_true():
    """Plan parity: the historical `admin` account keeps working as global admin."""
    assert is_app_admin("admin") is True


def test_is_app_admin_blank_false():
    assert is_app_admin("") is False
    assert is_app_admin(None) is False
