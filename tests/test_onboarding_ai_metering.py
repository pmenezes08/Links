"""Metering tests for onboarding LLM routes.

Invariant (docs/STEVE_AND_VOICE_NOTES.md): every paid AI call writes exactly
one row to ``ai_usage_log`` — success AND failure. These tests lock that in
for the three routes that historically logged nothing (redirect,
resolve_role, resolve_location) and guard against onboarding rows bleeding
into the Steve-surface counters.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

from backend.blueprints.onboarding import onboarding_bp
from backend.services.database import get_db_connection, get_sql_placeholder
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


def _mock_llm_response(content: str):
    resp = MagicMock()
    resp.choices = [MagicMock(message=MagicMock(content=content))]
    resp.usage = SimpleNamespace(prompt_tokens=42, completion_tokens=7)
    return resp


def _usage_rows(username: str):
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT request_type, surface, success, reason_blocked, model
            FROM ai_usage_log WHERE username = {ph} ORDER BY id
            """,
            (username,),
        )
        rows = cur.fetchall()
    out = []
    for row in rows or []:
        if hasattr(row, "keys"):
            out.append(dict(row))
        else:
            out.append(
                {
                    "request_type": row[0],
                    "surface": row[1],
                    "success": row[2],
                    "reason_blocked": row[3],
                    "model": row[4],
                }
            )
    return out


def _fake_monolith_countries(monkeypatch: pytest.MonkeyPatch, countries):
    """Inject a stub ``bodybuilding_app`` module so the resolve_location
    handler's lazy ``from bodybuilding_app import get_cached_countries``
    never imports the real monolith (conftest deliberately avoids it)."""
    import sys
    import types

    fake = types.ModuleType("bodybuilding_app")
    fake.get_cached_countries = lambda: countries
    monkeypatch.setitem(sys.modules, "bodybuilding_app", fake)


def _enable_llm(monkeypatch: pytest.MonkeyPatch, response=None, error: Exception | None = None):
    monkeypatch.setattr("backend.blueprints.onboarding.ONBOARDING_XAI_API_KEY", "test-key")

    def fake_completion(messages, **kwargs):
        if error is not None:
            raise error
        return response, "grok-4.3"

    monkeypatch.setattr(
        "backend.blueprints.onboarding.run_onboarding_chat_completion", fake_completion
    )


# ── redirect ─────────────────────────────────────────────────────────────


