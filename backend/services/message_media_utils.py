"""Helpers for grouped chat media_paths (DM + group): parse, compare paths, pick previews."""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional
from urllib.parse import urlparse

from backend.services.media import resolve_upload_abspath
from backend.services.media_assets import object_key_from_path
from backend.services.r2_storage import R2_ENABLED, delete_from_r2

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp")
VIDEO_EXT = (".mp4", ".mov", ".m4v", ".webm", ".avi")

logger = logging.getLogger(__name__)


def parse_media_paths(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if x]
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(x).strip() for x in parsed if x]
        except json.JSONDecodeError:
            pass
    return []


def normalize_media_path_for_compare(url: str) -> str:
    """Strip query/fragment; drop scheme+host so CDN URL matches uploads-relative path."""
    u = (url or "").strip()
    if not u:
        return ""
    if "?" in u:
        u = u.split("?", 1)[0]
    if "#" in u:
        u = u.split("#", 1)[0]
    u = u.strip()
    lower = u.lower()
    if lower.startswith("http://") or lower.startswith("https://"):
        parsed = urlparse(u)
        path = (parsed.path or "").strip("/").lower()
        return path
    u = u.lstrip("/").lower()
    if u.startswith("uploads/"):
        u = u[len("uploads/") :]
    return u


def find_media_index(paths: list[str], hint: str) -> int:
    """Return index of path matching hint (CDN vs uploads/), or -1."""
    nh = normalize_media_path_for_compare(hint)
    if not nh:
        return -1
    for i, p in enumerate(paths):
        if normalize_media_path_for_compare(p) == nh:
            return i
    # Fallback: suffix match (last segment)
    hint_tail = nh.split("/")[-1] if nh else ""
    if hint_tail:
        for i, p in enumerate(paths):
            np = normalize_media_path_for_compare(p)
            if np.endswith(hint_tail) or hint_tail == np.split("/")[-1]:
                return i
    return -1


def first_image_and_video(paths: list[str]) -> tuple[Optional[str], Optional[str]]:
    first_img: Optional[str] = None
    first_vid: Optional[str] = None
    for p in paths:
        pl = p.lower()
        if first_img is None and any(pl.endswith(e) for e in IMAGE_EXT):
            first_img = p
        if first_vid is None and any(pl.endswith(e) for e in VIDEO_EXT):
            first_vid = p
    return first_img, first_vid


def media_paths_json(paths: list[str]) -> Optional[str]:
    if not paths:
        return None
    return json.dumps(paths)


def purge_media_file(path_or_url: str) -> bool:
    """Best-effort physical purge for a chat media URL/path after auth is confirmed."""
    target = (path_or_url or "").strip()
    if not target:
        return False

    deleted = False
    key = object_key_from_path(target)
    if key and R2_ENABLED:
        deleted = delete_from_r2(key) or deleted

    try:
        local_path = resolve_upload_abspath(target)
    except Exception as exc:
        logger.debug("Could not resolve local upload path for purge target=%s: %s", target, exc)
        local_path = None

    if local_path and os.path.exists(local_path):
        try:
            os.remove(local_path)
            deleted = True
            logger.info("Deleted local chat media file: %s", local_path)
        except OSError as exc:
            logger.warning("Failed deleting local chat media file %s: %s", local_path, exc)

    if not deleted:
        logger.info("Chat media purge no-op or object already unavailable: %s", target)
    return deleted
