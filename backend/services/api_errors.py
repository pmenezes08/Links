"""Shared JSON error contract for blueprints.

Every blueprint that returns a user-facing error should use
:func:`error_response` so we have a single, locale-aware payload shape:

.. code-block:: json

    {
        "success": false,
        "error": "Username already taken",
        "error_code": "auth.username_taken",
        "message_key": "auth.username_taken",
        "message": "Username already taken",
        "message_params": {}
    }

* ``error`` — backward-compatible human-readable string. Existing
  clients display this directly.
* ``error_code`` / ``message_key`` — stable identifier the new clients
  switch on (no English-text matching in tests or UI).
* ``message`` — localized text. Equal to ``error`` for older blueprints
  that surfaced English only; a clean rename target later.
* ``message_params`` — parameters that were interpolated; surfaced so
  the client can re-format if it wants.

Locale is resolved via :func:`backend.services.user_locale.resolve_request_locale`
when a Flask request context is available, else falls back to the
``locale`` argument or :data:`backend.services.i18n.DEFAULT_LOCALE`.

See :doc:`docs/I18N_ROADMAP.md` for the rollout plan.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Tuple

from flask import jsonify

from backend.services import i18n, session_identity, user_locale

logger = logging.getLogger(__name__)


def _resolve_locale_for_request(explicit: Optional[str]) -> str:
    """Pick the locale to use for *this* error response."""
    if explicit:
        matched = i18n.match_locale(explicit)
        if matched is not None:
            return matched

    # When called inside a Flask request, honour the standard chain.
    try:
        from flask import request, session  # local import — keeps tests fast
    except Exception:
        return i18n.DEFAULT_LOCALE

    username: Optional[str] = None
    try:
        username = session_identity.valid_session_username(session)  # type: ignore[arg-type]
    except Exception:
        username = None

    try:
        return user_locale.resolve_request_locale(request, username)
    except Exception:
        logger.debug(
            "api_errors: resolve_request_locale failed; falling back to %s",
            i18n.DEFAULT_LOCALE,
        )
        return i18n.DEFAULT_LOCALE


def error_payload(
    key: str,
    *,
    locale: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return the dict shape, without wrapping it in :func:`jsonify`.

    Useful when callers want to add their own keys before responding.
    """
    resolved = _resolve_locale_for_request(locale)
    params = params or {}
    message = i18n.t(key, resolved, **params)
    payload: Dict[str, Any] = {
        "success": False,
        "error": message,
        "error_code": key,
        "message_key": key,
        "message": message,
        "message_params": params,
    }
    if extra:
        payload.update(extra)
    return payload


def error_response(
    key: str,
    status: int = 400,
    *,
    locale: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Tuple[Any, int]:
    """Return a ``(jsonify(...), status)`` tuple ready to ``return`` from a view."""
    payload = error_payload(key, locale=locale, params=params, extra=extra)
    return jsonify(payload), status


def success_payload(
    key: str,
    *,
    locale: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Return a locale-aware success dict (``success=True`` + ``message_key``)."""
    resolved = _resolve_locale_for_request(locale)
    params = params or {}
    message = i18n.t(key, resolved, **params)
    payload: Dict[str, Any] = {
        "success": True,
        "message_key": key,
        "message": message,
        "message_params": params,
    }
    if extra:
        payload.update(extra)
    return payload


def success_response(
    key: str,
    status: int = 200,
    *,
    locale: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Tuple[Any, int]:
    """Return a ``(jsonify(...), status)`` tuple for a localized success message."""
    payload = success_payload(key, locale=locale, params=params, extra=extra)
    return jsonify(payload), status


# ── Convenience helpers ────────────────────────────────────────────────


def auth_required(locale: Optional[str] = None) -> Tuple[Any, int]:
    """Standard 401 for routes that need a logged-in session."""
    return error_response("auth.authentication_required", 401, locale=locale)


def forbidden(
    key: str = "errors.forbidden",
    *,
    locale: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
) -> Tuple[Any, int]:
    return error_response(key, 403, locale=locale, params=params)


def not_found(
    key: str = "errors.not_found",
    *,
    locale: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None,
) -> Tuple[Any, int]:
    return error_response(key, 404, locale=locale, params=params)
