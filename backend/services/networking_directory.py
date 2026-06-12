"""Networking directory: single-query community roster with a short-TTL cache.

Replaces the 2N+1 query loop that ``/api/networking/community_members`` ran
(one ``users``+``user_profiles`` lookup pair per member, sequentially) with a
single JOIN over the community tree.

Caching: the FULL tree roster (every member except the ``admin``/``steve``
service accounts) is cached under a community-scoped key,
``networking_directory:v1:{community_id}``, for a short TTL. The viewer is
excluded and the dropdown filters are applied at serve time, after the
per-request membership gate. Keying by community alone is safe here because
(a) access is re-authorized on every request *before* the cache is read, and
(b) the payload contains only the directory fields every tree member already
receives. Per-viewer differences (self-exclusion, filters) live outside the
cache. There is no roster-version signal in the repo, so invalidation is
TTL-only: a join/leave/profile edit can be stale for other members for up to
``CACHE_TTL_NETWORKING_DIRECTORY`` seconds; a removed member never reads the
stale blob because the gate denies them first.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder
from redis_cache import cache

logger = logging.getLogger(__name__)

CACHE_TTL_NETWORKING_DIRECTORY = int(
    os.environ.get("CACHE_TTL_NETWORKING_DIRECTORY", "90")
)
DIRECTORY_CACHE_VERSION = "v1"

# Service accounts that never appear in the member directory.
_EXCLUDED_ACCOUNTS_SQL = "('admin', 'steve')"

MEMBERSHIP_ERROR = "Not a member of this community"

_FULL_ROSTER_SQL = """
    SELECT DISTINCT u.username AS username,
           COALESCE(p.display_name, u.username) AS display_name,
           p.profile_picture AS profile_picture,
           p.bio AS bio,
           p.location AS profile_location,
           u.city AS city,
           u.country AS country,
           u.role AS role,
           u.company AS company,
           u.industry AS industry,
           u.professional_interests AS professional_interests,
           u.professional_about AS professional_about
    FROM users u
    JOIN user_communities uc ON u.id = uc.user_id
    LEFT JOIN user_profiles p ON u.username = p.username
    WHERE uc.community_id IN ({comm_ph})
      AND LOWER(u.username) NOT IN {excluded}
"""

# Fallback when the professional columns don't exist on ``users`` (older
# schemas; the legacy endpoint tolerated this with a per-member try/except).
_BASE_ROSTER_SQL = """
    SELECT DISTINCT u.username AS username,
           COALESCE(p.display_name, u.username) AS display_name,
           p.profile_picture AS profile_picture,
           p.bio AS bio,
           p.location AS profile_location,
           u.city AS city,
           u.country AS country
    FROM users u
    JOIN user_communities uc ON u.id = uc.user_id
    LEFT JOIN user_profiles p ON u.username = p.username
    WHERE uc.community_id IN ({comm_ph})
      AND LOWER(u.username) NOT IN {excluded}
