"""Basic profile completion checks for social participation gates."""

from __future__ import annotations

from typing import Any, Dict, Iterable, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder

REQUIRED_FIELDS = ("first_name", "last_name", "profile_picture")
ERROR_CODE = "basic_profile_required"


def _row_value(row: Any, key: str, index: int, default: Any = None) -> Any:
    if row is None:
        return default
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key, default)
    if isinstance(row, (list, tuple)) and len(row) > index:
        return row[index]
    return default


def _missing_fields(first_name: Any, last_name: Any, profile_picture: Any) -> list[str]:
    missing: list[str] = []
    if not str(first_name or "").strip():
        missing.append("first_name")
    if not str(last_name or "").strip():
        missing.append("last_name")
    if not str(profile_picture or "").strip():
        missing.append("profile_picture")
    return missing


def basic_profile_status(username: str | None) -> Dict[str, Any]:
    """Return the signed-in user's basic-profile status.

    Basic profile is intentionally small: first name, last name, and profile
    picture. Rich personal/professional sections remain optional enrichment.
    """
    clean_username = (username or "").strip()
    if not clean_username:
        return {
            "complete": False,
            "missing_fields": list(REQUIRED_FIELDS),
            "profile": {},
        }

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT u.first_name, u.last_name, up.profile_picture
            FROM users u
            LEFT JOIN user_profiles up ON up.username = u.username
            WHERE u.username = {ph}
            """,
            (clean_username,),
        )
        row = c.fetchone()

    first_name = _row_value(row, "first_name", 0, "")
    last_name = _row_value(row, "last_name", 1, "")
    profile_picture = _row_value(row, "profile_picture", 2, "")
    missing = _missing_fields(first_name, last_name, profile_picture)
    return {
        "complete": not missing,
        "missing_fields": missing,
        "required_fields": list(REQUIRED_FIELDS),
        "profile": {
            "first_name": first_name or "",
            "last_name": last_name or "",
            "profile_picture": profile_picture or None,
        },
    }


def basic_profile_complete(username: str | None) -> bool:
    return bool(basic_profile_status(username).get("complete"))


def basic_profile_required_payload(username: str | None) -> Tuple[Dict[str, Any], int]:
    status = basic_profile_status(username)
    return {
        "success": False,
        "error": "Complete your basic profile to participate.",
        "error_code": ERROR_CODE,
        "message_key": ERROR_CODE,
        "basic_profile": status,
    }, 412


def require_basic_profile_payload(username: str | None) -> Tuple[Dict[str, Any], int] | None:
    """Return an error payload/status when the user is missing basics."""
    if basic_profile_complete(username):
        return None
    return basic_profile_required_payload(username)


def apply_basic_profile_updates(
    username: str,
    *,
    first_name: str | None = None,
    last_name: str | None = None,
    profile_picture: str | None = None,
) -> Dict[str, Any]:
    """Persist basic-profile fields and return the updated status."""
    clean_username = (username or "").strip()
    if not clean_username:
        raise ValueError("username required")
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if first_name is not None or last_name is not None:
            assignments: list[str] = []
            params: list[Any] = []
            if first_name is not None:
                assignments.append(f"first_name = {ph}")
                params.append(first_name.strip())
            if last_name is not None:
                assignments.append(f"last_name = {ph}")
                params.append(last_name.strip())
            params.append(clean_username)
            c.execute(
                f"UPDATE users SET {', '.join(assignments)} WHERE username = {ph}",
                tuple(params),
            )
        if profile_picture is not None:
            try:
                c.execute(
                    f"UPDATE user_profiles SET profile_picture = {ph}, updated_at = CURRENT_TIMESTAMP WHERE username = {ph}",
                    (profile_picture, clean_username),
                )
                if getattr(c, "rowcount", 0) == 0:
                    c.execute(
                        f"INSERT INTO user_profiles (username, profile_picture) VALUES ({ph}, {ph})",
                        (clean_username, profile_picture),
                    )
            except Exception:
                c.execute(
                    f"INSERT INTO user_profiles (username, profile_picture) VALUES ({ph}, {ph})",
                    (clean_username, profile_picture),
                )
        conn.commit()
    return basic_profile_status(clean_username)


__all__ = [
    "ERROR_CODE",
    "REQUIRED_FIELDS",
    "apply_basic_profile_updates",
    "basic_profile_complete",
    "basic_profile_required_payload",
    "basic_profile_status",
    "require_basic_profile_payload",
]
