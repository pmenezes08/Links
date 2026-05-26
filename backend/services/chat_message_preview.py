"""Human-readable chat message previews for thread lists and push notifications."""

from __future__ import annotations

import json
import re
from typing import Any

from backend.services.notifications import truncate_notification_preview

_REPLY_PREFIX_RE = re.compile(
    r"^\[REPLY:([^:\]]+):([^\]]*)\](?:\r?\n|\s*)(.*)$",
    re.DOTALL,
)
_STORY_REPLY_PREFIX_RE = re.compile(
    r"^\[STORY_REPLY:[^\]]+\](?:\r?\n|\s*)(.*)$",
    re.DOTALL,
)


def _parse_reply_snippet(snippet: str) -> str:
    """Turn stored reply quote snippets into plain labels."""
    s = (snippet or "").strip()
    if not s:
        return "message"
    if s.startswith("📷|"):
        parts = s.split("|", 2)
        caption = (parts[2] if len(parts) > 2 else "").strip()
        return caption or "Photo"
    if s.startswith("🎥|"):
        parts = s.split("|", 2)
        caption = (parts[2] if len(parts) > 2 else "").strip()
        return caption or "Video"
    if s.startswith("🎤|"):
        summary = s[2:].strip()
        return summary or "Voice message"
    return s


def _media_count(media_paths: Any) -> int:
    if not media_paths:
        return 0
    if isinstance(media_paths, list):
        return len([p for p in media_paths if p])
    raw = str(media_paths).strip()
    if not raw:
        return 0
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return len([p for p in parsed if p])
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    return 1 if raw else 0


def _media_fallback_label(
    *,
    image_path: str | None = None,
    video_path: str | None = None,
    audio_path: str | None = None,
    audio_summary: str | None = None,
    media_paths: Any = None,
) -> str:
    summary = (audio_summary or "").strip()
    if audio_path or summary:
        return summary or "Voice message"
    if video_path:
        return "Video"
    if image_path:
        return "Photo"
    count = _media_count(media_paths)
    if count > 1:
        return f"{count} media files"
    if count == 1:
        return "Photo"
    return ""


def format_chat_message_preview(
    message: str | None,
    *,
    image_path: str | None = None,
    video_path: str | None = None,
    audio_path: str | None = None,
    audio_summary: str | None = None,
    media_paths: Any = None,
    is_encrypted: bool = False,
    max_len: int = 160,
) -> str:
    """
    Build a single-line preview for DMs / group chat lists and push bodies.

    Handles reply/story prefixes, media-only messages, and encrypted placeholders.
    """
    text = (message or "").strip()

    if is_encrypted and not text:
        return truncate_notification_preview("Encrypted message", max_len)

    if text.startswith("[REPLY:"):
        match = _REPLY_PREFIX_RE.match(text)
        if match:
            sender = (match.group(1) or "").strip() or "user"
            quoted = _parse_reply_snippet(match.group(2) or "")
            body = (match.group(3) or "").strip()
            if body:
                content = body
            else:
                content = quoted
            human = f"Replied to {sender}: {content}"
            return truncate_notification_preview(human, max_len)

    if text.startswith("[STORY_REPLY:"):
        match = _STORY_REPLY_PREFIX_RE.match(text)
        if match:
            body = (match.group(1) or "").strip()
            human = f"Replied to story: {body}" if body else "Replied to a story"
            return truncate_notification_preview(human, max_len)

    if text:
        return truncate_notification_preview(text, max_len)

    media_label = _media_fallback_label(
        image_path=image_path,
        video_path=video_path,
        audio_path=audio_path,
        audio_summary=audio_summary,
        media_paths=media_paths,
    )
    if media_label:
        return truncate_notification_preview(media_label, max_len)

    if is_encrypted:
        return truncate_notification_preview("Encrypted message", max_len)

    return ""


def preview_from_message_row(row: Any) -> str:
    """Extract preview fields from a messages-table row (dict-like or tuple)."""
    if row is None:
        return ""

    def _get(key: str, idx: int, default: Any = None) -> Any:
        if hasattr(row, "keys"):
            try:
                return row[key]
            except (KeyError, IndexError, TypeError):
                return default
        if isinstance(row, (list, tuple)) and len(row) > idx:
            return row[idx]
        return default

    message = _get("message", 0, "") or ""
    is_encrypted = bool(_get("is_encrypted", 3, False))
    image_path = _get("image_path", 4)
    video_path = _get("video_path", 5)
    audio_path = _get("audio_path", 6)
    audio_summary = _get("audio_summary", 7)
    media_paths = _get("media_paths", 8)

    return format_chat_message_preview(
        message,
        image_path=image_path,
        video_path=video_path,
        audio_path=audio_path,
        audio_summary=audio_summary,
        media_paths=media_paths,
        is_encrypted=is_encrypted,
    )
