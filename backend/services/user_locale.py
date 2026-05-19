"""Per-user locale storage and request resolution.

This module owns the **only** place that reads or writes the
``users.preferred_locale`` column. Blueprints call:

* :func:`get_preferred_locale` — look up an explicit user choice.
* :func:`set_preferred_locale` — persist a user's choice from
  Account Settings.
* :func:`resolve_request_locale` — return the locale to use for the
  current Flask request, honouring the documented chain:

    1. ``users.preferred_locale`` (explicit Account Settings choice)
    2. ``X-CPoint-Locale`` header (client's active locale)
    3. ``Accept-Language`` header
    4. ``en`` fallback

The column is added lazily via :func:`ensure_locale_column` so the
service can run before any migration is wired in. Pattern mirrors
:mod:`backend.services.user_trial` (idempotent ``ALTER TABLE`` guarded
by ``try/except``).

See :doc:`docs/I18N_ROADMAP.md` for the full epic plan.
"""

from __future__ import annotations

import logging
from typing import Optional

from backend.services import i18n
from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


# Used by tests / debug to short-circuit the column-creation attempt.
_LOCALE_COLUMN_READY = False


def ensure_locale_column() -> None:
    """Add ``users.preferred_locale`` if missing (idempotent)."""
    global _LOCALE_COLUMN_READY
    if _LOCALE_COLUMN_READY:
        return
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                "ALTER TABLE users ADD COLUMN preferred_locale VARCHAR(16) NULL"
            )
        except Exception:
            # Column already exists — common path after the first deploy.
            pass
        try:
            conn.commit()
        except Exception:
            pass
    _LOCALE_COLUMN_READY = True


def get_preferred_locale(username: str) -> Optional[str]:
    """Return the user's saved locale, or ``None`` when unset."""
    uname = (username or "").strip()
    if not uname:
        return None
    ensure_locale_column()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT preferred_locale FROM users WHERE username = {ph}",
                (uname,),
            )
            row = c.fetchone()
        except Exception:
            logger.exception("get_preferred_locale failed for %s", uname)
            return None
    if not row:
        return None
    raw = row["preferred_locale"] if hasattr(row, "keys") else row[0]
    if not raw:
        return None
    # Defensive normalisation: if a stale value sneaks in we still return
    # a supported locale rather than crashing downstream callers.
    return i18n.match_locale(raw)


def set_preferred_locale(username: str, locale: Optional[str]) -> Optional[str]:
    """Persist the user's locale choice.

    Returns the normalised locale that was actually stored, or ``None``
    when the column was cleared (``locale=None``). Unsupported tags
    are rejected with :class:`ValueError` so the API returns 400.
    """
    uname = (username or "").strip()
    if not uname:
        raise ValueError("username required")

    ensure_locale_column()
    ph = get_sql_placeholder()

    if locale is None or str(locale).strip() == "":
        # Clear the override so the request chain (Accept-Language etc.)
        # decides again.
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"UPDATE users SET preferred_locale = NULL WHERE username = {ph}",
                (uname,),
            )
            try:
                conn.commit()
            except Exception:
                pass
        return None

    matched = i18n.match_locale(locale)
    if matched is None or matched not in i18n.SUPPORTED_LOCALES:
        raise ValueError(f"unsupported locale: {locale!r}")

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE users SET preferred_locale = {ph} WHERE username = {ph}",
            (matched, uname),
        )
        try:
            conn.commit()
        except Exception:
            pass
    return matched


def resolve_request_locale(request, username: Optional[str] = None) -> str:
    """Return the locale to use for the current Flask request.

    Order:

    1. ``users.preferred_locale`` if ``username`` provided and set.
    2. ``X-CPoint-Locale`` header (client's active locale, e.g. after
       auto-detect or explicit toggle).
    3. ``Accept-Language`` header.
    4. :data:`i18n.DEFAULT_LOCALE` (``"en"``).
    """
    if username:
        try:
            saved = get_preferred_locale(username)
            if saved:
                return saved
        except Exception:
            logger.warning(
                "resolve_request_locale: get_preferred_locale failed for %s",
                username,
            )

    if request is not None:
        try:
            override = request.headers.get("X-CPoint-Locale")
        except Exception:
            override = None
        if override:
            matched = i18n.match_locale(override)
            if matched is not None:
                return matched

        try:
            accept = request.headers.get("Accept-Language")
        except Exception:
            accept = None
        if accept:
            return i18n.parse_accept_language(accept)

    return i18n.DEFAULT_LOCALE
