"""
Steve profiling: gated social host detection and user-supplied URL allowlists.

Walled gardens (LinkedIn, Instagram, TikTok, Snapchat, Facebook, etc.) are only
prefetched or cited when the URL appears in the user's allowlist (SQL + Firestore).
X/Twitter is not gated here (Grok x_search on deep).
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Default netloc suffixes (without www.) — host_is_gated matches endswith or exact.
_STEVE_GATED_SOCIAL_HOSTS_DEFAULT = (
    "linkedin.com",
    "lnkd.in",
    "instagram.com",
    "tiktok.com",
    "snapchat.com",
    "facebook.com",
    "fb.com",
    "threads.net",
)


def load_gated_social_hosts() -> frozenset[str]:
    raw = (os.environ.get("STEVE_GATED_SOCIAL_HOSTS") or "").strip()
    if raw:
        parts = [p.strip().lower() for p in raw.split(",") if p.strip()]
        return frozenset(parts)
    return frozenset(h.lower() for h in _STEVE_GATED_SOCIAL_HOSTS_DEFAULT)


def _normalize_host_netloc(netloc: str) -> str:
    h = (netloc or "").strip().lower()
    if h.startswith("www."):
        h = h[4:]
    return h


def host_is_gated_social(url: str, gated_hosts: frozenset[str]) -> bool:
    """True if URL's host is a gated walled social (not X/Twitter)."""
    try:
        p = urlparse(url.strip())
        host = _normalize_host_netloc(p.netloc or "")
    except Exception:
        return False
    if not host:
        return False
    # Never gate X/Twitter — product uses x_search for deep
    if host in ("x.com", "twitter.com") or host.endswith(".x.com"):
        return False
    for g in gated_hosts:
        if host == g or host.endswith("." + g):
            return True
    return False


def normalize_url_for_allowlist(url: str) -> str:
    """Stable key for allowlist matching (lowercase host + path, no trailing slash)."""
    if not url or not isinstance(url, str):
        return ""
    try:
        s = url.strip()
        if not s.startswith("http"):
            s = "https://" + s
        p = urlparse(s)
        host = _normalize_host_netloc(p.netloc or "")
        path = (p.path or "").rstrip("/") or ""
        if not host:
            return ""
        return f"{host}{path}".lower()
    except Exception:
        return ""


def _linkedin_url_looks_like_profile(raw: str) -> bool:
    s = (raw or "").strip().lower()
    if not s:
        return False
    if "lnkd.in" in s:
        return True
    if "linkedin.com" not in s and not s.startswith("linkedin."):
        return False
    if any(p in s for p in ("/company/", "/school/", "/jobs/", "/posts/", "/feed/", "/pulse/")):
        return False
    return "/in/" in s or "/pub/" in s


def collect_social_links_for_profiling(
    *,
    linkedin_sql: str,
    firestore_profile: Optional[Dict[str, Any]],
    existing_analysis: Optional[Dict[str, Any]],
) -> Tuple[Set[str], List[Tuple[str, str]]]:
    """
    Returns (normalized_url_set, ordered_list of (platform_label, original_url)) for prompts.
    """
    normalized: Set[str] = set()
    rows: List[Tuple[str, str]] = []

    def add_row(platform: str, url: str) -> None:
        u = (url or "").strip()
        if not u:
            return
        n = normalize_url_for_allowlist(u)
        if not n:
            return
        if n not in normalized:
            normalized.add(n)
            rows.append((platform or "Link", u))

    if _linkedin_url_looks_like_profile(linkedin_sql):
        add_row("LinkedIn", linkedin_sql.strip())

    fs = firestore_profile or {}
    ob = fs.get("onboardingIdentity") or {}
    if isinstance(ob, dict):
        for item in ob.get("socialProvidedLinks") or []:
            if not isinstance(item, dict):
                continue
            add_row(
                (item.get("platform") or "Social").strip(),
                (item.get("url") or "").strip(),
            )

    personal = (existing_analysis or {}).get("personal") if isinstance(existing_analysis, dict) else None
    if isinstance(personal, dict):
        for link in personal.get("verifiedLinks") or []:
            if not isinstance(link, dict):
                continue
            add_row(
                (link.get("platform") or "Verified").strip(),
                (link.get("url") or "").strip(),
            )

    return normalized, rows


def format_user_provided_social_block(rows: List[Tuple[str, str]]) -> str:
    if not rows:
        return ""
    lines = [
        "--- USER-PROVIDED SOCIAL / PROFILE URLs (AUTHORITATIVE; may fetch or cite these) ---",
    ]
    for plat, url in rows:
        lines.append(f"- {plat}: {url}")
    return "\n".join(lines) + "\n"


