"""Unit tests for shared Steve chat image helpers."""

from __future__ import annotations

from backend.services.steve_chat_images import (
    STEVE_SHARED_PHOTO_USER_MESSAGE,
    build_grok_user_content,
    select_image_urls_for_turn,
    wants_images,
)


def test_wants_images_photo_trigger_message():
    assert wants_images(STEVE_SHARED_PHOTO_USER_MESSAGE) is True
    assert wants_images("read this picture") is True
    assert wants_images("hello") is False


def test_select_image_urls_only_when_user_asks():
    urls = ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"]
    assert select_image_urls_for_turn(urls, "what is in this photo?", max_count=5).urls == urls
    assert select_image_urls_for_turn(urls, "hello", max_count=5).urls == []
    assert select_image_urls_for_turn(urls, STEVE_SHARED_PHOTO_USER_MESSAGE, force=True, max_count=1).urls == [
        "https://cdn.example/b.jpg"
    ]


def test_build_grok_user_content_multimodal():
    payload = build_grok_user_content("context", ["https://cdn.example/x.jpg"])
    assert isinstance(payload, list)
    assert payload[0]["type"] == "input_text"
    assert payload[1]["type"] == "input_image"
    assert payload[1]["image_url"] == "https://cdn.example/x.jpg"
