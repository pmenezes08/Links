"""Tests for :mod:`backend.services.notification_copy`.

Pure tests. They lock the invariant that async notifications resolve
copy in the recipient's locale, never the sender's session locale.
"""

from __future__ import annotations

import pytest

from backend.services import i18n, notification_copy, user_locale


@pytest.fixture(autouse=True)
def _reset_catalogs():
    i18n.reload_catalogs()
    yield
    i18n.reload_catalogs()


def test_recipient_locale_defaults_to_english(monkeypatch):
    monkeypatch.setattr(user_locale, "get_preferred_locale", lambda u: None)
    assert notification_copy.recipient_locale("paulo") == "en"


def test_recipient_locale_returns_saved_choice(monkeypatch):
    monkeypatch.setattr(
        user_locale, "get_preferred_locale", lambda u: "pt-PT" if u == "paulo" else None
    )
    assert notification_copy.recipient_locale("paulo") == "pt-PT"
    assert notification_copy.recipient_locale("ana") == "en"


def test_recipient_locale_anonymous_user_is_default():
    assert notification_copy.recipient_locale("") == "en"
    assert notification_copy.recipient_locale(None) == "en"  # type: ignore[arg-type]


def test_recipient_locale_db_failure_falls_back(monkeypatch):
    def _boom(_u):
        raise RuntimeError("db down")

    monkeypatch.setattr(user_locale, "get_preferred_locale", _boom)
    assert notification_copy.recipient_locale("paulo") == "en"


def test_push_payload_english():
    payload = notification_copy.push_payload(
        "group_feed_post", "en", author="paulo", preview="Hello world", community="Lisbon"
    )
    assert payload["title"] == "New group post"
    assert payload["body"] == "paulo: Hello world"


def test_push_payload_portuguese():
    payload = notification_copy.push_payload(
        "group_feed_post", "pt-PT", author="paulo", preview="Olá mundo", community="Lisbon"
    )
    # Title is translated; body still uses the author and preview literals.
    assert payload["title"] != "New group post"
    assert "paulo: Olá mundo" == payload["body"]


def test_in_app_text_uses_community_param():
    line = notification_copy.in_app_text(
        "group_feed_post", "en", author="paulo", community="Lisbon"
    )
    assert "paulo" in line
    assert "Lisbon" in line


def test_in_app_text_no_community_variant():
    line = notification_copy.in_app_text(
        "group_feed_post_no_community", "pt-PT", author="paulo"
    )
    assert "paulo" in line
    # PT message should not be the same as the English one.
    assert "paulo posted in a group" != line
