"""Shared Steve chat image collection and Grok multimodal payload helpers."""

from __future__ import annotations

import json
from typing import Any, Iterable, List, NamedTuple, Optional, Sequence

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


class ImageTurnSelection(NamedTuple):
    urls: List[str]
    reply_targeted: bool = False
    specific_image: bool = False


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
) -> ImageTurnSelection:
    capped = dedupe_and_cap_image_urls(collected, max_count=max_count)
    if not wants_images(user_message, force=force):
        return ImageTurnSelection(urls=[])
    return ImageTurnSelection(urls=capped)


def vision_focus_context_line(selection: ImageTurnSelection) -> str:
    if selection.reply_targeted:
        return (
            "\n\nThe user quoted a specific photo in their reply and is asking about that image. "
            "Describe that image only — not other photos from the thread."
        )
    if selection.specific_image:
        return (
            "\n\nThe user is asking about a specific recent photo in this conversation. "
            "Focus on the most recently shared image attached below."
        )
    return ""


def build_grok_user_content(context_text: str, image_urls: Sequence[str]) -> Any:
    if not image_urls:
        return context_text
    user_content: List[dict[str, str]] = [{"type": "input_text", "text": context_text}]
    for img_url in image_urls:
        user_content.append({"type": "input_image", "image_url": img_url})
    return user_content


def vision_system_prompt_addon() -> str:
    return (
        "\n\nYou can see images shared in this conversation. "
        "Describe what you see when asked and use visual details to answer helpfully."
    )
