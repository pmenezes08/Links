"""Case-insensitive batched profile-picture lookups.

MySQL compares usernames case-insensitively (``*_ci`` collation), but content
tables (``replies``, ``posts``, ``messages``, ...) store whatever spelling the
session carried at write time, which can differ from
``user_profiles.username`` (e.g. ``'Mary'`` vs ``'mary'`` — the password login
historically kept the user-typed spelling). Any plain Python dict keyed by the
profile spelling and queried with the content spelling silently drops the row,
which is how comment avatars went missing from batched feed/post-detail
payloads. Always key and query these maps case-insensitively.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, Optional

logger = logging.getLogger(__name__)


class CaseInsensitiveUserMap:
    """username -> value map tolerant of case drift between tables."""

    __slots__ = ("_data",)

    def __init__(self) -> None:
        self._data: Dict[str, Any] = {}

    @staticmethod
    def _key(username: Optional[str]) -> str:
        return (username or "").strip().lower()

    def set(self, username: Optional[str], value: Any) -> None:
        key = self._key(username)
        if key:
            self._data[key] = value

    def get(self, username: Optional[str], default: Any = None) -> Any:
        return self._data.get(self._key(username), default)

    def __len__(self) -> int:
        return len(self._data)

    def __bool__(self) -> bool:
        return bool(self._data)


def fetch_profile_picture_map(cursor, usernames: Iterable[Optional[str]]) -> CaseInsensitiveUserMap:
    """Batch-fetch ``user_profiles.profile_picture`` for ``usernames``.

    Returns a case-insensitive map of username -> raw stored value (R2 URL or
    legacy relative path). Query failures are logged and yield an empty map so
    callers degrade to initials, matching prior behavior at every call site.
    """
    result = CaseInsensitiveUserMap()
    names = sorted({(u or "").strip() for u in usernames} - {""})
    if not names:
        return result
    try:
        from backend.services.database import get_sql_placeholder

        placeholders = ",".join([get_sql_placeholder()] * len(names))
        cursor.execute(
            f"SELECT username, profile_picture FROM user_profiles WHERE username IN ({placeholders})",
            tuple(names),
        )
        for row in cursor.fetchall() or []:
            username = row["username"] if hasattr(row, "keys") else row[0]
            picture = row["profile_picture"] if hasattr(row, "keys") else row[1]
            result.set(username, picture)
    except Exception as exc:
        logger.warning("fetch_profile_picture_map failed for %d users: %s", len(names), exc)
    return result
