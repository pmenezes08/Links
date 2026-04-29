"""Push preview formatting for Steve reminder vault nudges."""

from __future__ import annotations

from backend.services.content_generation.delivery import format_reminder_push_preview


def test_format_reminder_push_preview_quoting():
    s = format_reminder_push_preview("Go to the gym")
    assert s.startswith("Reminder:")
    assert "gym" in s
    assert '"' in s


def test_format_reminder_push_preview_escapes_inner_quotes():
    s = format_reminder_push_preview('Say "hello"')
    assert "hello" in s
    assert s.startswith("Reminder:")
