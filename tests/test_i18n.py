"""Tests for :mod:`backend.services.i18n`.

Pure tests. No DB. No Flask client. They verify the three contracts the
rest of the epic relies on:

1. Locale normalisation handles real-world ``Accept-Language`` hints,
   including weighted lists and unsupported tags.
2. Catalog lookup returns the right string in ``en`` and ``pt-PT``,
   with the documented fallback chain (``pt-PT`` → ``pt`` → ``en``).
3. Parameter interpolation matches ``str.format`` semantics and is
   robust to malformed input.

These map to the KB Tests-page row ``i18n:core_service`` (added in the
backend gate PR).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services import i18n


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _reset_catalogs():
    """Force a fresh catalog read for every test."""
    i18n.reload_catalogs()
    yield
    i18n.reload_catalogs()


# ── 1. Locale normalisation ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("pt-PT", "pt-PT"),
        ("pt_pt", "pt-PT"),
        ("PT-PT", "pt-PT"),
        ("pt", "pt-PT"),
        ("pt-BR", "pt-PT"),   # v1 maps Brazilian to PT until pt-BR catalog ships
        ("de-DE", "de-DE"),
        ("de", "de-DE"),
        ("de_DE", "de-DE"),
        ("DE-de", "de-DE"),
        ("de-AT", "de-DE"),   # Austrian / Swiss German map to de-DE in v1
        ("de-CH", "de-DE"),
        ("en", "en"),
        ("en-US", "en"),
        ("en-GB", "en"),
        ("EN_GB", "en"),
        ("", "en"),
        (None, "en"),
        ("klingon", "en"),
        ("xx-YY", "en"),
    ],
)
def test_normalize_locale(raw, expected):
    assert i18n.normalize_locale(raw) == expected


@pytest.mark.parametrize(
    "header, expected",
    [
        ("pt-PT", "pt-PT"),
        ("pt-PT,en;q=0.5", "pt-PT"),
        ("en-US,en;q=0.8", "en"),
        ("fr-FR,pt-PT;q=0.7,en;q=0.3", "pt-PT"),
        ("de-DE", "de-DE"),
        ("de", "de-DE"),
        ("de-AT,en;q=0.4", "de-DE"),
        ("fr-FR,de-DE;q=0.7,en;q=0.3", "de-DE"),
        ("", "en"),
        (None, "en"),
        ("pt;q=0.9", "pt-PT"),
        ("pt-BR,en;q=0.4", "pt-PT"),
    ],
)
def test_parse_accept_language(header, expected):
    assert i18n.parse_accept_language(header) == expected


# ── 2. Catalog lookup + fallback ────────────────────────────────────────


def test_basic_lookup_english():
    assert i18n.t("common.save", "en") == "Save"
    assert i18n.t("common.cancel", "en") == "Cancel"


def test_basic_lookup_portuguese():
    assert i18n.t("common.save", "pt-PT") == "Guardar"
    assert i18n.t("common.cancel", "pt-PT") == "Cancelar"


def test_basic_lookup_german():
    assert i18n.t("common.save", "de-DE") == "Speichern"
    assert i18n.t("common.cancel", "de-DE") == "Abbrechen"


def test_default_locale_when_locale_missing():
    # No locale argument → falls back to English.
    assert i18n.t("common.save") == "Save"


def test_missing_key_returns_key_and_logs(caplog):
    with caplog.at_level("WARNING", logger="backend.services.i18n"):
        result = i18n.t("does.not.exist", "pt-PT")
    assert result == "does.not.exist"
    assert any("missing key" in rec.message for rec in caplog.records)


def test_fallback_chain_falls_back_to_english(monkeypatch, tmp_path):
    """A key only present in en.json should still resolve for pt-PT."""
    # Copy real catalogs into a temp dir but strip the key from pt-PT.
    en = {"common": {"only_in_en": "English only"}}
    pt = {"common": {}}
    (tmp_path / "en.json").write_text(json.dumps(en), encoding="utf-8")
    (tmp_path / "pt-PT.json").write_text(json.dumps(pt), encoding="utf-8")
    monkeypatch.setattr(i18n, "LOCALES_DIR", tmp_path)
    i18n.reload_catalogs()

    assert i18n.t("common.only_in_en", "pt-PT") == "English only"


def test_has_key():
    assert i18n.has_key("common.save", "en")
    assert i18n.has_key("common.save", "pt-PT")
    assert i18n.has_key("common.save", "de-DE")
    assert not i18n.has_key("does.not.exist", "en")


def test_available_locales_includes_supported():
    locales = i18n.available_locales()
    assert "en" in locales
    assert "pt-PT" in locales
    assert "de-DE" in locales


def test_unknown_locale_falls_back_to_english():
    assert i18n.t("common.save", "klingon") == "Save"


# ── 3. Interpolation ────────────────────────────────────────────────────


def test_interpolation_in_temp_catalog(monkeypatch, tmp_path):
    en = {"greeting": {"hello": "Hello, {name}! You have {n} messages."}}
    pt = {"greeting": {"hello": "Olá, {name}! Tens {n} mensagens."}}
    (tmp_path / "en.json").write_text(json.dumps(en), encoding="utf-8")
    (tmp_path / "pt-PT.json").write_text(json.dumps(pt), encoding="utf-8")
    monkeypatch.setattr(i18n, "LOCALES_DIR", tmp_path)
    i18n.reload_catalogs()

    assert (
        i18n.t("greeting.hello", "en", name="Paulo", n=3)
        == "Hello, Paulo! You have 3 messages."
    )
    assert (
        i18n.t("greeting.hello", "pt-PT", name="Paulo", n=3)
        == "Olá, Paulo! Tens 3 mensagens."
    )


def test_interpolation_missing_param_returns_template(monkeypatch, tmp_path, caplog):
    en = {"greeting": {"hello": "Hello, {name}!"}}
    (tmp_path / "en.json").write_text(json.dumps(en), encoding="utf-8")
    (tmp_path / "pt-PT.json").write_text(json.dumps(en), encoding="utf-8")
    monkeypatch.setattr(i18n, "LOCALES_DIR", tmp_path)
    i18n.reload_catalogs()

    with caplog.at_level("WARNING", logger="backend.services.i18n"):
        result = i18n.t("greeting.hello", "en")  # no name passed
    assert result == "Hello, {name}!"
    assert any("format failed" in rec.message for rec in caplog.records)


# ── 4. Real catalog parity (sanity) ─────────────────────────────────────


def test_real_catalogs_have_required_namespaces():
    """en.json and pt-PT.json both ship the seed namespaces from PR 1."""
    for locale in ("en", "pt-PT"):
        assert i18n.has_key("common.save", locale), f"{locale} missing common.save"
        assert i18n.has_key("common.cancel", locale)
        assert i18n.has_key("errors.generic", locale)


def test_real_pt_catalog_is_actually_portuguese():
    """Quick sanity check that we did not accidentally copy English."""
    assert i18n.t("common.save", "pt-PT") != "Save"
    assert i18n.t("common.cancel", "pt-PT") != "Cancel"


def test_catalogs_dir_is_repo_locales():
    """Make sure we ship the catalogs in the documented location."""
    expected = Path(i18n.__file__).resolve().parents[2] / "backend" / "locales"
    assert i18n.LOCALES_DIR == expected
    assert (expected / "en.json").exists()
    assert (expected / "pt-PT.json").exists()


# ── 5. Calendar validation errors (pass 2) ─────────────────────────────


@pytest.mark.parametrize(
    "key, en_fragment, pt_fragment",
    [
        ("calendar.errors.title_start_required", "Title and start date", "obrigat"),
        ("calendar.errors.invalid_start_date", "Invalid start date", "inválido"),
        ("calendar.errors.invalid_end_date", "Invalid end date", "inválido"),
        ("calendar.errors.end_before_start_date", "before start date", "anterior"),
        ("calendar.errors.invalid_start_time_format", "start time", "início"),
        ("calendar.errors.invalid_end_time_format", "end time", "fim"),
        ("calendar.errors.end_before_start_time", "before start time", "anterior"),
        ("calendar.errors.group_not_found", "Group not found", "encontrado"),
        ("calendar.errors.forbidden", "Forbidden", "negado"),
        ("calendar.errors.cannot_access_event", "cannot access", "aceder"),
        ("calendar.errors.event_not_found", "Event not found", "encontrado"),
        ("calendar.errors.group_community_mismatch", "does not belong", "pertence"),
        ("calendar.errors.community_id_required", "Community is required", "obrigat"),
        ("calendar.errors.edit_forbidden", "edit this event", "editar"),
        ("calendar.errors.delete_forbidden", "delete this event", "apagar"),
        ("calendar.errors.invalid_rsvp_response", "Invalid response", "inválida"),
        ("calendar.errors.not_invited", "not invited", "convidado"),
        ("calendar.errors.no_rsvp", "No RSVP", "RSVP"),
    ],
)
def test_calendar_error_keys_localized(key, en_fragment, pt_fragment):
    en_msg = i18n.t(key, "en")
    pt_msg = i18n.t(key, "pt-PT")
    assert en_fragment.lower() in en_msg.lower(), f"{key} EN: {en_msg}"
    assert pt_fragment.lower() in pt_msg.lower(), f"{key} pt-PT: {pt_msg}"
    assert pt_msg != en_msg


@pytest.mark.parametrize(
    "key, en_fragment, pt_fragment, params",
    [
        ("feed.reply_deleted", "Reply deleted", "apagada", None),
        ("feed.user_blocked", "blocked", "bloqueado", {"username": "alice"}),
        ("feed.user_already_blocked", "already blocked", "já bloqueado", None),
        ("feed.user_unblocked", "unblocked", "desbloqueado", {"username": "alice"}),
        ("communities.updated", "Community updated", "atualizada", None),
        ("auth.email.required", "Email required", "obrigat", None),
        ("auth.email.already_in_use", "already in use", "usado", None),
    ],
)
def test_monolith_wave2_keys_localized(key, en_fragment, pt_fragment, params):
    kwargs = params or {}
    en_msg = i18n.t(key, "en", **kwargs)
    pt_msg = i18n.t(key, "pt-PT", **kwargs)
    assert en_fragment.lower() in en_msg.lower(), f"{key} EN: {en_msg}"
    assert pt_fragment.lower() in pt_msg.lower(), f"{key} pt-PT: {pt_msg}"
    assert pt_msg != en_msg
