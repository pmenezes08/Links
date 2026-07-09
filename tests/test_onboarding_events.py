"""Tests for the onboarding funnel events table (backend/services/onboarding_events.py)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from flask import Flask

from backend.blueprints.onboarding import onboarding_bp
from backend.services import onboarding_events
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


def _events(username: str):
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT event, stage, intent FROM onboarding_events
            WHERE username = {ph} ORDER BY id
            """,
            (username,),
        )
        rows = cur.fetchall()
    out = []
    for row in rows or []:
        if hasattr(row, "keys"):
            out.append((row["event"], row["stage"], row["intent"]))
        else:
            out.append((row[0], row[1], row[2]))
    return out


def test_stage_saves_dedupe_consecutive(client, monkeypatch):
    make_user("evt_stage")
    _login(client, "evt_stage")
    monkeypatch.setattr("backend.blueprints.onboarding._get_firestore_client", lambda: None)

    client.post("/api/onboarding/state", json={"stage": "name", "collected": {}})
    client.post("/api/onboarding/state", json={"stage": "name", "collected": {"firstName": "Ana"}})
    client.post("/api/onboarding/state", json={"stage": "location", "collected": {}})

    evts = _events("evt_stage")
    assert evts == [("stage", "name", None), ("stage", "location", None)]


def test_stage_event_captures_intent(client, monkeypatch):
    make_user("evt_intent")
    _login(client, "evt_intent")
    monkeypatch.setattr("backend.blueprints.onboarding._get_firestore_client", lambda: None)

    client.post(
        "/api/onboarding/state",
        json={"stage": "b2b_value", "collected": {}, "onboarding_intent": "b2b"},
    )
    evts = _events("evt_intent")
    assert evts == [("stage", "b2b_value", "b2b")]


def test_defer_emits_deferred_event(client, monkeypatch):
    make_user("evt_defer")
    _login(client, "evt_defer")
    fake_db = MagicMock()
    monkeypatch.setattr(
        "backend.blueprints.onboarding._get_firestore_client", lambda: fake_db
    )

    resp = client.post(
        "/api/onboarding/defer_profile",
        json={"stage": "section_picker", "onboarding_auto_open_suppressed": True},
    )
    assert resp.status_code == 200
    assert _events("evt_defer") == [("deferred", "section_picker", None)]


def test_complete_emits_completed_even_without_firestore(client, monkeypatch):
    make_user("evt_complete")
    _login(client, "evt_complete")
    monkeypatch.setattr("backend.blueprints.onboarding._get_firestore_client", lambda: None)

    resp = client.post("/api/onboarding/complete")
    assert resp.status_code == 200
    assert _events("evt_complete") == [("completed", None, None)]


def test_record_event_never_raises_without_table(mysql_dsn):
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute("DROP TABLE IF EXISTS onboarding_events")
            conn.commit()
        except Exception:
            pass
    # Force the DDL guard to re-run so the drop is actually exercised, then
    # simulate a broken insert path by dropping again after ensure.
    onboarding_events._SCHEMA_READY = False
    onboarding_events.record_onboarding_event("evt_defensive", "stage", stage="name")

    # A second call with the schema flag lying (table gone, flag set) must
    # swallow the DB error rather than raise.
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute("DROP TABLE IF EXISTS onboarding_events")
            conn.commit()
        except Exception:
            pass
    onboarding_events._SCHEMA_READY = True
    onboarding_events.record_onboarding_event("evt_defensive", "stage", stage="name")

    # Restore for subsequent tests.
    onboarding_events._SCHEMA_READY = False
    onboarding_events.ensure_tables()


def test_dedupe_within_hours_suppresses_repeat(mysql_dsn):
    onboarding_events.ensure_tables()
    onboarding_events.record_onboarding_event(
        "evt_window", "resume_required", dedupe_within_hours=24
    )
    onboarding_events.record_onboarding_event(
        "evt_window", "resume_required", dedupe_within_hours=24
    )
    assert _events("evt_window") == [("resume_required", None, None)]
