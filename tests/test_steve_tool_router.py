"""Tests for ``steve_tool_router.resolve_steve_hosted_tools`` guardrails and fast path."""

from __future__ import annotations

from types import SimpleNamespace

from backend.services.steve_tool_router import (
    resolve_steve_hosted_tools,
    steve_tool_router_ambiguous_public_web_intent,
)


def _cfg_explicit_only():
    return SimpleNamespace(
        external_search_explicit_only=True,
        web_search_default_enabled=False,
        x_search_default_enabled=False,
        feed_attach_web_search_tool=True,
        feed_attach_x_search_tool=True,
    )


def test_router_skipped_when_platform_question(monkeypatch):
    def _boom(_text):
        raise AssertionError("router LLM must not run")

    monkeypatch.setattr("backend.services.steve_tool_router._call_router_llm", _boom)
    out = resolve_steve_hosted_tools(
        "Something with web and careers and enough length to matter here.",
        username="alice",
        surface="feed",
        platform_question=True,
        professional_advice_question=False,
        config=_cfg_explicit_only(),
    )
    assert out == []


def test_router_skipped_when_professional_only(monkeypatch):
    def _boom(_text):
        raise AssertionError("router LLM must not run")

    monkeypatch.setattr("backend.services.steve_tool_router._call_router_llm", _boom)
    out = resolve_steve_hosted_tools(
        "Medical symptoms and web research with enough chars here for length.",
        username="alice",
        surface="feed",
        platform_question=False,
        professional_advice_question=True,
        config=_cfg_explicit_only(),
    )
    assert out == []


def test_fast_path_when_static_tools_non_empty(monkeypatch):
    def _boom(_text):
        raise AssertionError("router LLM must not run")

    monkeypatch.setattr("backend.services.steve_tool_router._call_router_llm", _boom)
    out = resolve_steve_hosted_tools(
        "What are today's headlines in brief?",
        username="alice",
        surface="feed",
        config=_cfg_explicit_only(),
    )
    assert out and any(t.get("type") == "web_search" for t in out)


def test_router_skipped_for_profile_suppressed_career_mention(monkeypatch):
    def _boom(_text):
        raise AssertionError("router LLM must not run")

    monkeypatch.setattr("backend.services.steve_tool_router._call_router_llm", _boom)
    out = resolve_steve_hosted_tools(
        "@Steve tell me about @alice career and background",
        username="bob",
        surface="group",
        config=_cfg_explicit_only(),
    )
    assert out == []


def test_ambiguous_turn_uses_router_when_static_empty(monkeypatch):
    monkeypatch.setattr(
        "backend.services.steve_tool_router._call_router_llm",
        lambda _t: ({"web_search": True, "x_search": True}, None),
    )
    msg = (
        "Walk through how mid-size analytics vendors position themselves; "
        "pull examples from the public web and search twitter for reactions."
    )
    out = resolve_steve_hosted_tools(
        msg,
        username="alice",
        surface="group",
        config=_cfg_explicit_only(),
    )
    types = {t.get("type") for t in out}
    assert types == {"web_search", "x_search"}


def test_router_strips_x_when_user_did_not_ask_for_x(monkeypatch):
    monkeypatch.setattr(
        "backend.services.steve_tool_router._call_router_llm",
        lambda _t: ({"web_search": True, "x_search": True}, None),
    )
    msg = (
        "Walk through how mid-size analytics vendors position themselves using "
        "public web sources only please."
    )
    out = resolve_steve_hosted_tools(
        msg,
        username="alice",
        surface="group",
        config=_cfg_explicit_only(),
    )
    assert out == [{"type": "web_search"}]


def test_ambiguous_heuristic_false_short_message():
    assert steve_tool_router_ambiguous_public_web_intent("short no web here") is False


def test_kill_switch_env(monkeypatch):
    """STEVE_TOOL_ROUTER_DISABLED regression — exercised under legacy gating so the
    static fast path returns empty and the (disabled) router path is the one under test."""
    monkeypatch.setenv("STEVE_TOOL_ROUTER_DISABLED", "1")
    monkeypatch.setenv("STEVE_LEGACY_TOOL_GATING", "1")

    def _boom(_text):
        raise AssertionError("router LLM must not run when disabled")

    monkeypatch.setattr("backend.services.steve_tool_router._call_router_llm", _boom)
    msg = (
        "Compare employer messaging for EU fintech scaleups using both the web and X; "
        "stay on public sources only please."
    )
    out = resolve_steve_hosted_tools(
        msg,
        username="alice",
        surface="feed",
        config=_cfg_explicit_only(),
    )
    assert out == []


def test_default_attach_fast_path_skips_router_when_disabled(monkeypatch):
    """Under default-attach, the static web_search fast path returns before the router,
    so even with the router disabled the LLM is never invoked."""
    monkeypatch.setenv("STEVE_TOOL_ROUTER_DISABLED", "1")

    def _boom(_text):
        raise AssertionError("router LLM must not run on the static fast path")

    monkeypatch.setattr("backend.services.steve_tool_router._call_router_llm", _boom)
    msg = (
        "Compare employer messaging for EU fintech scaleups using both the web and X; "
        "stay on public sources only please."
    )
    out = resolve_steve_hosted_tools(
        msg,
        username="alice",
        surface="feed",
        config=_cfg_explicit_only(),
    )
    assert out == [{"type": "web_search"}]