def test_redirect_success_logs_exactly_one_row(client, monkeypatch):
    make_user("meter_r1")
    _login(client, "meter_r1")
    _enable_llm(monkeypatch, response=_mock_llm_response("Let's get back to it!"))

    resp = client.post(
        "/api/onboarding/redirect",
        json={"message": "what's the weather?", "stage": "name", "currentQuestion": "Your name?"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    rows = _usage_rows("meter_r1")
    assert len(rows) == 1
    assert rows[0]["request_type"] == "onboarding_redirect"
    assert rows[0]["surface"] == "onboarding_ai"
    assert int(rows[0]["success"]) == 1
    assert rows[0]["model"] == "grok-4.3"


def test_redirect_llm_error_logs_one_failure_row(client, monkeypatch):
    make_user("meter_r2")
    _login(client, "meter_r2")
    _enable_llm(monkeypatch, error=RuntimeError("grok down"))

    resp = client.post(
        "/api/onboarding/redirect",
        json={"message": "off topic", "stage": "name", "currentQuestion": "Your name?"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True  # graceful fallback, no error wall

    rows = _usage_rows("meter_r2")
    assert len(rows) == 1
    assert int(rows[0]["success"]) == 0
    assert rows[0]["reason_blocked"] == "onboarding_redirect_error"


def test_redirect_daily_cap_blocks_and_logs(client, monkeypatch):
    make_user("meter_r3")
    _login(client, "meter_r3")
    _enable_llm(monkeypatch, response=_mock_llm_response("Back to setup!"))
    monkeypatch.setattr("backend.blueprints.onboarding.ONBOARDING_REDIRECT_DAILY_CAP", 1)

    first = client.post(
        "/api/onboarding/redirect",
        json={"message": "q1", "stage": "name", "currentQuestion": "?"},
    )
    assert first.status_code == 200

    second = client.post(
        "/api/onboarding/redirect",
        json={"message": "q2", "stage": "name", "currentQuestion": "?"},
    )
    assert second.status_code == 200
    body = second.get_json()
    assert body["success"] is True
    assert "profile" in body["message"].lower()  # canned deflection, not an LLM reply

    rows = _usage_rows("meter_r3")
    assert len(rows) == 2
    assert int(rows[0]["success"]) == 1
    assert rows[1]["request_type"] == "blocked:onboarding_redirect_daily_cap"
    assert int(rows[1]["success"]) == 0
    assert rows[1]["reason_blocked"] == "onboarding_redirect_daily_cap"


# ── resolve_role ─────────────────────────────────────────────────────────


def test_resolve_role_success_logs_exactly_one_row(client, monkeypatch):
    make_user("meter_role1")
    _login(client, "meter_role1")
    _enable_llm(
        monkeypatch,
        response=_mock_llm_response('{"role": "Product Manager", "company": "Acme"}'),
    )

    resp = client.post("/api/onboarding/resolve_role", json={"text": "PM at Acme"})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["role"] == "Product Manager"
    assert body["company"] == "Acme"

    rows = _usage_rows("meter_role1")
    assert len(rows) == 1
    assert rows[0]["request_type"] == "onboarding_resolve_role"
    assert int(rows[0]["success"]) == 1


def test_resolve_role_parse_failure_logs_one_row(client, monkeypatch):
    make_user("meter_role2")
    _login(client, "meter_role2")
    _enable_llm(monkeypatch, response=_mock_llm_response("not json at all"))

    resp = client.post("/api/onboarding/resolve_role", json={"text": "PM at Acme"})
    assert resp.status_code == 200
    assert resp.get_json()["role"] == "PM at Acme"  # falls back to raw input

    rows = _usage_rows("meter_role2")
    assert len(rows) == 1
    assert int(rows[0]["success"]) == 0
    assert rows[0]["reason_blocked"] == "onboarding_resolve_role_parse"


def test_resolve_role_llm_error_logs_one_failure_row(client, monkeypatch):
    make_user("meter_role3")
    _login(client, "meter_role3")
    _enable_llm(monkeypatch, error=RuntimeError("boom"))

    resp = client.post("/api/onboarding/resolve_role", json={"text": "PM at Acme"})
    assert resp.status_code == 200

    rows = _usage_rows("meter_role3")
    assert len(rows) == 1
    assert int(rows[0]["success"]) == 0
    assert rows[0]["reason_blocked"] == "onboarding_resolve_role_error"


# ── resolve_location ─────────────────────────────────────────────────────


def test_resolve_location_success_logs_exactly_one_row(client, monkeypatch):
    make_user("meter_loc1")
    _login(client, "meter_loc1")
    _enable_llm(
        monkeypatch,
        response=_mock_llm_response(
            '{"city": "Lisbon", "country": "Portugal", "type": "city_and_country"}'
        ),
    )
    _fake_monolith_countries(monkeypatch, [])

    resp = client.post("/api/onboarding/resolve_location", json={"city": "Lisboa"})
    assert resp.status_code == 200
    assert resp.get_json()["city"] == "Lisbon"

    rows = _usage_rows("meter_loc1")
    assert len(rows) == 1
    assert rows[0]["request_type"] == "onboarding_resolve_location"
    assert int(rows[0]["success"]) == 1


def test_resolve_location_country_shortcircuit_logs_nothing(client, monkeypatch):
    make_user("meter_loc2")
    _login(client, "meter_loc2")
    _enable_llm(monkeypatch, response=_mock_llm_response("should never be called"))
    _fake_monolith_countries(monkeypatch, [{"name": "Portugal"}])

    resp = client.post("/api/onboarding/resolve_location", json={"city": "Portugal"})
    assert resp.status_code == 200
    assert resp.get_json()["type"] == "country_only"

    assert _usage_rows("meter_loc2") == []  # no LLM call → no row


# ── surface bleed guard ──────────────────────────────────────────────────


def test_state_endpoints_emit_zero_ai_usage_rows(client, monkeypatch):
    """Onboarding state GET/POST must never write ai_usage rows, and
    onboarding_ai rows must never count against Steve allowances."""
    make_user("meter_bleed")
    _login(client, "meter_bleed")
    monkeypatch.setattr("backend.blueprints.onboarding._get_firestore_client", lambda: None)

    client.get("/api/onboarding/state")
    client.post("/api/onboarding/state", json={"stage": "name", "collected": {}})
    assert _usage_rows("meter_bleed") == []

    # And a successful onboarding_ai row does not feed the Steve counters.
    from backend.services import ai_usage

    ai_usage.log_usage(
        "meter_bleed",
        surface=ai_usage.SURFACE_ONBOARDING_AI,
        request_type="onboarding_redirect",
        success=True,
        model="grok-4.3",
    )
    assert ai_usage.daily_count("meter_bleed") == 0
    assert ai_usage.daily_request_type_count(
        "meter_bleed", ai_usage.SURFACE_ONBOARDING_AI, "onboarding_redirect"
    ) == 1