def url_allowed_for_activity_prefetch(
    url: str,
    allowlist_normalized: Set[str],
    gated_hosts: frozenset[str],
) -> bool:
    """Fetch shared-activity URL unless it is gated social and not in allowlist."""
    if not url or not url.startswith("http"):
        return False
    if not host_is_gated_social(url, gated_hosts):
        return True
    n = normalize_url_for_allowlist(url)
    return n in allowlist_normalized


def user_can_access_steve_kb(
    viewer_username: str,
    target_username: str,
    context: Optional[Dict[str, Any]] = None,
) -> bool:
    """Central privacy gate for Steve User KB access.

    MUST be called BEFORE any call to get_steve_context_for_user,
    KB synthesis, or Firestore steve_user_profiles read.

    Returns True only if the viewer is allowed to see the target's full
    synthesized profiling/KB data per the rules in docs/STEVE_PRIVACY_GATE.md.
    """
    if not viewer_username or not target_username:
        return False

    v = viewer_username.lower().strip()
    t = target_username.lower().strip()

    # Literal bypass users + Steve self-reference
    if v in ("paulo", "admin") or t == "steve" or v == t:
        return True

    # Inline root network logic (standalone, no external deps)
    def get_user_root_networks(username: str) -> Set[int]:
        from backend.services.database import get_db_connection, get_sql_placeholder
        ph = get_sql_placeholder()
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute(
                    f"SELECT uc.community_id FROM user_communities uc "
                    f"JOIN users u ON u.id = uc.user_id "
                    f"WHERE u.username = {ph} AND LOWER(u.username) NOT IN ('admin', 'steve')",
                    (username,),
                )
                community_ids = [r["community_id"] if hasattr(r, "keys") else r[0] for r in c.fetchall()]
                root_ids = set()
                for cid in community_ids:
                    current = cid
                    visited = set()
                    while current and current not in visited:
                        visited.add(current)
                        c.execute(f"SELECT parent_community_id FROM communities WHERE id = {ph}", (current,))
                        row = c.fetchone()
                        if not row:
                            break
                        parent = row["parent_community_id"] if hasattr(row, "keys") else row[0]
                        if parent is None:
                            root_ids.add(current)
                            break
                        current = parent
                return root_ids
        except Exception as e:
            logger.debug("Could not fetch root networks for %s: %s", username, e)
            return set()

    def get_root_network_for_community(community_id: Any) -> Optional[int]:
        from backend.services.database import get_db_connection, get_sql_placeholder
        try:
            cid = int(community_id)
        except Exception:
            return None

        ph = get_sql_placeholder()
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                current = cid
                visited: Set[int] = set()
                while current and current not in visited:
                    visited.add(current)
                    c.execute(f"SELECT parent_community_id FROM communities WHERE id = {ph}", (current,))
                    row = c.fetchone()
                    if not row:
                        return None
                    parent = row["parent_community_id"] if hasattr(row, "keys") else row[0]
                    if parent is None:
                        return current
                    current = parent
        except Exception as e:
            logger.debug("Could not resolve root network for community %s: %s", community_id, e)
            return None
        return None

    def get_group_human_members(group_id: Any) -> List[str]:
        from backend.services.database import get_db_connection, get_sql_placeholder
        try:
            gid = int(group_id)
        except Exception:
            return []

        ph = get_sql_placeholder()
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute(
                    f"SELECT username FROM group_chat_members WHERE group_id = {ph}",
                    (gid,),
                )
                rows = c.fetchall()
                members = [
                    (row["username"] if hasattr(row, "keys") else row[0])
                    for row in rows
                ]
                return [m for m in members if isinstance(m, str) and m.lower() not in ("admin", "steve")]
        except Exception as e:
            logger.debug("Could not fetch group members for %s: %s", group_id, e)
            return []

    target_networks = get_user_root_networks(target_username)
    if not target_networks:
        return False

    ctx = context or {}

    # Community surfaces: target must be in the root parent of the post's original community.
    community_id = ctx.get("community_id")
    if community_id is not None:
        root_network_id = get_root_network_for_community(community_id)
        return root_network_id is not None and root_network_id in target_networks

    # Group chats: every current human member must share at least one root network with target.
    group_id = ctx.get("group_id")
    if group_id is not None:
        members = get_group_human_members(group_id)
        if not members:
            return False
        for member in members:
            member_networks = get_user_root_networks(member)
            if not (member_networks & target_networks):
                return False
        return True

    # Default DM/simple viewer-vs-target rule.
    viewer_networks = get_user_root_networks(viewer_username)
    return bool(viewer_networks & target_networks)
