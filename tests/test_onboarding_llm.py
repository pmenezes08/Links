"""Tests for onboarding xAI + OpenAI fallback helper."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from backend.services.onboarding_llm import (
    ONBOARDING_OPENAI_FALLBACK_MODEL,
    extract_json_object_from_llm_text,
    run_onboarding_chat_completion,
)


def test_extract_json_object_from_llm_text_fenced_block() -> None:
    raw = """```json
{"city": "Lisbon", "country": "Portugal", "type": "city_and_country"}
```"""
    d = extract_json_object_from_llm_text(raw)
    assert d["city"] == "Lisbon"
    assert d["country"] == "Portugal"
    assert d["type"] == "city_and_country"


def test_extract_json_object_plain() -> None:
    d = extract_json_object_from_llm_text('{"role": "PM", "company": "Acme"}')
    assert d["role"] == "PM"
    assert d["company"] == "Acme"


def test_run_onboarding_chat_completion_openai_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("backend.services.onboarding_llm.XAI_API_KEY", "")
    monkeypatch.setattr("backend.services.onboarding_llm.OPENAI_API_KEY", "sk-test")

    mock_resp = MagicMock()
    mock_resp.choices = [MagicMock(message=MagicMock(content="ok"))]

    with patch("backend.services.onboarding_llm.OpenAI") as mock_openai:
        inst = MagicMock()
        mock_openai.return_value = inst
        inst.chat.completions.create.return_value = mock_resp
        r, mid = run_onboarding_chat_completion(
            [{"role": "user", "content": "hi"}],
            max_tokens=10,
            temperature=0,
            primary_model="grok-4.3",
        )
    assert r is mock_resp
    assert mid == ONBOARDING_OPENAI_FALLBACK_MODEL
    inst.chat.completions.create.assert_called_once()


def test_run_onboarding_chat_completion_xai_fails_then_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("backend.services.onboarding_llm.XAI_API_KEY", "xai-key")
    monkeypatch.setattr("backend.services.onboarding_llm.OPENAI_API_KEY", "openai-key")

    mock_fallback = MagicMock()
    mock_fallback.choices = [MagicMock(message=MagicMock(content="fallback"))]

    xai_inst = MagicMock()
    xai_inst.chat.completions.create.side_effect = RuntimeError("xai down")
    oai_inst = MagicMock()
    oai_inst.chat.completions.create.return_value = mock_fallback

    def client_factory(*args, **kwargs):
        if kwargs.get("base_url"):
            return xai_inst
        return oai_inst

    with patch("backend.services.onboarding_llm.OpenAI", side_effect=client_factory):
        r, mid = run_onboarding_chat_completion(
            [{"role": "user", "content": "hi"}],
            max_tokens=10,
            temperature=0,
            primary_model="grok-4.3",
        )

    assert r is mock_fallback
    assert mid == ONBOARDING_OPENAI_FALLBACK_MODEL
    xai_inst.chat.completions.create.assert_called_once()
    oai_inst.chat.completions.create.assert_called_once()
