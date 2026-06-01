"""Shared Steve chat image collection and Grok multimodal payload helpers."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Iterable, List, Optional, Sequence

IMAGE_KEYWORDS: tuple[str, ...] = (
    "image",
    "photo",
    "picture",
    "pic",
    "imagem",
    "foto",
    "see",
    "look",
    "show",
    "what is this",
    "what's this",
    "o que é",
    "vê",
    "olha",
)

VIDEO_EXTENSIONS: tuple[str, ...] = (".mp4", ".mov", ".webm", ".m4v", ".avi")

STEVE_SHARED_PHOTO_USER_MESSAGE = "[User shared a photo]"

_REPLY_PREFIX_RE = re.compile(
    r"^\[REPLY:([^:\]]+):([^\]]*)\](?:\r?\n|\s*)(.*)$",
    re.DOTALL,
)


@dataclass
class ImageSelection:
    urls: List[str]
    reply_targeted: bool = False
    specific_image: bool = False


def extract_reply_target_image(user_message: str | None) -> Optional[str]:
    """Parse [REPLY:..:📷|url|caption] prefix and return the target image URL if present."""
    if not user_message:
        return None
    text = user_message.strip()
    m = _REPLY_PREFIX_RE.match(text)
    if not m:
        return None
    snippet = (m.group(2) or "").strip()
    if not snippet.startswith("📷|"):
        return None
    parts = snippet.split("|", 2)
    if len(parts) > 1:
        url = parts[1].strip()
        if url:
            return url
    return None


def wants_images(message: str | None, *, force: bool = False) -> bool:
    if force:
        return True
    text = (message or "").strip()
    if not text:
        return False
    if text == STEVE_SHARED_PHOTO_USER_MESSAGE:
        return True
    msg_lower = text.lower()
    return any(kw in msg_lower for kw in IMAGE_KEYWORDS)


def is_http_image_url(url: str) -> bool:
    if not url or not isinstance(url, str) or not url.startswith("http"):
        return False
    lower = url.lower()
    if any(lower.endswith(ext) for ext in VIDEO_EXTENSIONS):
        return False
    return True


def append_urls_from_media_paths(raw: Any, out: List[str]) -> None:
    paths: Sequence[str] | None = None
    if isinstance(raw, list):
        paths = raw
    elif isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                paths = parsed
        except (json.JSONDecodeError, TypeError):
            paths = None
    if not paths:
        return
    for item in paths:
        if isinstance(item, str) and is_http_image_url(item):
            out.append(item)


def append_image_from_row(row: dict, out: List[str]) -> None:
    img = row.get("image_path")
    if isinstance(img, str) and is_http_image_url(img):
        out.append(img)
    append_urls_from_media_paths(row.get("media_paths"), out)


def dedupe_and_cap_image_urls(urls: Iterable[str], *, max_count: int = 5) -> List[str]:
    seen: set[str] = set()
    unique: List[str] = []
    for url in reversed(list(urls)):
        if url not in seen and len(unique) < max_count:
            seen.add(url)
            unique.append(url)
    unique.reverse()
    return unique


def select_image_urls_for_turn(
    collected: Sequence[str],
    user_message: str | None,
    *,
    force: bool = False,
    max_count: int = 5,
    **kwargs: Any,
) -> ImageSelection:
    # Reply-target photo takes precedence (even without vision keywords in body)
    target = extract_reply_target_image(user_message)
    if target:
        # Accept http or relative /uploads paths; normalization handled upstream or in todo 3
        if target.startswith("http") or target.startswith("/"):
            return ImageSelection(urls=[target], reply_targeted=True, specific_image=True)
    capped = dedupe_and_cap_image_urls(collected, max_count=max_count)
    if not wants_images(user_message, force=force):
        return ImageSelection(urls=[])
    return ImageSelection(urls=capped)


def build_grok_user_content(context_text: str, image_urls: Sequence[str]) -> Any:
    if not image_urls:
        return context_text
    user_content: List[dict[str, str]] = [{"type": "input_text", "text": context_text}]
    for img_url in image_urls:
        user_content.append({"type": "input_image", "image_url": img_url})
    return user_content


def vision_system_prompt_addon(*, focus_single_image: bool = False) -> str:
    base = (
        "\n\nYou can see images shared in this conversation. "
        "Describe what you see when asked and use visual details to answer helpfully."
    )
    if focus_single_image:
        base += " Focus on the specific image the user replied to."
    return base


def vision_focus_context_line(selection: ImageSelection) -> str:
    if getattr(selection, "reply_targeted", False) or getattr(selection, "specific_image", False):
        return "\nFocus only on the replied-to photo for this turn."
    return ""


def parse_reply_media_urls(user_message: str | None) -> List[str]:
    """Group chat path: extract 📷 urls from reply prefix (supports multiple if needed)."""
    urls: List[str] = []
    if not user_message:
        return urls
    m = _REPLY_PREFIX_RE.match(user_message.strip())
    if not m:
        return urls
    snippet = (m.group(2) or "").strip()
    if snippet.startswith("📷|"):
        parts = snippet.split("|")
        if len(parts) > 1 and parts[1].strip():
            urls.append(parts[1].strip())
    return urls
