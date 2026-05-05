"""HTTP tests for onboarding save_field allowlist (professional_company_intel)."""

from __future__ import annotations

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


def test_onboarding_save_field_persists_professional_company_intel(client):
    make_user("intel_user")
    _login(client, "intel_user")
    payload = "Acme builds widgets for EU teams."
    resp = client.post(
        "/api/onboarding/save_field",
        json={"field": "professional_company_intel", "value": payload},
    )
    assert resp.status_code == 200
    assert resp.get_json() == {"success": True}

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            f"SELECT professional_company_intel FROM users WHERE username = {ph}",
            ("intel_user",),
        )
        row = cur.fetchone()
    val = row["professional_company_intel"] if hasattr(row, "keys") else row[0]
    assert (val or "").strip() == payload
