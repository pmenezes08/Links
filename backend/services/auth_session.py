"""Helpers for clearing auth-related browser state consistently."""

from __future__ import annotations

from flask import current_app


INSTALL_COOKIE_NAME = "native_push_install_id"


def _session_cookie_attrs() -> dict:
    return {
        "secure": bool(current_app.config.get("SESSION_COOKIE_SECURE", False)),
        "httponly": bool(current_app.config.get("SESSION_COOKIE_HTTPONLY", True)),
        "samesite": current_app.config.get("SESSION_COOKIE_SAMESITE", "Lax"),
        "domain": current_app.config.get("SESSION_COOKIE_DOMAIN") or None,
        "path": current_app.config.get("SESSION_COOKIE_PATH", "/"),
    }


def clear_session_cookie(response) -> None:
    """Expire Flask's configured session cookie using matching attributes."""
    name = current_app.config.get("SESSION_COOKIE_NAME", "session")
    response.set_cookie(name, "", max_age=0, expires=0, **_session_cookie_attrs())


def _install_cookie_attrs() -> dict:
    return {
        "secure": bool(current_app.config.get("SESSION_COOKIE_SECURE", False)),
        "httponly": False,
        "samesite": current_app.config.get("SESSION_COOKIE_SAMESITE", "Lax"),
        "domain": current_app.config.get("SESSION_COOKIE_DOMAIN") or None,
        "path": "/",
    }


def clear_install_cookie(response) -> None:
    """Expire the native push install cookie."""
    response.set_cookie(INSTALL_COOKIE_NAME, "", max_age=0, expires=0, **_install_cookie_attrs())


def set_install_cookie(response, install_id: str, max_age: int = 365 * 24 * 60 * 60) -> None:
    """Write a native push install id cookie with the app's auth cookie policy."""
    response.set_cookie(INSTALL_COOKIE_NAME, install_id, max_age=max_age, **_install_cookie_attrs())


def no_store(response):
    """Prevent auth transition responses from being cached by browsers."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


def clear_site_data(response):
    """Tell compliant browsers to wipe storage for this origin.

    Set on `/logout` (and on permanent account deletion) so Chrome, Edge, and
    Firefox flush Cache Storage, IndexedDB, localStorage, sessionStorage,
    cookies, and SW registrations in one shot. Safari ignores the header
    today, so the client-side scrub in `client/src/utils/logout.ts` remains
    the primary mechanism for that browser; this header is a strong second
    line of defense for the rest.
    """
    response.headers["Clear-Site-Data"] = '"cache", "cookies", "storage"'
    return response


__all__ = [
    "INSTALL_COOKIE_NAME",
    "clear_install_cookie",
    "clear_session_cookie",
    "clear_site_data",
    "no_store",
    "set_install_cookie",
]
