"""HTTP response header policies (CORS, cache-control, security).

Centralises every ``@after_request`` hook so [bodybuilding_app.py][1] does not
have to grow each time we add another response-shaping rule. Hooks are
registered through :func:`init_app`, called once at app construction.

The cache-control policy is the security-critical part: any authenticated
``/api/*`` (and other dynamic-prefix) JSON response gets ``Cache-Control:
no-store`` so neither the browser HTTP cache, the service worker, nor any
intermediary proxy can stash a previous user's response and replay it under
another session. A small, explicit allowlist exists for genuinely public JSON
endpoints (Stripe publishable key, pricing tables, geo dropdowns, etc.).

[1]: ../../bodybuilding_app.py
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Iterable

from flask import Flask, request

logger = logging.getLogger(__name__)


# ── Cache-control policy ──────────────────────────────────────────────────

_AUTHENTICATED_PREFIXES: tuple[str, ...] = (
    "/api/",
    "/get_",
    "/check_",
    "/update_",
    "/delete_",
    "/add_",
    "/upload_",
    "/admin",  # matches /admin, /admin_*, /admin/...
    "/profile/",
    "/notifications",
    "/event/",
    "/account_",
    "/edit_",
    "/business_",
    "/remove_",
    "/resend_",
    "/clear_",
    "/verify_",
    "/logout",
    "/login",  # matches /login, /login_password, /login_back
    "/signup",  # matches /signup, /signup_react
)
"""Path prefixes whose responses are user-scoped or otherwise must not be cached.

Anything matching one of these (and not in :data:`_PUBLIC_API_ALLOWLIST`) gets
``Cache-Control: no-store`` so a previous user's response cannot be served to
another session by browser HTTP cache, service worker, or proxy.
"""

_PUBLIC_API_ALLOWLIST: frozenset[str] = frozenset(
    {
        "/api/stripe/config",
        "/api/kb/pricing",
        "/api/push/public_key",
        "/api/about/tutorial_videos",
        "/api/geo/countries",
        "/api/geo/cities",
        "/api/geocode/reverse",
        "/api/giphy/search",
        "/api/config/giphy_key",
    }
)
"""Endpoints that genuinely return user-agnostic data and may be cached.

