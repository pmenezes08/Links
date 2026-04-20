"""Matrix C1 — Email normalization (``backend.services.email_normalization``).

Pure tests. No DB. No Docker. We only verify:

  1. Gmail dot/plus collapsing reproduces the industry-standard rules.
  2. Non-Gmail domains keep their dots (we don't over-collapse).
  3. Plus-tag stripping works broadly (Outlook / Proton / custom).
  4. Case + whitespace are always normalised.
  5. Malformed input doesn't raise.
  6. The KB toggle short-circuits the aggressive rules when disabled.

These map to the KB Tests-page row ``signup:email_normalization``.
"""

from __future__ import annotations

import pytest

from backend.services.email_normalization import (
    canonical_email,
    canonicalize_with_policy,
    is_normalization_enabled,
    is_well_formed,
    split_local_domain,
)


# ── 1. Gmail-specific rules ─────────────────────────────────────────────


@pytest.mark.parametrize("raw, expected", [
    ("Foo.Bar@gmail.com", "foobar@gmail.com"),
    ("f.o.o.b.a.r@gmail.com", "foobar@gmail.com"),
    ("foo+spam@gmail.com", "foo@gmail.com"),
    ("Foo.Bar+newsletter@gmail.com", "foobar@gmail.com"),
    ("foo@googlemail.com", "foo@googlemail.com"),
    ("Foo.Bar@googlemail.com", "foobar@googlemail.com"),
])
def test_gmail_rules_collapse_aliases(raw, expected):
    """Dot + plus + case are all dropped for @gmail / @googlemail."""
    assert canonical_email(raw) == expected


def test_gmail_dots_insensitive_but_aliases_stay_distinct():
    """Different local parts (post-normalization) remain distinct."""
    assert canonical_email("alice.smith@gmail.com") != canonical_email("bob.smith@gmail.com")


# ── 2. Non-Gmail: dots preserved ────────────────────────────────────────


@pytest.mark.parametrize("raw, expected", [
    ("Foo.Bar@outlook.com", "foo.bar@outlook.com"),
    ("foo.bar@yahoo.com", "foo.bar@yahoo.com"),
    ("foo.bar@mycompany.io", "foo.bar@mycompany.io"),
])
def test_non_gmail_dots_preserved(raw, expected):
    """Corporate / non-Gmail domains may route first.last vs firstlast."""
    assert canonical_email(raw) == expected


# ── 3. Plus-tag stripping is universal ──────────────────────────────────


@pytest.mark.parametrize("raw, expected", [
    ("foo+newsletter@outlook.com", "foo@outlook.com"),
    ("foo+shopping@proton.me", "foo@proton.me"),
    ("foo+nested+tag@fastmail.com", "foo@fastmail.com"),
    ("foo+@custom.com", "foo@custom.com"),
])
def test_plus_tag_always_stripped(raw, expected):
    assert canonical_email(raw) == expected


# ── 4. Case + whitespace ────────────────────────────────────────────────


def test_case_and_whitespace_are_normalised():
    assert canonical_email("  FOO@BAR.COM  ") == "foo@bar.com"
    assert canonical_email("FOO@BAR.COM") == canonical_email("foo@bar.com")


# ── 5. Malformed input ──────────────────────────────────────────────────


@pytest.mark.parametrize("raw", [
    "",
    "not-an-email",
    "@nodomain.com",
    "no-at-sign.com",
    "double@@at.com",
])
def test_malformed_inputs_do_not_raise(raw):
    """Validation is a separate concern — normalization must not crash."""
    result = canonical_email(raw)
    assert isinstance(result, str)


def test_is_well_formed_rejects_obvious_garbage():
    assert is_well_formed("foo@bar.com")
    assert not is_well_formed("")
    assert not is_well_formed("not-an-email")
    assert not is_well_formed("foo@")
    assert not is_well_formed("@bar.com")


def test_split_local_domain_returns_lowercase_or_none():
    assert split_local_domain("Foo@BAR.com") == ("foo", "bar.com")
    assert split_local_domain("garbage") is None


def test_empty_local_part_after_stripping_falls_back():
    """``+tag@gmail.com`` would otherwise yield an empty local-part."""
    result = canonical_email("+tag@gmail.com")
    assert "@" in result
    assert not result.startswith("@")


# ── 6. Feature flags (strip_dots / strip_plus) ──────────────────────────


def test_strip_dots_can_be_disabled():
    result = canonical_email("Foo.Bar@gmail.com", strip_dots_for_gmail=False)
    assert result == "foo.bar@gmail.com"


def test_strip_plus_can_be_disabled():
    result = canonical_email("foo+tag@gmail.com", strip_plus_alias=False)
    assert result == "foo+tag@gmail.com"


# ── 7. KB policy wrapper ────────────────────────────────────────────────


def test_canonicalize_with_policy_respects_kb_toggle_when_off(monkeypatch):
    """When the KB toggle is False, only lower+trim is applied."""
    monkeypatch.setattr(
        "backend.services.email_normalization.is_normalization_enabled",
        lambda: False,
    )
    assert canonicalize_with_policy("Foo.Bar+spam@gmail.com") == "foo.bar+spam@gmail.com"


def test_canonicalize_with_policy_applies_full_rules_when_on(monkeypatch):
    monkeypatch.setattr(
        "backend.services.email_normalization.is_normalization_enabled",
        lambda: True,
    )
    assert canonicalize_with_policy("Foo.Bar+spam@gmail.com") == "foobar@gmail.com"


def test_is_normalization_enabled_defaults_to_true_on_kb_failure(monkeypatch):
    """KB outage must default to the safer (normalizing) posture."""
    def boom(*_a, **_kw):
        raise RuntimeError("KB unreachable")
    monkeypatch.setattr("backend.services.knowledge_base.get_page", boom)
    assert is_normalization_enabled() is True
