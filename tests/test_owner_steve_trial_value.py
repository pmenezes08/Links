"""Steve package trial — KB-driven duration + owner value reporting.

Three invariants for the conversion moment on the Owner Dashboard:

1. **Trial length lives in the KB** (``community-tiers.steve_package_trial_days``)
   — operators can tune it without a deploy; the module constant is only the
   fallback when the KB is unreadable.
2. **The `steve_trial` metric is owner-only and root-only** — billing is the
   owner's business; delegated admins never receive it, sub-communities never
   compute it.
3. **The trial-ending Steve action fires only in the final days** and carries
   the ``upgrade_steve`` behavior id the client wires to the upgrade flow.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from backend.services import community_billing, knowledge_base as kb
from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user

pytestmark = pytest.mark.usefixtures("mysql_dsn")


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _overview(client, community_id: int):
    return client.get(f"/api/community/{community_id}/analytics/overview")


def _by_id(body):
    return {m["id"]: m for m in body["metrics"]}


def _set_kb_trial_days(days: int) -> None:
    kb.seed_default_pages(force=True)
    page = kb.get_page("community-tiers") or {}
    fields = list(page.get("fields") or [])
    for f in fields:
        if f.get("name") == "steve_package_trial_days":
            f["value"] = days
    kb.save_page("community-tiers", fields=fields,
                 reason="test-fixture", actor_username="test-fixture")


def _set_trial_period_end(community_id: int, end: datetime) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE communities SET steve_package_current_period_end = {ph} WHERE id = {ph}",
            (end.strftime("%Y-%m-%d %H:%M:%S"), community_id),
        )
        conn.commit()


# ── 1. KB-driven duration ───────────────────────────────────────────────


class TestTrialDuration:
    def test_kb_value_wins(self):
        _set_kb_trial_days(21)
        assert community_billing.steve_package_trial_days() == 21

    def test_fallback_when_kb_unset_or_invalid(self):
        _set_kb_trial_days(0)  # invalid → fallback constant
        assert community_billing.steve_package_trial_days() == \
            community_billing.STEVE_PACKAGE_TRIAL_DAYS

    def test_grant_uses_kb_days(self):
        _set_kb_trial_days(21)
        make_user("trial_owner")
        cid = make_community("c-trial-days", creator_username="trial_owner")
        community_billing.ensure_tables()
        assert community_billing.grant_steve_package_trial(cid) is True

        state = community_billing.get_billing_state(cid) or {}
        assert community_billing.is_synthetic_steve_package_trial(state)
        raw_end = str(state.get("steve_package_current_period_end"))
        period_end = datetime.fromisoformat(raw_end)
        delta_days = (period_end - datetime.utcnow()).total_seconds() / 86400
        assert 20 <= delta_days <= 21.1


# ── 2. Owner Dashboard trial/value metric ───────────────────────────────


def _granted_root(name: str, owner: str) -> int:
    make_user(owner)
    cid = make_community(name, creator_username=owner)
    community_billing.ensure_tables()
    kb.seed_default_pages()
    assert community_billing.grant_steve_package_trial(cid) is True
    return cid


class TestSteveTrialMetric:
    def test_owner_sees_trial_metric(self, mysql_dsn):
        import bodybuilding_app

        cid = _granted_root("c-trial-metric", "sv_owner")
        client = bodybuilding_app.app.test_client()
        _login(client, "sv_owner")
        resp = _overview(client, cid)
        assert resp.status_code == 200
        metrics = _by_id(resp.get_json())

        assert "steve_trial" in metrics
        m = metrics["steve_trial"]
        assert m["format"] == "steve_value"
        assert m["owner_only"] is True
        v = m["value"]
        assert v["is_trial"] is True
        assert isinstance(v["trial_days_left"], int)
        assert v["trial_total_days"] == community_billing.steve_package_trial_days()
        # Aggregates only — the block must never name members.
        assert "usernames" not in str(v)

    def test_no_package_no_metric(self, mysql_dsn):
        import bodybuilding_app

        make_user("sv_plain")
        cid = make_community("c-no-pkg", creator_username="sv_plain")
        community_billing.ensure_tables()
        client = bodybuilding_app.app.test_client()
        _login(client, "sv_plain")
        resp = _overview(client, cid)
        assert resp.status_code == 200
        assert "steve_trial" not in _by_id(resp.get_json())

    def test_delegated_admin_never_sees_it(self, mysql_dsn):
        import bodybuilding_app

        cid = _granted_root("c-trial-admin", "sv_owner2")
        make_user("sv_admin")
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"INSERT INTO community_admins (community_id, username, appointed_by)"
                f" VALUES ({ph}, {ph}, {ph})",
                (cid, "sv_admin", "sv_owner2"),
            )
            conn.commit()

        client = bodybuilding_app.app.test_client()
        _login(client, "sv_admin")
        resp = _overview(client, cid)
        assert resp.status_code == 200
        assert "steve_trial" not in _by_id(resp.get_json())


# ── 3. Trial-ending Steve action ────────────────────────────────────────


class TestTrialEndingAction:
    def _actions(self, client, cid):
        resp = _overview(client, cid)
        assert resp.status_code == 200
        return resp.get_json()["steve"].get("actions") or []

    def test_action_fires_in_final_days(self, mysql_dsn):
        import bodybuilding_app

        cid = _granted_root("c-trial-ending", "sv_owner3")
        _set_trial_period_end(cid, datetime.utcnow() + timedelta(days=2))
        # Post so the community isn't low_data (low_data suppresses actions).
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"INSERT INTO posts (community_id, username, content) VALUES ({ph}, {ph}, {ph})",
                (cid, "sv_owner3", "hello"),
            )
            conn.commit()

        client = bodybuilding_app.app.test_client()
        _login(client, "sv_owner3")
        actions = self._actions(client, cid)
        trial_actions = [a for a in actions
                         if a["key"] == "owner.steve.action_trial_ending"]
        assert len(trial_actions) == 1
        assert trial_actions[0]["action"] == "upgrade_steve"
        assert trial_actions[0]["params"]["days"] == 2

    def test_action_absent_mid_trial(self, mysql_dsn):
        import bodybuilding_app

        cid = _granted_root("c-trial-mid", "sv_owner4")
        _set_trial_period_end(cid, datetime.utcnow() + timedelta(days=10))
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"INSERT INTO posts (community_id, username, content) VALUES ({ph}, {ph}, {ph})",
                (cid, "sv_owner4", "hello"),
            )
            conn.commit()

        client = bodybuilding_app.app.test_client()
        _login(client, "sv_owner4")
        actions = self._actions(client, cid)
        assert all(a["key"] != "owner.steve.action_trial_ending" for a in actions)
