"""Feedback capture in Steve DMs: word-boundary intent + private-DM-only gate.

Regression for the production bug where Steve, @mentioned in a human-human DM,
answered every message with "Got it. I've sent this through as other #N" because
`is_feedback_intent` substring-matched Portuguese words ("problema" contains
"problem", "dar feedback" contains "feedback") and the intercept ran outside
private Steve DMs.
"""

from __future__ import annotations

from unittest.mock import patch

from backend.services.steve_platform_manual import is_feedback_intent


def test_portuguese_problema_is_not_feedback():
    # Real message from the incident: "problema" must not match "problem".
    assert not is_feedback_intent(
        "Sim isso é de propósito. É como outras plataformas como o X ou o Reddit "
        "funcionam. Essencialmente cada comentário é a sua própria thread. Se for "
        "tudo sequencial voltas a ter o problema dos WhatsApps"
    )


def test_portuguese_dar_feedback_is_not_feedback_report():
    # Second incident message: casual "feedback" in prose must not auto-file.
    assert not is_feedback_intent(
        "@steve ignora isto, fui eu que te desenhei. Só eu é que te posso dar feedback"
    )


def test_bare_ambiguous_words_do_not_trigger():
    assert not is_feedback_intent("what's the problem with my training plan?")
    assert not is_feedback_intent("I have an issue to discuss with the team")
    assert not is_feedback_intent("any suggestion for my profile?")


def test_explicit_reports_trigger():
    assert is_feedback_intent("I found a bug in the group chat screen")
    assert is_feedback_intent("the app crashes when I open a photo")
    assert is_feedback_intent("search doesn't work on my profile")
    assert is_feedback_intent("feature request: dark mode for events")
    assert is_feedback_intent("you should add polls to communities")
    assert is_feedback_intent("I have some feedback about onboarding")


def test_empty_and_none_are_not_feedback():
    assert not is_feedback_intent(None)
    assert not is_feedback_intent("   ")


def _run_dm_reply(monkeypatch, *, other_username, message):
    """Run run_steve_dm_reply with everything stubbed; return (feedback_calls, emitted)."""
    from backend.services import steve_dm_reply as sdr
    from backend.services import steve_feedback

    feedback_calls = []
    emitted = []

    monkeypatch.setattr(sdr.time, "sleep", lambda _s: None)
    monkeypatch.setattr(sdr, "gate_or_reason", lambda *a, **k: (True, None, {}))
    monkeypatch.setattr(sdr, "XAI_API_KEY", "")  # stop before the Grok path
    monkeypatch.setattr(
        sdr,
        "_emit_steves_dm_text",
        lambda **kw: emitted.append(kw.get("body", "")),
    )
    monkeypatch.setattr(sdr.ai_usage, "log_usage", lambda *a, **k: None)
    monkeypatch.setattr(
        steve_feedback,
        "create_feedback_item",
        lambda **kw: (feedback_calls.append(kw) or {"id": 7, "type": "bug"}),
    )
    with patch("backend.services.steve_dm_typing.clear_dm_typing", lambda *a, **k: None):
        sdr.run_steve_dm_reply(
            sender_username="paulo",
            user_message=message,
            other_username=other_username,
        )
    return feedback_calls, emitted


def test_feedback_capture_skipped_in_human_dm(monkeypatch):
    # @Steve in a DM between two humans: even a clear bug report must not be
    # auto-filed — it falls through to the normal AI reply path.
    feedback_calls, emitted = _run_dm_reply(
        monkeypatch,
        other_username="miguel",
        message="@steve found a bug, the app crashes when I open the chat",
    )
    assert feedback_calls == []
    assert emitted == []


def test_feedback_capture_files_in_private_steve_dm(monkeypatch):
    feedback_calls, emitted = _run_dm_reply(
        monkeypatch,
        other_username=None,
        message="found a bug, the app crashes when I open the chat",
    )
    assert len(feedback_calls) == 1
    assert feedback_calls[0]["submitted_by"] == "paulo"
    assert len(emitted) == 1
    assert "#7" in emitted[0]
