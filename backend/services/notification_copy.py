"""Localized push and in-app notification copy.

Every async notification (push + in-app row) MUST resolve text in the
**recipient's** locale, never the sender's. This helper centralises
that lookup so callers don't accidentally use the wrong session.

Public API
----------

``recipient_locale(username)``
    Look up the recipient's saved ``preferred_locale`` and return a
    supported locale; ``en`` when unset or unknown.

``push_payload(event, locale, **params)``
    Return a ``{"title": ..., "body": ...}`` dict for the given event
    type. Falls back to English when a key is missing.

``in_app_text(event, locale, **params)``
    Single-string version used by ``create_notification(message=...)``.

Events are namespaced under ``notifications.<event>`` in the JSON
catalogs. Keep new events small and parameterised; do not embed
raw user content in the template.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from backend.services import i18n, user_locale

logger = logging.getLogger(__name__)


def recipient_locale(username: str) -> str:
    """Return the recipient's saved locale, or :data:`i18n.DEFAULT_LOCALE`."""
    if not username:
        return i18n.DEFAULT_LOCALE
    try:
        saved = user_locale.get_preferred_locale(username)
    except Exception:
        logger.debug("recipient_locale lookup failed for %s", username, exc_info=True)
        saved = None
    return saved or i18n.DEFAULT_LOCALE


def push_payload(event: str, locale: str, **params: Any) -> Dict[str, str]:
    """Build a ``{title, body}`` push payload for ``event``.

    Looks up ``notifications.<event>.title`` and
    ``notifications.<event>.body`` in the catalog. Missing keys fall
    back through the chain to ``en`` and finally return the key text
    (visible only in development, never in production with seeded
    catalogs).
    """
    return {
        "title": i18n.t(f"notifications.{event}.title", locale, **params),
        "body": i18n.t(f"notifications.{event}.body", locale, **params),
    }


def in_app_text(event: str, locale: str, **params: Any) -> str:
    """Return the single-string in-app message for ``event``."""
    return i18n.t(f"notifications.{event}.message", locale, **params)
