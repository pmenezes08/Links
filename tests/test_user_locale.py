"""Tests for :mod:`backend.services.user_locale`.

Storage round-trip lives in an opt-in test that requires the MySQL
testcontainer (``mysql_dsn`` fixture from ``tests/conftest.py``).
Everything else here is pure logic — locale validation and the
:func:`resolve_request_locale` chain — and runs without a DB.

Pure tests map to KB Tests-page row ``i18n:user_locale_chain``
(seeded in the backend gate PR).
"""

from __future__ import annotations

import pytest

from backend.services import i18n, user_locale


# ── Fake request used for header tests ──────────────────────────────────


class _Headers(dict):
    def get(self, key, default=None):  # type: ignore[override]
        # Flask's request.headers is case-insensitive.
        for k, v in self.items():
            if k.lower() == key.lower():
                return v
        return default


class _FakeRequest:
    def __init__(self, **headers: str):
        self.headers = _Headers(headers)


# ── 1. Locale validation in set_preferred_locale (no DB hit) ────────────


def test_set_preferred_locale_rejects_unsupported_locale(monkeypatch):
    # Short-circuit the DB layer; we never get here on bad input.
    def _explode(*args, **kwargs):
        raise AssertionError("DB should not be hit on invalid input")

    monkeypatch.setattr(user_locale, "ensure_locale_column", lambda: None)
    monkeypatch.setattr(user_locale, "get_db_connection", _explode)

    with pytest.raises(ValueError):
        user_locale.set_preferred_locale("paulo", "klingon")


def test_set_preferred_locale_requires_username(monkeypatch):
    monkeypatch.setattr(user_locale, "ensure_locale_column", lambda: None)
    with pytest.raises(ValueError):
        user_locale.set_preferred_locale("", "pt-PT")


# ── 2. resolve_request_locale chain (no DB hit) ─────────────────────────


def test_resolve_request_locale_prefers_saved_choice(monkeypatch):
    monkeypatch.setattr(
        user_locale, "get_preferred_locale", lambda u: "pt-PT" if u == "paulo" else None
    )
    req = _FakeRequest(**{
        "X-CPoint-Locale": "en",
        "Accept-Language": "en",
    })
    assert user_locale.resolve_request_locale(req, "paulo") == "pt-PT"


def test_resolve_request_locale_uses_x_cpoint_locale_when_no_saved(monkeypatch):
    monkeypatch.setattr(user_locale, "get_preferred_locale", lambda u: None)
    req = _FakeRequest(**{"X-CPoint-Locale": "pt-PT", "Accept-Language": "en"})
    assert user_locale.resolve_request_locale(req, "paulo") == "pt-PT"


def test_resolve_request_locale_falls_through_to_accept_language(monkeypatch):
    monkeypatch.setattr(user_locale, "get_preferred_locale", lambda u: None)
    req = _FakeRequest(**{"Accept-Language": "pt-PT,en;q=0.6"})
    assert user_locale.resolve_request_locale(req, "paulo") == "pt-PT"


def test_resolve_request_locale_unknown_x_cpoint_falls_through(monkeypatch):
    """An unrecognised override must NOT short-circuit to English."""
    monkeypatch.setattr(user_locale, "get_preferred_locale", lambda u: None)
    req = _FakeRequest(**{
        "X-CPoint-Locale": "klingon",
        "Accept-Language": "pt-PT",
    })
    assert user_locale.resolve_request_locale(req, "paulo") == "pt-PT"


def test_resolve_request_locale_anonymous_user(monkeypatch):
    """No username means we skip the DB lookup entirely."""
    def _explode(*args, **kwargs):
        raise AssertionError("get_preferred_locale should not be called")

    monkeypatch.setattr(user_locale, "get_preferred_locale", _explode)
    req = _FakeRequest(**{"Accept-Language": "pt-PT"})
    assert user_locale.resolve_request_locale(req, None) == "pt-PT"


def test_resolve_request_locale_no_request_returns_default():
    assert user_locale.resolve_request_locale(None, None) == i18n.DEFAULT_LOCALE


def test_resolve_request_locale_db_failure_is_non_fatal(monkeypatch):
    """If preferred_locale read explodes, request headers still win."""
    def _boom(_u):
        raise RuntimeError("simulated db outage")

    monkeypatch.setattr(user_locale, "get_preferred_locale", _boom)
    req = _FakeRequest(**{"Accept-Language": "pt-PT"})
    assert user_locale.resolve_request_locale(req, "paulo") == "pt-PT"


# ── 3. Storage round-trip (opt-in, requires MySQL container) ────────────


def test_storage_round_trip_when_db_available(mysql_dsn):
    """Save -> read -> clear -> read, against a real users row."""
    from tests.fixtures import make_user

    make_user("locale_user_a")
    # Before any write the saved locale is None.
    assert user_locale.get_preferred_locale("locale_user_a") is None

    stored = user_locale.set_preferred_locale("locale_user_a", "pt-PT")
    assert stored == "pt-PT"
    assert user_locale.get_preferred_locale("locale_user_a") == "pt-PT"

    # Aliases normalise on the way in.
    stored = user_locale.set_preferred_locale("locale_user_a", "pt_pt")
    assert stored == "pt-PT"
    assert user_locale.get_preferred_locale("locale_user_a") == "pt-PT"

    # Clearing restores None (request-chain detection takes over).
    cleared = user_locale.set_preferred_locale("locale_user_a", None)
    assert cleared is None
    assert user_locale.get_preferred_locale("locale_user_a") is None
