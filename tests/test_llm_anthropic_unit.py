"""Unit tests for the Anthropic branch of content_generation.llm.generate_text.

DB-free and SDK-free: the ``anthropic`` package is stubbed via sys.modules so
these run anywhere. Covers the Fable 5 wiring added 2026-07: the server-side
refusal fallback (beta header + ``fallbacks`` body param, Fable/Mythos only)
and the empty-artifact return on a whole-chain refusal.
"""

import sys
import types

import pytest

from backend.services.content_generation import llm


class _FakeTextBlock:
    type = "text"

    def __init__(self, text):
        self.text = text


class _FakeMessage:
    def __init__(self, *, text="<!doctype html><html></html>", model="claude-x",
                 stop_reason="end_turn"):
        self.content = [_FakeTextBlock(text)]
        self.model = model
        self.stop_reason = stop_reason
        self.usage = types.SimpleNamespace(input_tokens=10, output_tokens=20)


@pytest.fixture
def fake_anthropic(monkeypatch):
    """Install a stub ``anthropic`` module; yields the captured create kwargs."""
    captured = {}

    class _Messages:
        def __init__(self, response):
            self._response = response

        def create(self, **kwargs):
            captured.update(kwargs)
            return self._response

    class _Anthropic:
        response = _FakeMessage()

        def __init__(self, api_key=None):
            self.messages = _Messages(type(self).response)

    module = types.ModuleType("anthropic")
    module.Anthropic = _Anthropic
    monkeypatch.setitem(sys.modules, "anthropic", module)
    monkeypatch.setattr(llm, "ANTHROPIC_API_KEY", "test-key")
    captured["_anthropic_cls"] = _Anthropic
    return captured


def test_fable_sends_server_side_fallback(fake_anthropic):
    fake_anthropic["_anthropic_cls"].response = _FakeMessage(model="claude-fable-5")
    out = llm.generate_text("sys", "user", model="claude-fable-5")
    assert out == "<!doctype html><html></html>"
    assert fake_anthropic["extra_headers"] == {
        "anthropic-beta": "server-side-fallback-2026-06-01"}
    assert fake_anthropic["extra_body"] == {
        "fallbacks": [{"model": "claude-opus-4-8"}]}


def test_opus_does_not_send_fallback(fake_anthropic):
    fake_anthropic["_anthropic_cls"].response = _FakeMessage(model="claude-opus-4-8")
    out = llm.generate_text("sys", "user", model="claude-opus-4-8")
    assert out == "<!doctype html><html></html>"
    assert "extra_headers" not in fake_anthropic
    assert "extra_body" not in fake_anthropic


def test_refusal_returns_empty(fake_anthropic):
    fake_anthropic["_anthropic_cls"].response = _FakeMessage(
        model="claude-fable-5", stop_reason="refusal")
    out = llm.generate_text("sys", "user", model="claude-fable-5")
    assert out == ""  # builder treats empty as failure → falls back to fast tier


def test_missing_key_raises(monkeypatch, fake_anthropic):
    monkeypatch.setattr(llm, "ANTHROPIC_API_KEY", "")
    with pytest.raises(RuntimeError):
        llm.generate_text("sys", "user", model="claude-fable-5")