Even allowlisted endpoints are not cached by the service worker (the SW runs
default-deny on ``/api/*``); keeping them out of the no-store policy lets the
browser HTTP cache help cold pricing/geo loads.
"""


def _is_authenticated_path(path: str) -> bool:
    """Return ``True`` if ``path`` should never be cached cross-user."""
    if path in _PUBLIC_API_ALLOWLIST:
        return False
    return any(path.startswith(prefix) for prefix in _AUTHENTICATED_PREFIXES)


def apply_api_cache_policy(response):
    """Stamp ``no-store`` on user-scoped responses.

    Decision is path-first (so a static asset accidentally served with a JSON
    content type does not get marked no-store), then content-type as a
    secondary guard for blueprints that might add new prefixes we missed.
    """
    path = request.path or ""
    if _is_authenticated_path(path):
        response.headers["Cache-Control"] = (
            "private, no-store, no-cache, must-revalidate, max-age=0"
        )
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    if path in _PUBLIC_API_ALLOWLIST:
        return response

    content_type = response.headers.get("Content-Type", "")
    if "application/json" in content_type and path.startswith("/"):
        response.headers["Cache-Control"] = (
            "private, no-store, no-cache, must-revalidate, max-age=0"
        )
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


# ── CORS (admin subdomain) ────────────────────────────────────────────────

_ALLOWED_CORS_ORIGINS: tuple[str, ...] = (
    "https://admin.c-point.co",
    "https://cpoint-admin-739552904126.europe-west1.run.app",
)


def apply_cors_headers(response):
    """Mirror the legacy CORS behaviour for the admin subdomain.

    Allows cookies (``Access-Control-Allow-Credentials: true``) for the admin
    SPA at ``admin.c-point.co`` plus any Cloud Run admin host (staging URLs
    rotate). Same allowlist semantics as the original handler in the monolith,
    just split out so it can be tested in isolation.
    """
    origin = request.headers.get("Origin", "")
    allowed: list[str] = list(_ALLOWED_CORS_ORIGINS)
    if origin and (".run.app" in origin or "localhost" in origin):
        allowed.append(origin)
    if origin in allowed:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    return response


# ── Static-asset & security headers ───────────────────────────────────────

_IMAGE_EXTS: tuple[str, ...] = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico")
_CODE_EXTS: tuple[str, ...] = (".css", ".js")
_VIDEO_EXTS: tuple[str, ...] = (".mp4", ".webm", ".mov", ".m4v", ".avi")
_AUDIO_EXTS: tuple[str, ...] = (".mp3", ".m4a", ".wav", ".ogg", ".webm")


def _expires_in(days: int) -> str:
    return (datetime.now() + timedelta(days=days)).strftime("%a, %d %b %Y %H:%M:%S GMT")


def apply_static_cache_headers(response):
    """Long-lived caching for static assets, plus baseline security headers.

    Mirrors the legacy ``add_cache_headers`` in [bodybuilding_app.py][1] but
    delegates user-scoped no-store decisions to :func:`apply_api_cache_policy`,
    which runs first.

    [1]: ../../bodybuilding_app.py
    """
    content_type = response.headers.get("Content-Type", "")
    path = request.path or ""

    # HTML pages and the SW script must always be revalidated.
    if "text/html" in content_type or path.endswith("sw.js"):
        response.headers["Cache-Control"] = "no-cache"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        return response

    if path.startswith("/static/"):
        if any(path.endswith(ext) for ext in _IMAGE_EXTS):
            response.headers["Cache-Control"] = "public, max-age=604800, immutable"
            response.headers["Expires"] = _expires_in(7)
        elif any(path.endswith(ext) for ext in _CODE_EXTS):
            # Vite filename hashing makes immutable safe.
            response.headers["Cache-Control"] = "public, max-age=86400, immutable"
            response.headers["Expires"] = _expires_in(1)
        else:
            response.headers["Cache-Control"] = "public, max-age=3600"

    if path.startswith("/uploads/"):
        if any(path.endswith(ext) for ext in _VIDEO_EXTS):
            response.headers["Cache-Control"] = "public, max-age=2592000, immutable"
            response.headers["Expires"] = _expires_in(30)
        elif any(path.endswith(ext) for ext in _IMAGE_EXTS):
            response.headers["Cache-Control"] = "public, max-age=2592000, immutable"
            response.headers["Expires"] = _expires_in(30)
        elif any(path.endswith(ext) for ext in _AUDIO_EXTS):
            response.headers["Cache-Control"] = "public, max-age=2592000, immutable"
            response.headers["Expires"] = _expires_in(30)

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    return response


# ── Onboarding redirect logger ────────────────────────────────────────────


def log_onboarding_redirects(response):
    """Record any redirect that points at /onboarding for diagnostic purposes."""
    try:
        if response.status_code in (301, 302):
            location = response.headers.get("Location") or ""
            if "/onboarding" in location:
                logger.warning(
                    "HTTP redirect to /onboarding: path=%s, referer=%s, ua=%s",
                    request.path,
                    request.headers.get("Referer"),
                    request.headers.get("User-Agent"),
                )
    except Exception:  # pragma: no cover - logger should never break responses
        logger.exception("log_onboarding_redirects failed")
    return response


# ── Registration ──────────────────────────────────────────────────────────


def init_app(app: Flask) -> None:
    """Register every response-shaping hook in the documented order.

    Order matters: cache-policy hooks run before static handlers so that a JSON
    response from an authenticated route never gets a long-lived ``Cache-Control``
    by accident. CORS headers go last so they apply uniformly regardless of the
    other policies.
    """
    app.after_request(apply_api_cache_policy)
    app.after_request(apply_static_cache_headers)
    app.after_request(log_onboarding_redirects)
    app.after_request(apply_cors_headers)


__all__: Iterable[str] = (
    "apply_api_cache_policy",
    "apply_cors_headers",
    "apply_static_cache_headers",
    "init_app",
    "log_onboarding_redirects",
)
