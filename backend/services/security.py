"""Security helpers shared by request gates."""

from __future__ import annotations

import os
from urllib.parse import urlparse

from flask import current_app, jsonify


_BYPASS_EXACT_PATHS = {
    "/api/auth/google",
    "/api/webhooks/stripe",
    "/api/webhooks/apple",
    "/api/webhooks/google",
    "/api/content-generation/cron/process-due-jobs",
}


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _hostname(value: str | None) -> str:
    return (value or "").split(":", 1)[0].strip().lower()


def _allowed_hostnames(request) -> set[str]:
    hosts = {_hostname(request.host)}

    canonical = _hostname(os.getenv("CANONICAL_HOST"))
    if canonical:
        hosts.add(canonical)

    domain = (current_app.config.get("SESSION_COOKIE_DOMAIN") or os.getenv("SESSION_COOKIE_DOMAIN") or "")
    domain = domain.strip().lstrip(".").lower()
    if domain:
        hosts.add(domain)

    if any(host == "c-point.co" or host.endswith(".c-point.co") for host in hosts):
        hosts.add("c-point.co")

    hosts.update({"localhost", "127.0.0.1"})
    return {host for host in hosts if host}


def _normalize_origin_url(raw: str) -> str | None:
    """Return ``scheme://netloc`` (lowercase host) for comparison, or None."""
    part = (raw or "").strip().rstrip("/")
    if not part:
        return None
    if "://" not in part:
        part = f"https://{part}"
    parsed = urlparse(part)
    scheme = (parsed.scheme or "https").lower()
    if scheme not in {"http", "https"}:
        return None
    netloc = (parsed.netloc or "").strip().lower()
    if not netloc:
        # urlparse("https://") etc.
        host = _hostname(parsed.path)
        if not host:
            return None
        netloc = host
    return f"{scheme}://{netloc}"


def _configured_csrf_allowed_origins() -> set[str]:
    """Extra browser origins permitted for CSRF checks (comma-separated env).

    Used when admin-web is deployed on a different host than the API (e.g. two
    Cloud Run services). Set ``CSRF_ALLOWED_ORIGINS`` on the **app** service to
    the admin site's origin(s), e.g. ``https://cpoint-admin-staging-....run.app``.
    """
    raw = os.getenv("CSRF_ALLOWED_ORIGINS") or ""
    out: set[str] = set()
    for item in raw.split(","):
        norm = _normalize_origin_url(item)
        if norm:
            out.add(norm)
    return out


def _is_allowed_origin(value: str | None, request) -> bool:
    if not value:
        return True

    parsed = urlparse(value)
    hostname = _hostname(parsed.netloc or parsed.path)
    if not hostname:
        return False

    scheme = (parsed.scheme or "").lower()
    if scheme == "capacitor" and hostname in {"localhost", "127.0.0.1"}:
        return True

    if hostname in {"localhost", "127.0.0.1"}:
        return True

    allowed = _allowed_hostnames(request)
    if hostname in allowed:
        return True

    if "c-point.co" in allowed and hostname.endswith(".c-point.co"):
        return True

    norm = _normalize_origin_url(value)
    if norm and norm in _configured_csrf_allowed_origins():
        return True

    return False


def _should_skip(request) -> bool:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return True
    path = request.path or ""
    if path.startswith("/api/cron/"):
        return True
    return path in _BYPASS_EXACT_PATHS


def _block_response(request):
    if (request.path or "").startswith("/api/"):
        return jsonify({"success": False, "error": "csrf_origin_forbidden"}), 403
    return "Forbidden", 403


def verify_origin_or_block(request):
    """Validate Origin/Referer for state-changing requests.

    ``CSRF_ORIGIN_ENFORCE=false`` keeps the service in shadow mode: log the
    violation but allow the request through. The env var is read per request
    so rollout and rollback do not require a redeploy.

    When admin-web is hosted on a different origin than the API (e.g. two Cloud
    Run URLs), set ``CSRF_ALLOWED_ORIGINS`` on the app to a comma-separated
    list of admin **origins** (``https://cpoint-admin-staging-....run.app``).
    """
    if _should_skip(request):
        return None

    origin = request.headers.get("Origin") or ""
    referer = request.headers.get("Referer") or ""
    if not origin and not referer:
        return None

    allowed = _is_allowed_origin(origin, request) if origin else _is_allowed_origin(referer, request)
    if allowed:
        return None

    current_app.logger.warning(
        "csrf_origin_violation path=%s origin=%s referer=%s host=%s",
        request.path,
        origin or "-",
        referer or "-",
        request.host,
    )

    if not _truthy(os.getenv("CSRF_ORIGIN_ENFORCE", "false")):
        return None

    return _block_response(request)


__all__ = ["verify_origin_or_block"]
