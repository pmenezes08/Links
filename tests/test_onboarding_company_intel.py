"""Tests for onboarding company intel (xAI Responses + OpenAI fallback)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from backend.services import onboarding_company_intel as oci
from backend.services.onboarding_company_intel import fetch_company_intel_blurb


def test_fetch_company_intel_xai_success(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(oci, "XAI_API_KEY", "xai-key")
    monkeypatch.setattr(oci, "OPENAI_API_KEY", "")
    monkeypatch.setattr(oci, "GROK_MODEL", "grok-test-model")

    resp = MagicMock()
    resp.output_text = '{"company_intel": "Acme makes widgets."}'
    inst = MagicMock()
    inst.responses.create.return_value = resp

    with patch.object(oci, "OpenAI", return_value=inst):
        text, r, mid = fetch_company_intel_blurb("Acme")

    assert text == "Acme makes widgets."
    assert r is resp
    assert mid == "grok-test-model"
    inst.responses.create.assert_called_once()


def test_fetch_company_intel_openai_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(oci, "XAI_API_KEY", "")
    monkeypatch.setattr(oci, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(oci, "OPENAI_COMPANY_INTEL_MODEL", "gpt-ci-only")

    resp = MagicMock()
    resp.output_text = '{"company_intel": "OpenAI-only blurb."}'
    inst = MagicMock()
    inst.responses.create.return_value = resp

    with patch.object(oci, "OpenAI", return_value=inst):
        text, r, mid = fetch_company_intel_blurb("Contoso")

    assert text == "OpenAI-only blurb."
    assert r is resp
    assert mid == "gpt-ci-only"
    inst.responses.create.assert_called_once()


def test_fetch_company_intel_openai_fallback_when_xai_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(oci, "XAI_API_KEY", "xai-key")
    monkeypatch.setattr(oci, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(oci, "GROK_MODEL", "grok-primary")
    monkeypatch.setattr(oci, "OPENAI_COMPANY_INTEL_MODEL", "gpt-fallback-model")

    xai_resp = MagicMock()
    xai_resp.output_text = '{"company_intel": ""}'
    oai_resp = MagicMock()
    oai_resp.output_text = '{"company_intel": "Recovered via OpenAI."}'

    xai_inst = MagicMock()
    xai_inst.responses.create.return_value = xai_resp
    oai_inst = MagicMock()
    oai_inst.responses.create.return_value = oai_resp

    def client_factory(**kwargs):
        if kwargs.get("base_url"):
            return xai_inst
        return oai_inst

    with patch.object(oci, "OpenAI", side_effect=client_factory):
        text, r, mid = fetch_company_intel_blurb("Fabrikam", role="Engineer")

    assert text == "Recovered via OpenAI."
    assert r is oai_resp
    assert mid == "gpt-fallback-model"
    xai_inst.responses.create.assert_called_once()
    oai_inst.responses.create.assert_called_once()


def test_fetch_company_intel_both_paths_fail_returns_empty_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(oci, "XAI_API_KEY", "xai-key")
    monkeypatch.setattr(oci, "OPENAI_API_KEY", "sk-test")

    xai_inst = MagicMock()
    xai_inst.responses.create.side_effect = RuntimeError("xai down")

    bad_oai = MagicMock()
    bad_oai.output_text = '{"company_intel": ""}'
    oai_inst = MagicMock()
    oai_inst.responses.create.return_value = bad_oai

    def client_factory(**kwargs):
        if kwargs.get("base_url"):
            return xai_inst
        return oai_inst

    with patch.object(oci, "OpenAI", side_effect=client_factory):
        text, r, mid = fetch_company_intel_blurb("UnknownCo")

    assert text == ""
    assert r is None
    assert mid == ""
