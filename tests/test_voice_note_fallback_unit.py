"""Unit tests for the voice-note provider fallback chains.

Covers the redundancy added after the 2026-07-25/26 OpenAI incidents:
summary/translation failing over to xAI Grok, transcription failing over
to xAI's STT endpoint, and the shared account-level circuit breaker.

Pure unit tests — no MySQL container, no network. All provider calls are
mocked at the module boundary.
"""

from __future__ import annotations

import types

import pytest

from backend.services import transcription_providers as tp
from backend.services import voice_note_providers as vnp


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    vnp.reset_breakers()
    # Both providers "configured" for every test unless overridden.
    monkeypatch.setattr(vnp, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(vnp, "XAI_API_KEY", "xai-test")
    monkeypatch.setattr(tp, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(tp, "XAI_API_KEY", "xai-test")
    yield
    vnp.reset_breakers()


def _quota_error() -> Exception:
    return RuntimeError(
        "Error code: 429 - {'error': {'code': 'insufficient_quota'}}"
    )


def _fake_chat_client(behavior):
    """Build a stub OpenAI-SDK client whose chat call runs `behavior`."""
    completions = types.SimpleNamespace(create=behavior)
    chat = types.SimpleNamespace(completions=completions)
    return types.SimpleNamespace(chat=chat)


def _chat_response(text, model="stub"):
    message = types.SimpleNamespace(content=text)
    choice = types.SimpleNamespace(message=message)
    usage = types.SimpleNamespace(prompt_tokens=11, completion_tokens=7)
    return types.SimpleNamespace(choices=[choice], usage=usage)


# ── account-level error classification ─────────────────────────────────

def test_is_account_level_error_classification():
    assert vnp.is_account_level_error(_quota_error())
    err_401 = RuntimeError("unauthorized")
    setattr(err_401, "status_code", 401)
    assert vnp.is_account_level_error(err_401)
    assert not vnp.is_account_level_error(RuntimeError("Error code: 500 - server_error"))
    assert not vnp.is_account_level_error(TimeoutError("timed out"))


# ── summary leg ────────────────────────────────────────────────────────

def test_summary_falls_back_to_xai_on_openai_quota(monkeypatch):
    calls = []

    def fake_make_client(provider):
        def create(**kwargs):
            calls.append(provider)
            if provider == "openai":
                raise _quota_error()
            return _chat_response("Resumo do áudio.")
        return _fake_chat_client(create)

    monkeypatch.setattr(vnp, "make_client", fake_make_client)

    result = vnp.summarize_transcript(
        "uma transcrição suficientemente longa para resumir",
        username="paulo",
        language="portuguese",
    )
    assert result is not None
    assert result["text"] == "Resumo do áudio."
    assert result["model"] == vnp.XAI_SUMMARY_MODEL
    assert result["tokens_in"] == 11 and result["tokens_out"] == 7
    assert calls == ["openai", "xai"]

    # Quota error opened the breaker: the next call skips OpenAI entirely.
    calls.clear()
    result2 = vnp.summarize_transcript(
        "outra transcrição suficientemente longa para resumir",
    )
    assert result2 is not None
    assert calls == ["xai"]


def test_summary_transient_error_fails_over_without_tripping_breaker(monkeypatch):
    calls = []

    def fake_make_client(provider):
        def create(**kwargs):
            calls.append(provider)
            if provider == "openai":
                raise RuntimeError("Error code: 500 - server_error")
            return _chat_response("Summary.")
        return _fake_chat_client(create)

    monkeypatch.setattr(vnp, "make_client", fake_make_client)

    assert vnp.summarize_transcript("long enough text to summarize here")["text"] == "Summary."
    # 500 is transient — OpenAI must still be attempted on the next call.
    calls.clear()
    vnp.summarize_transcript("another long enough text to summarize")
    assert calls[0] == "openai"


def test_summary_returns_none_when_all_providers_fail(monkeypatch):
    def fake_make_client(provider):
        def create(**kwargs):
            raise RuntimeError("boom")
        return _fake_chat_client(create)

    monkeypatch.setattr(vnp, "make_client", fake_make_client)
    assert vnp.summarize_transcript("long enough text to summarize here") is None


def test_short_text_never_calls_a_provider(monkeypatch):
    def explode(provider):
        raise AssertionError("provider should not be called")

    monkeypatch.setattr(vnp, "make_client", explode)
    assert vnp.summarize_transcript("too short") is None


# ── translation leg ────────────────────────────────────────────────────

def test_translate_falls_back_to_xai(monkeypatch):
    def fake_make_client(provider):
        def create(**kwargs):
            if provider == "openai":
                raise _quota_error()
            return _chat_response("Texto traduzido.")
        return _fake_chat_client(create)

    monkeypatch.setattr(vnp, "make_client", fake_make_client)
    result = vnp.translate_text("Some summary", "European Portuguese (Portugal)")
    assert result["text"] == "Texto traduzido."
    assert result["model"] == vnp.XAI_SUMMARY_MODEL


# ── transcription leg ──────────────────────────────────────────────────

def test_transcription_falls_back_to_xai_stt(monkeypatch):
    def openai_fails(path):
        raise _quota_error()

    def xai_succeeds(path):
        return {
            "text": "olá, tudo bem",
            "language": "portuguese",
            "duration_seconds": 12.34,
            "model": tp.XAI_STT_MODEL_LABEL,
            "provider": "xai",
        }

    monkeypatch.setattr(tp, "_transcribe_openai", openai_fails)
    monkeypatch.setattr(tp, "_transcribe_xai", xai_succeeds)

    result = tp.transcribe_audio("https://media.example/voice.mp4")
    assert result is not None
    assert result["model"] == tp.XAI_STT_MODEL_LABEL
    assert result["language"] == "portuguese"
    assert result["duration_seconds"] == 12.34

    # The breaker is shared with the chat legs: after the STT quota error,
    # the summary chain must skip OpenAI too (same dead account).
    assert vnp.provider_is_down("openai")


def test_transcription_returns_none_when_all_fail(monkeypatch):
    monkeypatch.setattr(tp, "_transcribe_openai", lambda p: (_ for _ in ()).throw(RuntimeError("x")))
    monkeypatch.setattr(tp, "_transcribe_xai", lambda p: None)
    assert tp.transcribe_audio("voice.mp4") is None


def test_xai_stt_response_parsing(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {
                "text": " Hello there. ",
                "language": "English",
                "duration": 3.45,
                "words": [],
            }

    def fake_post(url, headers=None, data=None, files=None, timeout=None):
        captured.update(url=url, data=data, files=files)
        return FakeResponse()

    monkeypatch.setattr("requests.post", fake_post)

    result = tp._transcribe_xai("https://media.c-point.co/voice_messages/x.mp4")
    assert captured["url"] == tp.XAI_STT_URL
    # Remote files go via the url field — xAI downloads server-side.
    assert captured["data"] == {"url": "https://media.c-point.co/voice_messages/x.mp4"}
    assert result["text"] == "Hello there."
    # Capitalised language name is normalised to Whisper's lowercase form.
    assert result["language"] == "english"
    assert result["duration_seconds"] == 3.45
    assert result["model"] == tp.XAI_STT_MODEL_LABEL


# ── cost accounting ────────────────────────────────────────────────────

def test_stt_cost_by_provider():
    # whisper-1: whole-minute billing at $0.006/min.
    assert tp.stt_cost_usd("whisper-1", 61) == pytest.approx(0.012)
    # grok-stt: $0.10/hour pro-rated.
    assert tp.stt_cost_usd(tp.XAI_STT_MODEL_LABEL, 3600) == pytest.approx(0.10)
    assert tp.stt_cost_usd(tp.XAI_STT_MODEL_LABEL, 60) == pytest.approx(0.10 / 60, abs=1e-6)
    assert tp.stt_cost_usd("whisper-1", 0) == 0.0


# ── configuration gating ───────────────────────────────────────────────

def test_no_providers_configured(monkeypatch):
    monkeypatch.setattr(vnp, "OPENAI_API_KEY", "")
    monkeypatch.setattr(vnp, "XAI_API_KEY", "")
    monkeypatch.setattr(tp, "OPENAI_API_KEY", "")
    monkeypatch.setattr(tp, "XAI_API_KEY", "")
    assert vnp.summarize_transcript("long enough text to summarize here") is None
    assert tp.transcribe_audio("voice.mp4") is None
    assert not vnp.any_chat_provider_configured()
