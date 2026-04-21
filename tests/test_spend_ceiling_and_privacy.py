"""Phase 2 — spend-ceiling enforcement + /api/me/* privacy scrub.

Two orthogonal contracts:

1. :func:`backend.services.entitlements_gate.check_steve_access` blocks
   a user whose month-to-date cost has breached
   ``monthly_spend_ceiling_eur`` — and does so via the existing
   ``REASON_MONTHLY_STEVE_CAP`` reason code so the user is never told
   the real EUR figure. Special users get a higher ceiling but the
   gate still fires eventually.

2. The user-facing ``/api/me/*`` endpoints never leak the internal
   cost-attribution signals. A casual ``curl /api/me/entitlements``
   must not surface ``monthly_spend_ceiling_eur``,
   ``monthly_spend_ceiling_eur_special``, or ``internal_weights``.
   Likewise ``/api/me/ai-usage`` must drop
   ``total_cost_usd``, ``total_tokens_in``, ``total_tokens_out`` from
   the month summary.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from backend.services import ai_usage
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.entitlements_gate import check_steve_access

from tests.fixtures import days_ago, make_user


# ── helpers ─────────────────────────────────────────────────────────────


def _seed_cost_row(username: str, *, cost_usd: float, surface: str = "dm") -> None:
    """Insert one successful ai_usage_log row with the given cost.

    Bypasses :func:`ai_usage.log_usage` so the test can dial the exact
    monthly spend in a single insert.
    """
    ai_usage.ensure_tables()
    ph = get_sql_placeholder()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO ai_usage_log
                (username, request_type, surface, tokens_in, tokens_out,
                 cost_usd, duration_seconds, success, model, created_at)
            VALUES ({ph}, 'chat', {ph}, 100, 100, {ph}, 0, 1, 'grok-4', {ph})
            """,
            (username, surface, Decimal(str(cost_usd)), now),
        )
        try:
            conn.commit()
        except Exception:
            pass


# ── 1. Spend ceiling gate ──────────────────────────────────────────────


class TestSpendCeilingGate:
    """A premium user who burns past €3.99 this month is blocked."""

    def test_premium_below_ceiling_is_allowed(self, mysql_dsn):
        make_user("prem_under", subscription="premium", created_at=days_ago(60))
        # Seed $1.00 of spend — well below €3.99 ceiling.
        _seed_cost_row("prem_under", cost_usd=1.00)

        allowed, payload, status, ent = check_steve_access("prem_under", "dm")
        assert allowed is True
        assert payload is None

    def test_premium_at_ceiling_is_blocked(self, mysql_dsn):
        make_user("prem_over", subscription="premium", created_at=days_ago(60))
        # Seed $10 of spend; at rate 0.92 that's €9.20, well over €3.99.
        _seed_cost_row("prem_over", cost_usd=10.00)

        allowed, payload, status, ent = check_steve_access("prem_over", "dm")
        assert allowed is False
        assert status in (402, 429)  # whichever the errors module maps

    def test_blocked_payload_reuses_monthly_steve_reason(self, mysql_dsn):
        """The response must NOT reveal 'spend_ceiling' as the reason.

        This is the whole point of the scope-B work: the user must
        never be able to work backwards from an error message to the
        EUR budget of their plan.
        """
        make_user("prem_stealth", subscription="premium", created_at=days_ago(60))
        _seed_cost_row("prem_stealth", cost_usd=10.00)

        allowed, payload, _status, _ent = check_steve_access("prem_stealth", "dm")
        assert allowed is False
        assert payload is not None
        # The code we surface is the generic monthly-Steve cap, shared with
        # the user-facing "you've used all your Steve calls" path.
        reason = payload.get("reason")
        assert reason is not None
        assert "spend" not in str(reason).lower()
        assert "ceiling" not in str(reason).lower()
        # Payload must never contain a literal EUR amount.
        payload_str = str(payload).lower()
        assert "eur" not in payload_str
        assert "€" not in payload_str

    def test_special_user_has_higher_ceiling(self, mysql_dsn):
        """Special users get the 'special' ceiling (50 EUR by default).

        Seed $10 (€9.20) — below the €50 special ceiling, so special
        passes where regular premium got blocked.
        """
        make_user("special_user", subscription="premium", is_special=True,
                  created_at=days_ago(60))
        _seed_cost_row("special_user", cost_usd=10.00)

        allowed, _payload, _status, _ent = check_steve_access("special_user", "dm")
        assert allowed is True


# ── 2. /api/me/* privacy scrub ─────────────────────────────────────────


class TestMeEntitlementsScrub:
    """Internal cost/weight fields must never appear in user-facing responses."""

    @pytest.fixture
    def client(self):
        """Spin up a minimal Flask app just for the me blueprint.

        Avoids importing the whole monolith (300+ routes, slow).
        """
        from flask import Flask

        from backend.blueprints.me import me_bp

        app = Flask(__name__)
        app.secret_key = "test-secret"
        app.register_blueprint(me_bp)

        with app.test_client() as c:
            yield c

    def _login(self, client, username: str) -> None:
        """Seed a valid session for the test client."""
        with client.session_transaction() as sess:
            sess["username"] = username

    def test_me_entitlements_drops_internal_fields(self, mysql_dsn, client):
        make_user("scrub_user", subscription="premium", created_at=days_ago(60))
        self._login(client, "scrub_user")

        resp = client.get("/api/me/entitlements")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True

        ent = body["entitlements"]
        assert "monthly_spend_ceiling_eur" not in ent
        assert "monthly_spend_ceiling_eur_special" not in ent
        assert "internal_weights" not in ent
        # Sanity: the user-visible fields are still there.
        assert "tier" in ent
        assert "steve_uses_per_month" in ent
        assert "whisper_minutes_per_month" in ent

    def test_me_ai_usage_drops_cost_and_weights(self, mysql_dsn, client):
        make_user("scrub_ai", subscription="premium", created_at=days_ago(60))
        self._login(client, "scrub_ai")

        resp = client.get("/api/me/ai-usage")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True

        # Top-level: internal_weights must be gone entirely.
        assert "internal_weights" not in body
        ent = body["entitlements"]
        assert "internal_weights" not in ent
        assert "monthly_spend_ceiling_eur" not in ent

        # month_summary: cost + raw-token counts must be gone.
        summary = body["month_summary"]
        assert "total_cost_usd" not in summary
        assert "total_tokens_in" not in summary
        assert "total_tokens_out" not in summary
        # Sanity: user-visible keys kept.
        assert "by_surface" in summary
        assert "total_calls" in summary

    def test_me_billing_drops_ceiling(self, mysql_dsn, client):
        make_user("scrub_bill", subscription="premium", created_at=days_ago(60))
        self._login(client, "scrub_bill")

        resp = client.get("/api/me/billing")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True

        caps = body["caps"]
        assert "monthly_spend_ceiling_eur" not in caps
        # Sanity: usable caps stay.
        assert "steve_uses_per_month" in caps
        assert "whisper_minutes_per_month" in caps
