"""Locale-aware entitlements denial payloads.

Pure tests. They verify the PR 4 contract: when ``build_error`` is
called with a non-English locale, the catalog message and CTA label
override the English defaults, and the legacy English path is
unchanged.

Maps to KB Tests-page row ``i18n:entitlements_locale`` (added in the
backend gate PR).
"""

from __future__ import annotations

import pytest

from backend.services import entitlements_errors as errs
from backend.services import i18n


@pytest.fixture(autouse=True)
def _reset_catalogs():
    i18n.reload_catalogs()
    yield
    i18n.reload_catalogs()


def test_english_default_unchanged():
    payload, status = errs.build_error(
        errs.REASON_MONTHLY_STEVE_CAP,
        ent={"tier": "premium", "steve_uses_per_month": 100},
        usage={"resets_at_monthly": "2026-06-01"},
    )
    assert status == 429
    assert payload["reason"] == "monthly_steve_cap"
    assert payload["locale"] == "en"
    assert "Steve calls" in payload["message"]
    assert payload["message_key"] == "entitlements.monthly_steve_cap.message"
    # CTA label still the English default.
    assert payload["cta"]["label"] == "See my usage"


def test_pt_pt_uses_catalog_message():
    payload, status = errs.build_error(
        errs.REASON_MONTHLY_STEVE_CAP,
        ent={"tier": "premium", "steve_uses_per_month": 100},
        usage={"resets_at_monthly": "2026-06-01"},
        locale="pt-PT",
    )
    assert status == 429
    assert payload["locale"] == "pt-PT"
    assert "100" in payload["message"]
    # Specific PT text is locked by the catalog, just verify it's NOT
    # the English default.
    assert "Steve calls" not in payload["message"]
    assert payload["cta"]["label"] != "See my usage"


def test_pt_pt_premium_required_includes_offer_caps_text():
    payload, status = errs.build_error(
        errs.REASON_PREMIUM_REQUIRED,
        ent={"tier": "free"},
        locale="pt-PT",
    )
    assert status == 402
    assert payload["locale"] == "pt-PT"
    assert payload["premium_offer"]["steve_uses_per_month"] > 0
    # The PT template references the offer caps via {steve_uses_per_month};
    # confirm the number ended up in the rendered text.
    offered = payload["premium_offer"]["steve_uses_per_month"]
    assert str(offered) in payload["message"]


def test_unknown_locale_falls_back_to_english():
    payload, _ = errs.build_error(
        errs.REASON_MONTHLY_STEVE_CAP,
        ent={"tier": "premium", "steve_uses_per_month": 100},
        usage={"resets_at_monthly": "2026-06-01"},
        locale="klingon",
    )
    # match_locale("klingon") returns None, normalize -> en.
    assert payload["locale"] == "en"
    assert "Steve calls" in payload["message"]


def test_message_key_is_always_set():
    """New clients can switch on message_key regardless of locale."""
    for reason in errs.ALL_REASONS:
        payload, _ = errs.build_error(reason)
        assert payload["message_key"] == f"entitlements.{reason}.message"
