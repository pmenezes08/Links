"""Matrix C2 — Disposable email blocklist (``backend.services.disposable_email``).

Pure tests. We cover:

  1. Known disposable domains from the bundled list are flagged.
  2. Common legitimate providers are NOT flagged (no false positives).
  3. KB toggle gates enforcement (``should_block``).
  4. Bundled list is non-empty and reload() refreshes the cache.
  5. Malformed input doesn't raise.
  6. KB-provided extras are unioned with the bundled list.

Maps to the KB Tests-page row ``signup:disposable_email_blocked``.
"""

from __future__ import annotations

import pytest

from backend.services import disposable_email


# ── 1. Known-disposable domains flagged ─────────────────────────────────


@pytest.mark.parametrize("email", [
    "abuser@mailinator.com",
    "throwaway@10minutemail.com",
    "burn@guerrillamail.com",
    "foo@yopmail.com",
    "bar@sharklasers.com",
    "x@tempmail.com",
    "y@trashmail.com",
    "z@maildrop.cc",
])
def test_known_disposable_domains_are_flagged(email):
    assert disposable_email.is_disposable(email) is True


def test_domain_match_is_case_insensitive():
    assert disposable_email.is_disposable("Foo@MAILINATOR.COM") is True


# ── 2. No false positives on common real providers ─────────────────────


@pytest.mark.parametrize("email", [
    "paulo@gmail.com",
    "alice@outlook.com",
    "bob@proton.me",
    "user@yahoo.com",
    "staff@c-point.co",
    "founder@mycompany.io",
    "test@hotmail.com",
    "someone@icloud.com",
])
def test_real_providers_are_not_flagged(email):
    assert disposable_email.is_disposable(email) is False


# ── 3. Enforcement toggle (``should_block``) ────────────────────────────


def test_should_block_respects_kb_toggle_off(monkeypatch):
    monkeypatch.setattr(
        "backend.services.disposable_email.is_blocking_enabled",
        lambda: False,
    )
    # Even a bright-red disposable address passes when enforcement is off.
    assert disposable_email.should_block("abuser@mailinator.com") is False


def test_should_block_respects_kb_toggle_on(monkeypatch):
    monkeypatch.setattr(
        "backend.services.disposable_email.is_blocking_enabled",
        lambda: True,
    )
    assert disposable_email.should_block("abuser@mailinator.com") is True
    assert disposable_email.should_block("paulo@gmail.com") is False


def test_is_blocking_enabled_defaults_to_true_on_kb_failure(monkeypatch):
    def boom(*_a, **_kw):
        raise RuntimeError("KB unreachable")
    monkeypatch.setattr("backend.services.knowledge_base.get_page", boom)
    assert disposable_email.is_blocking_enabled() is True


# ── 4. Bundled list sanity + reload ─────────────────────────────────────


def test_bundled_list_is_nonempty():
    """If this drops to 0 someone broke the packaging."""
    assert disposable_email.domain_count() > 20


def test_reload_returns_a_count_and_refreshes_cache():
    before = disposable_email.domain_count()
    after = disposable_email.reload()
    assert after == before
    assert after > 20


# ── 5. Malformed input doesn't raise ────────────────────────────────────


@pytest.mark.parametrize("email", [
    "",
    "not-an-email",
    "no-at-sign.com",
    "@nodomain",
    None,
])
def test_malformed_input_is_not_flagged_and_does_not_raise(email):
    assert disposable_email.is_disposable(email) is False


# ── 6. KB extras merge with bundled list ────────────────────────────────


def test_kb_extras_extend_the_blocklist(monkeypatch):
    """Admin-provided extras are unioned with the bundled file."""
    fake_page = {
        "fields": [
            {"name": "disposable_domains_blocklist_extra",
             "value": "evilco.example\nanotherabuse.test, yetanother.com"},
        ]
    }
    monkeypatch.setattr(
        "backend.services.knowledge_base.get_page",
        lambda slug: fake_page if slug == "trial-abuse-prevention" else None,
    )
    disposable_email.reload()
    try:
        assert disposable_email.is_disposable("x@evilco.example") is True
        assert disposable_email.is_disposable("y@anotherabuse.test") is True
        assert disposable_email.is_disposable("z@yetanother.com") is True
        # Bundled domains still work.
        assert disposable_email.is_disposable("w@mailinator.com") is True
    finally:
        # Undo the monkeypatched KB + refresh cache so later tests get
        # the pristine bundled-only list.
        monkeypatch.undo()
        disposable_email.reload()
