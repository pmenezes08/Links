"""Tests for :mod:`backend.services.api_errors` and the auth migration.

Pure tests (no DB, no Flask container start). They cover the contract
that every blueprint relies on:

* The JSON shape includes the legacy ``error`` field plus the new
  stable identifiers (``error_code`` / ``message_key`` / ``message``).
* Locale resolution honours an explicit override, the request chain,
  and the documented fallback to ``en``.
* The auth helpers (``auth_required``, ``forbidden``, ``not_found``)
  return the right HTTP status.

Maps to KB Tests-page row ``i18n:api_errors_contract`` (added in the
backend gate PR).
"""

from __future__ import annotations

import json

import pytest
from flask import Flask

from backend.services import api_errors, i18n


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _reset_catalogs():
    """Drop the cached catalogs so each test reads the real on-disk JSON.

    ``test_error_payload_with_params`` (and any future tests) monkeypatch
    ``i18n.LOCALES_DIR`` to a temp dir. Pytest undoes the monkeypatch on
    teardown, but the in-memory cache built during that test would still
    point at the temp data. Reloading on every test boundary avoids
    cross-test bleed without coupling test_api_errors.py to test_i18n.py.
    """
    i18n.reload_catalogs()
    yield
    i18n.reload_catalogs()


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "test-secret"
    return app


# ── 1. Payload shape ────────────────────────────────────────────────────


def test_error_payload_has_legacy_and_new_fields():
    """Backward-compatible: keep ``error`` while exposing ``message_key``."""
    payload = api_errors.error_payload("auth.authentication_required", locale="en")
    assert payload["success"] is False
    assert payload["error"] == "Authentication required"
    assert payload["error_code"] == "auth.authentication_required"
    assert payload["message_key"] == "auth.authentication_required"
    assert payload["message"] == "Authentication required"
    assert payload["message_params"] == {}


def test_error_payload_pt_pt_translates():
    payload = api_errors.error_payload("auth.authentication_required", locale="pt-PT")
    # Specific Portuguese text is locked by the catalog; we just check
    # the catalogs are wired in and pt-PT differs from en.
    assert payload["error"] != "Authentication required"
    assert payload["message_key"] == "auth.authentication_required"
    assert payload["error_code"] == "auth.authentication_required"


def test_error_payload_with_params(monkeypatch, tmp_path):
    en = {"greeting": {"hello": "Hello, {name}!"}}
    pt = {"greeting": {"hello": "Olá, {name}!"}}
    (tmp_path / "en.json").write_text(json.dumps(en), encoding="utf-8")
    (tmp_path / "pt-PT.json").write_text(json.dumps(pt), encoding="utf-8")
    monkeypatch.setattr(i18n, "LOCALES_DIR", tmp_path)
    i18n.reload_catalogs()

    payload = api_errors.error_payload(
        "greeting.hello", locale="pt-PT", params={"name": "Paulo"}
    )
    assert payload["message"] == "Olá, Paulo!"
    assert payload["message_params"] == {"name": "Paulo"}


def test_error_payload_extra_fields_passthrough():
    payload = api_errors.error_payload(
        "auth.authentication_required",
        locale="en",
        extra={"available_locales": ["en", "pt-PT"]},
    )
    assert payload["available_locales"] == ["en", "pt-PT"]


# ── 2. HTTP wrapper ─────────────────────────────────────────────────────


def test_error_response_returns_jsonify_tuple(app):
    with app.test_request_context("/"):
        resp, status = api_errors.error_response(
            "auth.authentication_required", 401, locale="en"
        )
    assert status == 401
    body = json.loads(resp.get_data(as_text=True))
    assert body["error_code"] == "auth.authentication_required"
    assert body["success"] is False


def test_auth_required_is_401(app):
    with app.test_request_context("/"):
        resp, status = api_errors.auth_required(locale="en")
    assert status == 401
    body = json.loads(resp.get_data(as_text=True))
    assert body["error_code"] == "auth.authentication_required"


def test_forbidden_is_403(app):
    with app.test_request_context("/"):
        resp, status = api_errors.forbidden(locale="en")
    assert status == 403
    body = json.loads(resp.get_data(as_text=True))
    assert body["error_code"] == "errors.forbidden"


def test_not_found_is_404(app):
    with app.test_request_context("/"):
        resp, status = api_errors.not_found(locale="en")
    assert status == 404
    body = json.loads(resp.get_data(as_text=True))
    assert body["error_code"] == "errors.not_found"


# ── 3. Locale resolution from request headers ───────────────────────────


def test_response_honours_accept_language(app):
    with app.test_request_context("/", headers={"Accept-Language": "pt-PT"}):
        resp, _status = api_errors.auth_required()
    body = json.loads(resp.get_data(as_text=True))
    # Whatever the pt-PT text is, it is not the English one.
    assert body["message"] != "Authentication required"
    assert body["error_code"] == "auth.authentication_required"


def test_response_honours_x_cpoint_locale(app):
    with app.test_request_context(
        "/", headers={"X-CPoint-Locale": "pt-PT", "Accept-Language": "en"}
    ):
        resp, _ = api_errors.auth_required()
    body = json.loads(resp.get_data(as_text=True))
    assert body["error_code"] == "auth.authentication_required"
    assert body["message"] != "Authentication required"


def test_explicit_locale_argument_wins(app):
    with app.test_request_context("/", headers={"Accept-Language": "pt-PT"}):
        resp, _ = api_errors.auth_required(locale="en")
    body = json.loads(resp.get_data(as_text=True))
    assert body["message"] == "Authentication required"


def test_unknown_explicit_locale_falls_through_to_headers(app):
    with app.test_request_context("/", headers={"Accept-Language": "pt-PT"}):
        resp, _ = api_errors.auth_required(locale="klingon")
    body = json.loads(resp.get_data(as_text=True))
    # klingon was not recognised, so the request chain (pt-PT) won.
    assert body["message"] != "Authentication required"


# ── 4. Auth blueprint integration (no DB) ───────────────────────────────


def test_session_required_api_uses_localized_payload():
    """The decorator wired in backend/blueprints/auth.py must use api_errors."""
    from backend.blueprints.auth import _session_required_api

    app = Flask(__name__)
    app.secret_key = "t"

    @_session_required_api
    def protected():
        return {"success": True}, 200

    app.add_url_rule("/p", view_func=protected, methods=["GET"])

    with app.test_client() as client:
        r = client.get("/p", headers={"Accept-Language": "pt-PT"})
    assert r.status_code == 401
    body = r.get_json()
    assert body["error_code"] == "auth.authentication_required"
    assert body["message_key"] == "auth.authentication_required"
    assert body["success"] is False
