"""
Steve profiling: gated social host detection and user-supplied URL allowlists.

Walled gardens (LinkedIn, Instagram, TikTok, Snapchat, Facebook, etc.) are only
prefetched or cited when the URL appears in the user's allowlist (SQL + Firestore).
X/Twitter is not gated here (Grok x_search on deep).
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

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
