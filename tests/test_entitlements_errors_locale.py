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


def test_pt_pt_premium_required_pitches_community_plans():
    payload, status = errs.build_error(
        errs.REASON_PREMIUM_REQUIRED,
        ent={"tier": "free"},
        locale="pt-PT",
    )
    assert status == 402
    assert payload["locale"] == "pt-PT"
    # Payload shape keeps premium_offer for older clients.
    assert payload["premium_offer"]["steve_uses_per_month"] > 0
    # B2B pivot: the denial pitches community plans, not personal Premium.
    assert "comunidade" in payload["message"].lower()
    assert "premium" not in payload["message"].lower()
    assert payload["cta"]["url"] == "/subscription_plans"


def test_en_premium_required_pitches_community_plans():
    payload, status = errs.build_error(
        errs.REASON_PREMIUM_REQUIRED,
        ent={"tier": "free"},
    )
    assert status == 402
    assert "community" in payload["message"].lower()
    assert "premium" not in payload["message"].lower()
    assert payload["cta"]["label"] == "See community plans"
    assert payload["cta"]["url"] == "/subscription_plans"


_ADDON_OVERRIDES = {
    "message_key": "entitlements.premium_required.addon_message",
    "cta_label_key": "entitlements.premium_required.addon_cta_label",
    "message": (
        "This community is on a paid plan — adding the Steve Community "
        "Package unlocks Steve for every member."
    ),
    "cta": {
        "type": "upgrade",
        "label": "Add the Steve Community Package",
        "url": "/subscription_plans?open=community_addons&community_id=123",
    },
}


def test_en_addon_override_reroutes_to_addon_panel():
    """Paid-tier-no-package variant: add-on CTA + variant copy (English)."""
    payload, status = errs.build_error(
        errs.REASON_PREMIUM_REQUIRED,
        ent={"tier": "free"},
        overrides=dict(_ADDON_OVERRIDES),
    )
    assert status == 402
    assert payload["cta"]["url"] == "/subscription_plans?open=community_addons&community_id=123"
    assert payload["cta"]["type"] == "upgrade"
    assert "Steve Community Package" in payload["message"]
    assert "paid plan" in payload["message"]
    assert payload["message_key"] == "entitlements.premium_required.addon_message"
    assert payload["cta"]["label"] == "Add the Steve Community Package"


@pytest.mark.parametrize("locale", ["pt-PT", "de-DE"])
def test_addon_override_is_localized_with_untranslated_product_name(locale):
    """Non-English locales serve their own addon variant; the product name
    "Steve Community Package" stays an untranslated proper noun."""
    payload, status = errs.build_error(
        errs.REASON_PREMIUM_REQUIRED,
        ent={"tier": "free"},
        overrides=dict(_ADDON_OVERRIDES),
        locale=locale,
    )
    assert status == 402
    assert payload["locale"] == locale
    # Localized variant, not the English fallback literal.
    assert payload["message"] != _ADDON_OVERRIDES["message"]
    assert "Steve Community Package" in payload["message"]
    assert payload["cta"]["label"] != "Add the Steve Community Package"
    assert "Steve Community Package" in payload["cta"]["label"]
    # The URL is data, not copy — identical across locales.
    assert payload["cta"]["url"] == "/subscription_plans?open=community_addons&community_id=123"


def test_product_name_never_translated_in_premium_required():
    """"Steve Community Package" is a proper noun in every catalog (the
    old pt-PT catalog translated it to "Pacote Steve para comunidades")."""
    for locale in i18n.available_locales():
        payload, _ = errs.build_error(
            errs.REASON_PREMIUM_REQUIRED, ent={"tier": "free"}, locale=locale
        )
        assert "Steve Community Package" in payload["message"], locale
        assert "Pacote Steve" not in payload["message"], locale


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
