"""Locale helpers for server-rendered HTML templates."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from flask import request, session

from backend.services import i18n, session_identity, user_locale


def resolve_template_locale(username: Optional[str] = None) -> str:
    uname = username
    if uname is None:
        try:
            uname = session_identity.valid_session_username(session)
        except Exception:
            uname = None
    try:
        return user_locale.resolve_request_locale(request, uname)
    except Exception:
        return i18n.DEFAULT_LOCALE


def template_ctx(username: Optional[str] = None) -> Dict[str, Any]:
    """Context dict for ``render_template(..., **template_ctx())``."""
    locale = resolve_template_locale(username)

    def tt(key: str, **params: Any) -> str:
        return i18n.t(f"templates.{key}", locale, **params)

    return {"locale": locale, "tt": tt}


_RESET_MSG_KEYS = {
    "Please fill in all fields.": "reset_password.fill_all",
    "Passwords do not match.": "reset_password.alert_mismatch",
    "Password must be at least 6 characters long.": "reset_password.alert_too_short",
    "Invalid or expired reset link.": "reset_password.invalid_link",
    "Your password has been reset successfully.": "reset_password.success",
    "An error occurred. Please try again.": "error_page.default_message",
}

_VERIFICATION_MSG_KEYS = {
    "Invalid verification link": "verification.invalid_link",
    "Pending registration not found or expired": "verification.pending_not_found",
    "Verification link mismatch": "verification.link_mismatch",
    "Your email has been verified successfully.": "verification.verified_success",
    "Server error while finalizing registration": "verification.finalize_error",
    "Verification link is invalid or expired": "verification.expired_link",
    "Server error while verifying email": "verification.verify_error",
    "We sent a verification link to your email. Please verify to complete sign up.": "verification.signup_pending",
}


def localize_reset_message(message: str, locale: str) -> str:
    key = _RESET_MSG_KEYS.get(message)
    if key:
        return i18n.t(f"templates.{key}", locale)
    return message


def localize_verification_message(message: str, locale: str) -> str:
    key = _VERIFICATION_MSG_KEYS.get(message)
    if key:
        return i18n.t(f"templates.{key}", locale)
    return message
