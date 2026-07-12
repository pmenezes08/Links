"""Unit tests for shared Steve chat image helpers."""

from __future__ import annotations

import pytest

from backend.services.steve_chat_images import (
    STEVE_SHARED_PHOTO_USER_MESSAGE,
    build_grok_user_content,
    create_response_with_image_fallback,
    filter_xai_supported_image_urls,
    is_xai_supported_image_url,
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


def test_is_xai_supported_image_url():
    # xAI vision accepts jpeg/png/webp/ico only
    assert is_xai_supported_image_url("https://media.c-point.co/a.jpg") is True
    assert is_xai_supported_image_url("https://media.c-point.co/a.JPEG") is True
    assert is_xai_supported_image_url("https://media.c-point.co/a.png?w=100") is True
    assert is_xai_supported_image_url("/uploads/photo.webp") is True
    # rejected: gif, svg, extension-less (R2 serves those as octet-stream)
    assert is_xai_supported_image_url("https://media.tenor.com/x/tenor.gif") is False
    assert is_xai_supported_image_url("https://media.c-point.co/logo.svg") is False
    assert is_xai_supported_image_url("https://media.c-point.co/no-extension") is False
    assert is_xai_supported_image_url("") is False
    assert is_xai_supported_image_url(None) is False  # type: ignore[arg-type]


def test_filter_xai_supported_image_urls_counts_dropped():
    kept, dropped = filter_xai_supported_image_urls(
        ["https://cdn.example/a.jpg", "https://cdn.example/b.gif", "https://cdn.example/c.png"]
    )
    assert kept == ["https://cdn.example/a.jpg", "https://cdn.example/c.png"]
    assert dropped == 1


def test_select_image_urls_drops_unsupported_formats():
    urls = ["https://cdn.example/a.jpg", "https://cdn.example/b.gif"]
    selection = select_image_urls_for_turn(urls, "what is in this photo?", max_count=5)
    assert selection.urls == ["https://cdn.example/a.jpg"]


def test_select_image_urls_gif_reply_target_falls_through():
    msg = "[REPLY:alice:📷|https://cdn.example/anim.gif|cap]\nwhat is this picture?"
    selection = select_image_urls_for_turn(["https://cdn.example/a.jpg"], msg, max_count=5)
    assert selection.reply_targeted is False
    assert selection.urls == ["https://cdn.example/a.jpg"]


def test_build_grok_user_content_all_unsupported_returns_text_with_note():
    payload = build_grok_user_content("context", ["https://cdn.example/x.gif"])
    assert isinstance(payload, str)
    assert payload.startswith("context")
    assert "cannot view" in payload


class _FakeResponses:
    def __init__(self, fail_first_with: Exception | None):
        self._fail_with = fail_first_with
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._fail_with is not None and len(self.calls) == 1:
            raise self._fail_with
        return {"ok": True}


class _FakeClient:
    def __init__(self, fail_first_with: Exception | None = None):
        self.responses = _FakeResponses(fail_first_with)


def _vision_input():
    return [
        {"role": "system", "content": "sys"},
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "ctx"},
                {"type": "input_image", "image_url": "https://cdn.example/a.jpg"},
            ],
        },
    ]


def test_image_fallback_retries_text_only_on_image_download_error():
    err = Exception(
        'Error code: 400 - {"error": "Unsupported content-type encountered when downloading image"}'
    )
    client = _FakeClient(fail_first_with=err)
    result = create_response_with_image_fallback(client, input=_vision_input(), model="m")
    assert result == {"ok": True}
    assert len(client.responses.calls) == 2
    retry_user_msg = client.responses.calls[1]["input"][1]
    assert retry_user_msg["content"] == "ctx"
    assert client.responses.calls[1]["model"] == "m"


def test_image_fallback_reraises_non_image_errors():
    err = Exception("Error code: 429 - rate limited")
    client = _FakeClient(fail_first_with=err)
    with pytest.raises(Exception, match="rate limited"):
        create_response_with_image_fallback(client, input=_vision_input(), model="m")
    assert len(client.responses.calls) == 1


def test_image_fallback_reraises_when_no_images_attached():
    err = Exception("Unsupported content-type encountered when downloading image")
    client = _FakeClient(fail_first_with=err)
    text_input = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "just text"},
    ]
    with pytest.raises(Exception, match="downloading image"):
        create_response_with_image_fallback(client, input=text_input, model="m")
    assert len(client.responses.calls) == 1
