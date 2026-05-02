"""Unit tests for backend.services.http_headers.

Account-isolation guarantee depends on every authenticated `/api/*` response
carrying ``Cache-Control: no-store``. This suite is the first line of defense:
if any future PR breaks the policy, these tests fail before deploy.

Tests are pure (no DB, no Flask app construction beyond a minimal harness),
so they run in milliseconds and are safe to gate every commit on.
"""

from __future__ import annotations

import pytest
from flask import Flask

from backend.services.http_headers import (
    _AUTHENTICATED_PREFIXES,
    _PUBLIC_API_ALLOWLIST,
    _is_authenticated_path,
    apply_api_cache_policy,
    apply_cors_headers,
    apply_static_cache_headers,
    init_app,
    log_onboarding_redirects,
)


# ── _is_authenticated_path ───────────────────────────────────────────────


@pytest.mark.parametrize(
    "path",
    [
        "/api/me/entitlements",
        "/api/me/billing",
        "/api/me/billing/portal",
        "/api/me/ai-usage",
        "/api/me/enterprise-seats",
        "/api/me/iap-nag",
        "/api/me/winback",
        "/api/me/steve/reminders",
        "/api/chat_threads",
        "/api/group_chat/list",
        "/api/group_chat/42/messages",
        "/api/notifications",
        "/api/notifications/check",
        "/api/notifications/badge-count",
        "/api/profile_me",
        "/api/profile/someone",
        "/api/check_admin",
        "/api/admin/users",
        "/api/admin/dashboard",
        "/api/admin/subscriptions/users",
        "/api/admin/enterprise/seats",
        "/api/communities/123/billing",
        "/api/stripe/checkout_status",
        "/api/onboarding/state",
        "/api/community/manageable",
        "/api/community/invites/pending",
        "/api/followers",
        "/api/followers_feed",
        "/api/dashboard_unread_feed",
        "/api/user_communities_hierarchical",
        "/api/premium_dashboard_summary",
        "/get_messages",
        "/get_user_communities_with_members",
        "/get_calendar_events",
        "/get_community_members",
        "/check_unread_messages",
        "/check_profile_picture",
        "/update_email",
        "/update_password",
        "/update_public_profile",
        "/delete_account",
        "/delete_chat",
        "/upload_logo",
        "/upload_signup_image",
        "/admin/regenerate_app_icons",
        "/admin",
        "/admin_dashboard",
        "/admin_profile_react",
        "/profile/joao",
        "/notifications",
        "/event/12/rsvp",
        "/account_settings",
        "/edit_profile",
        "/business_login",
        "/business_logout",
        "/remove_community_member",
        "/resend_verification",
        "/clear_onboarding_storage",
        "/verify_required",
        "/logout",
        "/login",
        "/signup",
    ],
)
def test_authenticated_paths_are_no_store(path: str) -> None:
    """Every user-scoped route must be flagged for no-store."""
    assert _is_authenticated_path(path) is True


@pytest.mark.parametrize(
    "path",
    sorted(_PUBLIC_API_ALLOWLIST),
)
def test_public_allowlist_is_not_no_store(path: str) -> None:
    """Allowlisted public endpoints must NOT trigger no-store."""
    assert _is_authenticated_path(path) is False


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/welcome",
        "/static/logo.png",
        "/static/icons/icon-192.png",
        "/uploads/abc.mp4",
        "/manifest.webmanifest",
        "/sw.js",
        "/assets/index-abc.js",
        "/favicon.svg",
    ],
)
def test_static_and_root_paths_are_not_no_store(path: str) -> None:
    """Static/root paths bypass the no-store policy and keep their existing cache headers."""
    assert _is_authenticated_path(path) is False


def test_authenticated_prefixes_are_unique_and_lowercase() -> None:
    """Guard against accidental duplicates or casing drift in the prefix list."""
    seen = set()
    for prefix in _AUTHENTICATED_PREFIXES:
        assert prefix == prefix.lower(), prefix
        assert prefix not in seen, prefix
        seen.add(prefix)


# ── apply_api_cache_policy via Flask test app ────────────────────────────


@pytest.fixture()
def policy_app() -> Flask:
    """Minimal Flask app with only the http_headers hooks installed."""
    app = Flask(__name__)
    app.config["TESTING"] = True
    init_app(app)

    @app.route("/api/me/entitlements")
    def fake_me_entitlements():
        return {"plan": "premium"}

    @app.route("/api/chat_threads")
    def fake_chat_threads():
        return {"threads": []}

    @app.route("/api/admin/users")
    def fake_admin_users():
        return {"users": []}

    @app.route("/api/stripe/config")
    def fake_stripe_config():
        return {"publishable_key": "pk_test"}

    @app.route("/api/kb/pricing")
    def fake_kb_pricing():
        return {"tiers": []}

    @app.route("/static/logo.png")
    def fake_logo():
        return ("\x89PNG", 200, {"Content-Type": "image/png"})

    @app.route("/welcome")
    def fake_welcome():
        return ("<html></html>", 200, {"Content-Type": "text/html"})

    return app


