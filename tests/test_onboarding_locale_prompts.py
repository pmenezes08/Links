"""Locale threading into the onboarding LLM prompts.

A pt-PT user must get pt-PT AI prose (bio, redirect) — the prompts append
prompt_language_instruction(locale), resolved via X-CPoint-Locale /
users.preferred_locale. Also locks the product name in Steve's redirect
grounding ("C-Point", never "CPoint").
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

from backend.blueprints.onboarding import onboarding_bp
from tests.fixtures import make_user


@pytest.fixture
def client(mysql_dsn):
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(onboarding_bp)
    with app.test_client() as c:
        yield c


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _capture_llm(monkeypatch, content: str = "ok"):
    """Enable the LLM path and capture every messages list passed to it."""
    monkeypatch.setattr("backend.blueprints.onboarding.ONBOARDING_XAI_API_KEY", "test-key")
    calls: list[list[dict]] = []

    def fake_completion(messages, **kwargs):
        calls.append(messages)
        resp = MagicMock()
        resp.choices = [MagicMock(message=MagicMock(content=content))]
        resp.usage = SimpleNamespace(prompt_tokens=10, completion_tokens=5)
        return resp, "grok-4.3"

    monkeypatch.setattr(
        "backend.blueprints.onboarding.run_onboarding_chat_completion", fake_completion
    )
    return calls


def test_compose_bio_prompt_carries_recipient_language(client, monkeypatch):
    make_user("loc_bio")
    _login(client, "loc_bio")
    calls = _capture_llm(monkeypatch, content="Uma bio calorosa.")

    resp = client.post(
        "/api/onboarding/compose_bio",
        json={"kind": "personal", "talk_all_day": "vinho e história"},
        headers={"X-CPoint-Locale": "pt-PT"},
    )
    assert resp.status_code == 200
    system_prompt = calls[0][0]["content"]
    assert "European Portuguese" in system_prompt
    assert "você" in system_prompt


def test_compose_bio_prompt_stays_english_for_en(client, monkeypatch):
    make_user("loc_bio_en")
    _login(client, "loc_bio_en")
    calls = _capture_llm(monkeypatch, content="A warm bio.")

    resp = client.post(
        "/api/onboarding/compose_bio",
        json={"kind": "personal", "talk_all_day": "wine and history"},
        headers={"X-CPoint-Locale": "en"},
    )
    assert resp.status_code == 200
    system_prompt = calls[0][0]["content"]
    assert "European Portuguese" not in system_prompt
    assert "Write your entire response in" not in system_prompt


def test_redirect_prompt_localized_and_names_product_correctly(client, monkeypatch):
    make_user("loc_redirect")
    _login(client, "loc_redirect")
    calls = _capture_llm(monkeypatch, content="Voltemos ao seu perfil!")

    resp = client.post(
        "/api/onboarding/redirect",
        json={"message": "qual é o tempo hoje?", "stage": "name", "currentQuestion": "Como se chama?"},
        headers={"X-CPoint-Locale": "pt-PT"},
    )
    assert resp.status_code == 200
    system_prompt = calls[0][0]["content"]
    assert "C-Point" in system_prompt
    assert "CPoint" not in system_prompt.replace("C-Point", "")
    assert "European Portuguese" in system_prompt


def test_redirect_canned_fallbacks_resolve_in_recipient_locale(client, monkeypatch):
    make_user("loc_fallback")
    _login(client, "loc_fallback")
    # No API keys → the canned fallback path.
    monkeypatch.setattr("backend.blueprints.onboarding.ONBOARDING_XAI_API_KEY", "")
    monkeypatch.setattr("backend.blueprints.onboarding.ONBOARDING_OPENAI_API_KEY", "")

    resp = client.post(
        "/api/onboarding/redirect",
        json={"message": "olá?", "stage": "name", "currentQuestion": "?"},
        headers={"X-CPoint-Locale": "pt-PT"},
    )
    assert resp.status_code == 200
    msg = resp.get_json()["message"]
    assert "perfil" in msg  # Portuguese copy, not the English fallback
    assert "onboarding.redirect" not in msg  # resolved, not a raw key
