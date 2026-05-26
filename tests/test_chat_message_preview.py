"""Tests for chat message preview formatting."""

from backend.services.chat_message_preview import format_chat_message_preview


def test_empty_text_with_voice_uses_summary():
    assert format_chat_message_preview("", audio_path="/a.webm", audio_summary="Running late") == "Running late"


def test_empty_text_with_voice_no_summary():
    assert format_chat_message_preview("", audio_path="/a.webm") == "Voice message"


def test_empty_text_with_photo():
    assert format_chat_message_preview("", image_path="/pic.jpg") == "Photo"


def test_empty_text_with_video():
    assert format_chat_message_preview("", video_path="/vid.mp4") == "Video"


def test_multiple_media_files():
    assert format_chat_message_preview("", media_paths='["a.jpg","b.jpg"]') == "2 media files"


def test_plain_text_unchanged():
    assert format_chat_message_preview("Hello there") == "Hello there"


def test_reply_with_text_body():
    raw = "[REPLY:alice:Earlier message]\nSounds good!"
    assert format_chat_message_preview(raw) == "Replied to alice: Sounds good!"


def test_reply_voice_snippet_without_body():
    raw = "[REPLY:alice:🎤|Voice message]\n"
    assert format_chat_message_preview(raw) == "Replied to alice: Voice message"


def test_reply_voice_summary_snippet():
    raw = "[REPLY:bob:🎤|Meeting at 3pm]\nOk"
    assert format_chat_message_preview(raw) == "Replied to bob: Ok"


def test_reply_photo_snippet_without_body():
    raw = "[REPLY:alice:📷|/uploads/x.jpg|Sunset]\n"
    assert format_chat_message_preview(raw) == "Replied to alice: Sunset"


def test_story_reply_with_message():
    raw = "[STORY_REPLY:1:image:/static/x.jpg]\nNice shot"
    assert format_chat_message_preview(raw) == "Replied to story: Nice shot"


def test_story_reply_without_message():
    raw = "[STORY_REPLY:1:image:/static/x.jpg]"
    assert format_chat_message_preview(raw) == "Replied to a story"


def test_encrypted_placeholder():
    assert format_chat_message_preview("", is_encrypted=True) == "Encrypted message"