def _cache_control(resp) -> str:
    return (resp.headers.get("Cache-Control") or "").lower()


def test_authenticated_endpoint_gets_no_store(policy_app: Flask) -> None:
    client = policy_app.test_client()
    for path in ("/api/me/entitlements", "/api/chat_threads", "/api/admin/users"):
        resp = client.get(path)
        cc = _cache_control(resp)
        assert "no-store" in cc, f"{path} missing no-store: {cc!r}"
        assert resp.headers.get("Pragma") == "no-cache"
        assert resp.headers.get("Expires") == "0"


def test_public_allowlist_endpoint_does_not_get_no_store(policy_app: Flask) -> None:
    client = policy_app.test_client()
    for path in ("/api/stripe/config", "/api/kb/pricing"):
        resp = client.get(path)
        cc = _cache_control(resp)
        assert "no-store" not in cc, f"{path} unexpectedly got no-store: {cc!r}"


def test_static_image_keeps_long_cache_headers(policy_app: Flask) -> None:
    client = policy_app.test_client()
    resp = client.get("/static/logo.png")
    cc = _cache_control(resp)
    assert "no-store" not in cc
    assert "max-age=604800" in cc
    assert "immutable" in cc


def test_html_response_is_not_marked_no_store(policy_app: Flask) -> None:
    """HTML pages get ``Cache-Control: no-cache`` (revalidate), not no-store."""
    client = policy_app.test_client()
    resp = client.get("/welcome")
    cc = _cache_control(resp)
    assert "no-store" not in cc
    assert "no-cache" in cc


def test_security_headers_present_on_static(policy_app: Flask) -> None:
    client = policy_app.test_client()
    resp = client.get("/static/logo.png")
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.headers.get("X-Frame-Options") == "SAMEORIGIN"


# ── apply_cors_headers ───────────────────────────────────────────────────


def test_cors_allows_admin_subdomain(policy_app: Flask) -> None:
    client = policy_app.test_client()
    resp = client.get(
        "/api/me/entitlements",
        headers={"Origin": "https://admin.c-point.co"},
    )
    assert resp.headers.get("Access-Control-Allow-Origin") == "https://admin.c-point.co"
    assert resp.headers.get("Access-Control-Allow-Credentials") == "true"


def test_cors_allows_run_app_origin(policy_app: Flask) -> None:
    """Cloud Run admin URLs rotate; any *.run.app origin is permitted."""
    client = policy_app.test_client()
    origin = "https://cpoint-admin-staging-abc.europe-west1.run.app"
    resp = client.get("/api/me/entitlements", headers={"Origin": origin})
    assert resp.headers.get("Access-Control-Allow-Origin") == origin


def test_cors_rejects_unknown_origin(policy_app: Flask) -> None:
    client = policy_app.test_client()
    resp = client.get(
        "/api/me/entitlements",
        headers={"Origin": "https://evil.example.com"},
    )
    assert resp.headers.get("Access-Control-Allow-Origin") is None


# ── log_onboarding_redirects ─────────────────────────────────────────────


def test_log_onboarding_redirects_returns_response_unchanged() -> None:
    """The hook is observability-only — it must never break the response chain."""

    class _Resp:
        status_code = 302
        headers: dict[str, str] = {"Location": "/onboarding"}

    app = Flask(__name__)
    with app.test_request_context("/some/path"):
        out = log_onboarding_redirects(_Resp())
    assert out is not None  # smoke: didn't raise


# ── apply_static_cache_headers (direct call) ─────────────────────────────


def test_static_cache_headers_skips_html() -> None:
    """HTML must not pick up ``immutable``/``max-age=...`` from the static branch."""

    class _Resp:
        headers: dict[str, str] = {"Content-Type": "text/html"}

    app = Flask(__name__)
    with app.test_request_context("/welcome"):
        result = apply_static_cache_headers(_Resp())
    assert result.headers.get("Cache-Control") == "no-cache"


def test_apply_api_cache_policy_idempotent() -> None:
    """Calling the policy twice must produce the same headers."""

    class _Resp:
        headers: dict[str, str] = {}

    app = Flask(__name__)
    with app.test_request_context("/api/chat_threads"):
        first = apply_api_cache_policy(_Resp())
        first_headers = dict(first.headers)
        second = apply_api_cache_policy(first)
    assert dict(second.headers) == first_headers