"""


def directory_cache_key(community_id: int) -> str:
    return f"networking_directory:{DIRECTORY_CACHE_VERSION}:{community_id}"


def invalidate_directory(community_id: Optional[int]) -> None:
    """Bust the cached roster for one community tree. Failures are swallowed —
    a stale window bounded by the TTL is acceptable; raising would block the
    mutation that triggered the invalidation."""
    if not community_id:
        return
    try:
        cache.delete(directory_cache_key(community_id))
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("networking_directory invalidate failed for %s: %s", community_id, e)


def _val(row: Any, key: str, idx: int) -> Any:
    """Read a column from a DictCursor/sqlite3.Row dict-like row or a tuple."""
    if row is None:
        return None
    try:
        if hasattr(row, "keys"):
            return row[key]
        return row[idx]
    except Exception:
        return None


def _parse_interests(raw: Any) -> List[str]:
    """Same tolerant parse as the legacy endpoint: JSON list first, then CSV."""
    if not raw:
        return []
    try:
        decoded = json.loads(raw)
        if isinstance(decoded, list):
            return [str(x).strip() for x in decoded if isinstance(x, str) and len(str(x).strip()) > 1]
        return []
    except Exception:
        return [p.strip() for p in str(raw).split(",") if p.strip() and len(p.strip()) > 1]


def _row_to_member(row: Any, has_pro_fields: bool) -> Optional[Dict[str, Any]]:
    uname = _val(row, "username", 0)
    if not uname:
        return None
    city = _val(row, "city", 5) or ""
    country = _val(row, "country", 6) or ""
    profile_location = _val(row, "profile_location", 4) or ""
    loc_display = [x for x in ([city, country] if (city or country) else [profile_location]) if x]
    bio = _val(row, "bio", 3) or ""
    pro_about = (_val(row, "professional_about", 11) or "") if has_pro_fields else ""
    return {
        "username": uname,
        "display_name": _val(row, "display_name", 1) or uname,
        "profile_picture": _val(row, "profile_picture", 2),
        "city": city,
        "country": country,
        "location": ", ".join(loc_display),
        "industry": (_val(row, "industry", 9) or "") if has_pro_fields else "",
        "role": (_val(row, "role", 7) or "") if has_pro_fields else "",
        "company": (_val(row, "company", 8) or "") if has_pro_fields else "",
        "professional_interests": _parse_interests(_val(row, "professional_interests", 10)) if has_pro_fields else [],
        "bio": bio or pro_about,
    }


def _load_tree_roster(c, ph: str, community_ids: List[int]) -> List[Dict[str, Any]]:
    comm_ph = ",".join([ph] * len(community_ids))
    params = tuple(community_ids)
    try:
        c.execute(
            _FULL_ROSTER_SQL.format(comm_ph=comm_ph, excluded=_EXCLUDED_ACCOUNTS_SQL),
            params,
        )
        rows = c.fetchall()
        has_pro_fields = True
    except Exception:
        c.execute(
            _BASE_ROSTER_SQL.format(comm_ph=comm_ph, excluded=_EXCLUDED_ACCOUNTS_SQL),
            params,
        )
        rows = c.fetchall()
        has_pro_fields = False
    members = []
    for row in rows:
        member = _row_to_member(row, has_pro_fields)
        if member:
            members.append(member)
    members.sort(key=lambda m: (m["display_name"] or m["username"]).lower())
    return members


def _matches_filters(
    member: Dict[str, Any],
    location_filter: str,
    industry_filter: str,
    interests_filter: str,
) -> bool:
    """Replicates the legacy endpoint's filter semantics: location matches on
    exact "City, Country" or substring of the space-joined parts; industry and
    interests are case-insensitive substring matches."""
    if location_filter:
        f = location_filter.lower()
        loc_combined = (member.get("location") or "").lower()
        if f != loc_combined and f not in loc_combined.replace(", ", " "):
            return False
    if industry_filter:
        if industry_filter.lower() not in (member.get("industry") or "").lower():
            return False
    if interests_filter:
        fl = interests_filter.lower()
        interests = member.get("professional_interests") or []
        if not any(fl in (i or "").lower() for i in interests):
            return False
    return True


def get_directory_payload(
    viewer_username: str,
    community_id: int,
    *,
    location_filter: str = "",
    industry_filter: str = "",
    interests_filter: str = "",
) -> Tuple[Dict[str, Any], int]:
    """Return ``(body, status)`` for the networking member directory.

    Resolves the community tree, runs the membership gate (always live, never
    cached), then serves the roster from cache or one JOIN. Filter option
    sets are computed over the full visible roster (pre-filter), matching the
    legacy behaviour.
    """
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()

        c.execute(
            f"SELECT id FROM communities WHERE id = {ph} OR parent_community_id = {ph}",
            (community_id, community_id),
        )
        community_ids = [_val(r, "id", 0) for r in c.fetchall()]
        community_ids = [cid for cid in community_ids if cid is not None]
        if not community_ids:
            return {"success": False, "error": "Community not found"}, 404

        comm_ph = ",".join([ph] * len(community_ids))
        c.execute(
            f"SELECT 1 FROM user_communities uc JOIN users u ON uc.user_id = u.id"
            f" WHERE u.username = {ph} AND uc.community_id IN ({comm_ph})",
            (viewer_username, *community_ids),
        )
        if not c.fetchone():
            return {"success": False, "error": MEMBERSHIP_ERROR}, 403

        key = directory_cache_key(community_id)
        roster: Optional[List[Dict[str, Any]]] = None
        try:
            roster = cache.get(key)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning("networking_directory cache get failed for %s: %s", key, e)
        if roster is None:
            roster = _load_tree_roster(c, ph, community_ids)
            try:
                cache.set(key, roster, CACHE_TTL_NETWORKING_DIRECTORY)
            except Exception as e:  # pragma: no cover - defensive
                logger.warning("networking_directory cache set failed for %s: %s", key, e)

    visible = [m for m in roster if m.get("username") != viewer_username]

    locations: set = set()
    industries: set = set()
    interests: set = set()
    for m in visible:
        if m.get("location"):
            locations.add(m["location"])
        if m.get("industry"):
            industries.add(m["industry"])
        for interest in m.get("professional_interests") or []:
            interests.add(interest)

    members = [
        m for m in visible
        if _matches_filters(m, location_filter, industry_filter, interests_filter)
    ]

    return {
        "success": True,
        "members": members,
        "filters": {
            "locations": sorted(locations),
            "industries": sorted(industries),
            "interests": sorted(interests),
        },
    }, 200
