from __future__ import annotations

import logging

from flask import Flask, request

from backend.services import security


def _app() -> Flask:
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.config["SESSION_COOKIE_DOMAIN"] = ".c-point.co"
    return app


def _check(path="/api/example", method="POST", headers=None, base_url="https://app.c-point.co"):
    app = _app()
    with app.test_request_context(path, method=method, headers=headers or {}, base_url=base_url):
        return security.verify_origin_or_block(request)


def test_get_request_passes(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    assert _check(method="GET", headers={"Origin": "https://evil.example"}) is None


def test_options_preflight_passes(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    assert _check(method="OPTIONS", headers={"Origin": "https://evil.example"}) is None


def test_same_origin_post_passes(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    assert _check(headers={"Origin": "https://app.c-point.co"}) is None


def test_cross_origin_post_blocked_json(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    result = _check(headers={"Origin": "https://evil.example"})
    response, status = result
    assert status == 403
    assert response.get_json()["error"] == "csrf_origin_forbidden"


def test_cross_origin_post_blocked_plain(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    body, status = _check(path="/settings", headers={"Origin": "https://evil.example"})
    assert status == 403
    assert body == "Forbidden"


def test_capacitor_and_localhost_origins_pass(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    assert _check(headers={"Origin": "capacitor://localhost"}) is None
    assert _check(headers={"Origin": "https://localhost"}) is None
    assert _check(headers={"Origin": "http://localhost:5173"}) is None


def test_localhost_referer_passes(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    assert _check(headers={"Referer": "http://localhost:5173/login"}) is None


def test_admin_web_subdomain_passes(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    assert _check(headers={"Origin": "https://admin.c-point.co"}) is None


def test_csrf_allowed_origins_env_passes(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    monkeypatch.setenv(
        "CSRF_ALLOWED_ORIGINS",
        "https://cpoint-admin-staging-739552904126.europe-west1.run.app , https://other-admin.example",
    )
    assert (
        _check(
            headers={"Origin": "https://cpoint-admin-staging-739552904126.europe-west1.run.app"},
        )
        is None
    )
    assert _check(headers={"Origin": "https://other-admin.example"}) is None


def test_csrf_allowed_origins_referer_passes(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    monkeypatch.setenv("CSRF_ALLOWED_ORIGINS", "https://cpoint-admin-staging-739552904126.europe-west1.run.app")
    assert (
        _check(
            headers={"Referer": "https://cpoint-admin-staging-739552904126.europe-west1.run.app/login"},
        )
        is None
    )


def test_webhook_and_cron_paths_bypass(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    assert _check(path="/api/webhooks/stripe", headers={"Origin": "https://evil.example"}) is None
    assert _check(path="/api/webhooks/apple", headers={"Origin": "https://evil.example"}) is None
    assert _check(path="/api/webhooks/google", headers={"Origin": "https://evil.example"}) is None
    assert _check(path="/api/cron/events/reminders", headers={"Origin": "https://evil.example"}) is None


def test_no_origin_no_referer_passes(monkeypatch):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "true")
    assert _check() is None


def test_shadow_mode_logs_but_passes(monkeypatch, caplog):
    monkeypatch.setenv("CSRF_ORIGIN_ENFORCE", "false")
    caplog.set_level(logging.WARNING)
    assert _check(headers={"Origin": "https://evil.example"}) is None
    assert "csrf_origin_violation" in caplog.text
