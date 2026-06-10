"""HTTP coverage for the 18+ age gate endpoints (Option A).

The client-side gate (client/src/components/onboarding/AgeGate.tsx) decides
whether to render based on GET /api/me/age-gate and records the outcome via
POST /api/me/age-confirmation. See docs/COMPLIANCE_AGE_GATE.md.
"""

from __future__ import annotations

from tests.fixtures import make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def test_age_gate_status_requires_auth(mysql_dsn):
    import bodybuilding_app

    client = bodybuilding_app.app.test_client()
    resp = client.get("/api/me/age-gate")
    assert resp.status_code == 401


def test_age_gate_pending_then_confirmed(mysql_dsn):
    import bodybuilding_app

    make_user("age_gate_user", subscription="free")
    client = bodybuilding_app.app.test_client()
    _login(client, "age_gate_user")

    resp = client.get("/api/me/age-gate")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["status"] == "pending"
    assert body["age_confirmed_at"] is None

    confirm = client.post("/api/me/age-confirmation", json={"confirmed": True})
    assert confirm.status_code == 200
    confirm_body = confirm.get_json()
    assert confirm_body["success"] is True
    assert confirm_body["status"] == "confirmed"
    assert confirm_body["age_confirmed_at"]

    resp2 = client.get("/api/me/age-gate")
    assert resp2.status_code == 200
    body2 = resp2.get_json()
    assert body2["status"] == "confirmed"
    assert body2["age_confirmed_at"]

    # Idempotent re-confirm.
    confirm2 = client.post("/api/me/age-confirmation", json={"confirmed": True})
    assert confirm2.status_code == 200
    assert confirm2.get_json().get("already_confirmed") is True


def test_age_gate_underage_schedules_deletion_and_revokes_session(mysql_dsn):
    import bodybuilding_app

    make_user("age_gate_minor", subscription="free")
    client = bodybuilding_app.app.test_client()
    _login(client, "age_gate_minor")

    resp = client.post("/api/me/age-confirmation", json={"confirmed": False})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["status"] == "scheduled_deletion"
    assert body["purge_at"]

    # Session was revoked by the underage path.
    status = client.get("/api/me/age-gate")
    assert status.status_code == 401
