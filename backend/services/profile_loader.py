"""Load a user's full profile dict for ``/api/profile_me``.

Lifts the SQL + row-mapping that used to live in [bodybuilding_app.py][1]
(`api_profile_me` view) into a service so the blueprint stays a thin HTTP
shell.

The query joins ``users`` and ``user_profiles`` and tolerates older schemas
that might be missing ``notification_show_previews`` or ``timezone``. The
return shape mirrors the legacy endpoint exactly so client code in
``client/src/contexts/UserProfileContext.tsx`` keeps working unchanged.

[1]: ../../bodybuilding_app.py
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)


_BASE_COLUMNS = (
    "u.username, u.email, u.subscription, u.email_verified, u.email_verified_at, "
    "u.first_name, u.last_name, u.gender, u.country, u.city, u.date_of_birth, u.age, "
    "p.display_name, p.bio, p.location, p.website, "
    "p.instagram, p.twitter, p.profile_picture, p.cover_photo, "
    "u.role, u.company, u.industry, u.linkedin, u.professional_about, "
    "u.professional_interests, u.professional_company_intel"
)


def _row_get(row, key: str, idx: int) -> Any:
    """Dual-mode row accessor — supports MySQL DictCursor and SQLite tuple rows."""
    try:
        if hasattr(row, "keys"):
            return row.get(key) if hasattr(row, "get") else row[key]
        return row[idx]
    except Exception:
        return None


def _parse_interests(raw: Any) -> list[str]:
    """Decode the JSON-or-CSV `professional_interests` column into a list."""
    if not raw:
        return []
    try:
        decoded = json.loads(raw)
        if isinstance(decoded, list):
            return [str(item).strip() for item in decoded if item and str(item).strip()]
    except (json.JSONDecodeError, TypeError):
        pass
    return [part.strip() for part in str(raw).split(",") if part and part.strip()]


def load_profile(username: str) -> Optional[Dict[str, Any]]:
    """Return the full profile dict for ``username`` or ``None`` if missing.

    Tries the new schema (with ``notification_show_previews``) first, falls
    back to the legacy column set if the new column doesn't exist yet on this
    DB. The shape returned is the JSON the client expects from
    ``/api/profile_me`` minus the wrapper ``success`` flag — the blueprint
    adds that.
    """
    if not username:
        return None

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()

        row = None
        # Try with the new column first; if MySQL barks (column missing on
        # an old DB), retry without it.
        try:
            c.execute(
                f"""
                SELECT {_BASE_COLUMNS}, u.notification_show_previews
                FROM users u
                LEFT JOIN user_profiles p ON u.username = p.username
                WHERE u.username = {ph}
                """,
                (username,),
            )
            row = c.fetchone()
        except Exception:
            try:
                c.execute(
                    f"""
                    SELECT {_BASE_COLUMNS}
                    FROM users u
                    LEFT JOIN user_profiles p ON u.username = p.username
                    WHERE u.username = {ph}
                    """,
                    (username,),
                )
                row = c.fetchone()
            except Exception:
                logger.exception("profile_loader: legacy SELECT failed for %s", username)
                return None

        if not row:
            return None

        interests = _parse_interests(
            _row_get(row, "professional_interests", 25)
        )
        company_intel_raw = _row_get(row, "professional_company_intel", 26)
        display_name = _row_get(row, "display_name", 12)

        profile: Dict[str, Any] = {
            "username": username,
            "email": _row_get(row, "email", 1),
            "subscription": _row_get(row, "subscription", 2),
            "email_verified": bool(_row_get(row, "email_verified", 3)),
            "email_verified_at": _row_get(row, "email_verified_at", 4),
            "first_name": _row_get(row, "first_name", 5),
            "last_name": _row_get(row, "last_name", 6),
            "gender": _row_get(row, "gender", 7),
            "country": _row_get(row, "country", 8),
            "city": _row_get(row, "city", 9),
            "date_of_birth": _row_get(row, "date_of_birth", 10),
            "age": _row_get(row, "age", 11),
            "display_name": display_name,
            "bio": _row_get(row, "bio", 13),
            "location": _row_get(row, "location", 14),
            "website": _row_get(row, "website", 15),
            "instagram": _row_get(row, "instagram", 16),
            "twitter": _row_get(row, "twitter", 17),
            "profile_picture": _row_get(row, "profile_picture", 18),
            "cover_photo": _row_get(row, "cover_photo", 19),
            "personal": {
                "display_name": display_name or username,
                "bio": _row_get(row, "bio", 13),
                "date_of_birth": _row_get(row, "date_of_birth", 10),
                "gender": _row_get(row, "gender", 7),
                "country": _row_get(row, "country", 8),
                "city": _row_get(row, "city", 9),
            },
            "professional": {
                "role": _row_get(row, "role", 20),
                "company": _row_get(row, "company", 21),
                "industry": _row_get(row, "industry", 22),
                "linkedin": _row_get(row, "linkedin", 23),
                "about": _row_get(row, "professional_about", 24),
                "interests": interests,
                "company_intel": (
                    str(company_intel_raw).strip()
                    if company_intel_raw is not None
                    else ""
                ),
            },
        }

        # notification_show_previews defaults to True if the column doesn't
        # exist on this DB (older schemas). Look it up by name; fall back
        # gracefully on KeyError.
        prefs_raw: Any = None
        try:
            prefs_raw = (
                row["notification_show_previews"]
                if hasattr(row, "keys")
                else None
            )
        except Exception:
            prefs_raw = None
        profile["notification_show_previews"] = (
            True if prefs_raw is None else bool(int(prefs_raw))
        )

        # ``timezone`` lives on a separate column we may not have selected
        # above to keep the main query stable across schemas.
        try:
            c.execute(
                f"SELECT timezone FROM users WHERE username = {ph}",
                (username,),
            )
            tz_row = c.fetchone()
            if tz_row:
                tz_raw = (
                    tz_row["timezone"] if hasattr(tz_row, "keys") else tz_row[0]
                )
                tz_clean = str(tz_raw).strip() if tz_raw is not None else ""
                profile["timezone"] = tz_clean or None
            else:
                profile["timezone"] = None
        except Exception:
            profile["timezone"] = None

        return profile


__all__ = ["load_profile"]
