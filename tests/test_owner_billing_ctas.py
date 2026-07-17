"""Owner CTA notifications (Steve Community Package billing moments).

Covers the three founder-ratified triggers:

* trial lifecycle cron (``/api/cron/steve-trial-lifecycle``): auth, T-3 /
  expired selection, forever-idempotency via ``subscription_audit_log``;
* member blocked in a paid, package-less community: fires once per 7 days,
  never for the owner's own denial, never for free communities;
* pool exhausted: once per community per billing-cycle month.

Container tests (``mysql_dsn``) drive the cron route and the service against
real tables with the push transport monkeypatched; the gate-wiring tests are
pure (everything DB-touching stubbed) so they also run without Docker.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

import redis_cache
from backend.services.database import get_db_connection, get_sql_placeholder

CRON_SECRET = "test-cron-secret"


class _StubCache:
    """Deterministic in-memory stand-in for the rate-limit counter."""

    def __init__(self):
        self.counts = {}

    def incr(self, key, ttl=None):
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]


@pytest.fixture()
def stub_rate_limit_cache(monkeypatch):
    stub = _StubCache()
    monkeypatch.setattr(redis_cache, "cache", stub)
    return stub


@pytest.fixture()
def capture_push(monkeypatch):
    import backend.services.notifications as notif

    sent = []

    def fake_push(username, payload):
        sent.append({"username": username, **(payload or {})})

    monkeypatch.setattr(notif, "send_push_to_user", fake_push)
    return sent


@pytest.fixture()
def cta_env(monkeypatch):
    monkeypatch.setenv("CRON_SHARED_SECRET", CRON_SECRET)
    monkeypatch.setenv("ENTITLEMENTS_ENFORCEMENT_ENABLED", "true")


def _set_trial(community_id: int, period_end: datetime) -> None:
    from backend.services import community_billing

    community_billing.ensure_tables()
    assert community_billing.mark_steve_package_subscription(
        community_id,
        subscription_id=f"trial_pkg_{community_id}",
        status="trialing",
        current_period_end=period_end.strftime("%Y-%m-%d %H:%M:%S"),
    )


def _notification_rows(username: str, notif_type: str):
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT link, community_id FROM notifications WHERE user_id = {ph} AND type = {ph}",
            (username, notif_type),
        )
        return [
            {
                "link": r["link"] if hasattr(r, "keys") else r[0],
                "community_id": r["community_id"] if hasattr(r, "keys") else r[1],
            }
            for r in (c.fetchall() or [])
        ]


def _audit_count(action: str) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT COUNT(*) AS n FROM subscription_audit_log WHERE action = {ph}",
                (action,),
            )
            row = c.fetchone()
        except Exception:
            return 0
    return int(row["n"] if hasattr(row, "keys") else row[0])


def _run_cron(client, *, dry_run=False, secret=CRON_SECRET):
    qs = "?dry_run=1" if dry_run else ""
    headers = {"X-Cron-Secret": secret} if secret else {}
    return client.post(f"/api/cron/steve-trial-lifecycle{qs}", headers=headers)


# ── Trigger 1 — trial lifecycle cron ─────────────────────────────────────


def test_cron_rejects_wrong_or_missing_secret(mysql_dsn, cta_env):
    import bodybuilding_app

    client = bodybuilding_app.app.test_client()
    assert _run_cron(client, secret=None).status_code == 403
    assert _run_cron(client, secret="wrong").status_code == 403


def test_sweep_selects_t3_and_expired_and_is_idempotent(mysql_dsn, cta_env, capture_push):
    import bodybuilding_app
    from tests.fixtures import make_community, make_user

    make_user("cta_owner_soon")
    make_user("cta_owner_gone")
    make_user("cta_owner_far")
    ending = make_community("CTA Ending", creator_username="cta_owner_soon")
    expired = make_community("CTA Expired", creator_username="cta_owner_gone")
    far = make_community("CTA Far", creator_username="cta_owner_far")
    now = datetime.utcnow()
    _set_trial(ending, now + timedelta(days=2))
    _set_trial(expired, now - timedelta(days=1))
    _set_trial(far, now + timedelta(days=10))

    client = bodybuilding_app.app.test_client()
    resp = _run_cron(client)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["ending_soon_sent"] == 1
    assert body["expired_sent"] == 1
    assert body["skipped_not_due"] >= 1

    expected_link_ending = f"/subscription_plans?open=community_addons&community_id={ending}"
    rows = _notification_rows("cta_owner_soon", "owner_cta:steve_trial_ending")
    assert len(rows) == 1 and rows[0]["link"] == expected_link_ending
    rows = _notification_rows("cta_owner_gone", "owner_cta:steve_trial_expired")
    assert len(rows) == 1
    assert not _notification_rows("cta_owner_far", "owner_cta:steve_trial_ending")

    pushes = [p for p in capture_push if p["username"] == "cta_owner_soon"]
    assert len(pushes) == 1 and pushes[0]["url"] == expected_link_ending

    assert _audit_count("owner_cta_steve_trial_ending") == 1
    assert _audit_count("owner_cta_steve_trial_expired") == 1

    # Second run: audit rows are the forever-dedup marker — nothing sends.
    body2 = _run_cron(client).get_json()
    assert body2["ending_soon_sent"] == 0
    assert body2["expired_sent"] == 0
    assert body2["skipped_already_sent"] >= 2
    assert len([p for p in capture_push if p["username"] == "cta_owner_soon"]) == 1


def test_sweep_expired_trial_still_notifies_after_ending_soon(mysql_dsn, cta_env, capture_push):
    """'Ending soon' and 'ended' are separate once-ever events for a community."""
    import bodybuilding_app
    from tests.fixtures import make_community, make_user

    make_user("cta_owner_both")
    cid = make_community("CTA Both", creator_username="cta_owner_both")
    _set_trial(cid, datetime.utcnow() + timedelta(days=1))

    client = bodybuilding_app.app.test_client()
    assert _run_cron(client).get_json()["ending_soon_sent"] == 1

    # Trial rolls past its end — the expired event still fires once.
    _set_trial(cid, datetime.utcnow() - timedelta(hours=1))
    body = _run_cron(client).get_json()
    assert body["expired_sent"] == 1
    assert body["ending_soon_sent"] == 0
    assert len(_notification_rows("cta_owner_both", "owner_cta:steve_trial_expired")) == 1


def test_sweep_dry_run_counts_without_side_effects(mysql_dsn, cta_env, capture_push):
    import bodybuilding_app
    from tests.fixtures import make_community, make_user

    make_user("cta_owner_dry")
    cid = make_community("CTA Dry", creator_username="cta_owner_dry")
    _set_trial(cid, datetime.utcnow() + timedelta(days=2))

    client = bodybuilding_app.app.test_client()
    body = _run_cron(client, dry_run=True).get_json()
    assert body["dry_run"] is True
    assert body["ending_soon_sent"] == 1
    assert capture_push == []
    assert not _notification_rows("cta_owner_dry", "owner_cta:steve_trial_ending")
    assert _audit_count("owner_cta_steve_trial_ending") == 0


def test_sweep_ignores_real_stripe_package_subs(mysql_dsn, cta_env, capture_push):
    import bodybuilding_app
    from backend.services import community_billing
    from tests.fixtures import make_community, make_user

    make_user("cta_owner_paid")
    cid = make_community("CTA Paid", creator_username="cta_owner_paid", tier="paid_l1")
    community_billing.ensure_tables()
    community_billing.mark_steve_package_subscription(
        cid,
        subscription_id="sub_real123",
        status="active",
        current_period_end=(datetime.utcnow() + timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S"),
    )

    client = bodybuilding_app.app.test_client()
    body = _run_cron(client).get_json()
    assert body["ending_soon_sent"] == 0
    assert body["expired_sent"] == 0
    assert not _notification_rows("cta_owner_paid", "owner_cta:steve_trial_ending")


# ── Trigger 2 — member blocked in paid, package-less community ──────────


def test_member_blocked_fires_once_then_rate_limits(
    mysql_dsn, cta_env, capture_push, stub_rate_limit_cache
):
    from backend.services import owner_billing_ctas
    from tests.fixtures import make_community, make_user

    make_user("blk_owner")
    make_user("blk_member")
    cid = make_community("Blocked Paid", creator_username="blk_owner", tier="paid_l1")

    assert owner_billing_ctas.notify_member_blocked(cid, "blk_member") is True
    # Second denial inside the 7-day window — capped.
    assert owner_billing_ctas.notify_member_blocked(cid, "blk_member") is False

    rows = _notification_rows("blk_owner", "owner_cta:steve_member_blocked")
    assert len(rows) == 1
    assert rows[0]["link"] == f"/subscription_plans?open=community_addons&community_id={cid}"
    assert _audit_count("owner_cta_steve_member_blocked") == 1
    assert len([p for p in capture_push if p["username"] == "blk_owner"]) == 1
    # Privacy: the blocked member is never named in owner-facing copy.
    push = [p for p in capture_push if p["username"] == "blk_owner"][0]
    assert "blk_member" not in (push["title"] + push["body"])


def test_member_blocked_never_fires_for_owner_own_denial(
    mysql_dsn, cta_env, capture_push, stub_rate_limit_cache
):
    from backend.services import owner_billing_ctas
    from tests.fixtures import make_community, make_user

    make_user("blk_self")
    cid = make_community("Blocked Self", creator_username="blk_self", tier="paid_l1")

    assert owner_billing_ctas.notify_member_blocked(cid, "blk_self") is False
    assert not _notification_rows("blk_self", "owner_cta:steve_member_blocked")
    assert capture_push == []


def test_member_blocked_never_fires_for_free_communities(
    mysql_dsn, cta_env, capture_push, stub_rate_limit_cache
):
    from backend.services import owner_billing_ctas
    from tests.fixtures import make_community, make_user

    make_user("blk_free_owner")
    make_user("blk_free_member")
    cid = make_community("Blocked Free", creator_username="blk_free_owner", tier="free")

    assert owner_billing_ctas.notify_member_blocked(cid, "blk_free_member") is False
    assert not _notification_rows("blk_free_owner", "owner_cta:steve_member_blocked")


def test_member_blocked_skips_when_package_active(
    mysql_dsn, cta_env, capture_push, stub_rate_limit_cache
):
    from backend.services import community_billing, owner_billing_ctas
    from tests.fixtures import make_community, make_user

    make_user("blk_pkg_owner")
    make_user("blk_pkg_member")
    cid = make_community("Blocked Pkg", creator_username="blk_pkg_owner", tier="paid_l1")
    community_billing.ensure_tables()
    community_billing.mark_steve_package_subscription(
        cid, subscription_id="sub_live", status="active",
        current_period_end=(datetime.utcnow() + timedelta(days=20)).strftime("%Y-%m-%d %H:%M:%S"),
    )

    assert owner_billing_ctas.notify_member_blocked(cid, "blk_pkg_member") is False


def test_member_blocked_noop_when_enforcement_off(
    mysql_dsn, capture_push, stub_rate_limit_cache, monkeypatch
):
    """Flag off means nobody is actually blocked — no phantom owner pings."""
    from backend.services import owner_billing_ctas
    from tests.fixtures import make_community, make_user

    monkeypatch.setenv("ENTITLEMENTS_ENFORCEMENT_ENABLED", "false")
    make_user("blk_off_owner")
    make_user("blk_off_member")
    cid = make_community("Blocked Off", creator_username="blk_off_owner", tier="paid_l1")

    assert owner_billing_ctas.notify_member_blocked(cid, "blk_off_member") is False
    assert capture_push == []


# ── Trigger 3 — pool exhausted, once per billing cycle ──────────────────


def test_pool_exhausted_fires_once_per_cycle(
    mysql_dsn, cta_env, capture_push, stub_rate_limit_cache
):
    from backend.services import owner_billing_ctas
    from tests.fixtures import make_community, make_user

    make_user("pool_owner")
    make_user("pool_member")
    cid = make_community("Pool Paid", creator_username="pool_owner", tier="paid_l1")

    assert owner_billing_ctas.notify_pool_exhausted(cid, "pool_member") is True
    assert owner_billing_ctas.notify_pool_exhausted(cid, "pool_member") is False
    assert owner_billing_ctas.notify_pool_exhausted(cid, "other_member") is False

    rows = _notification_rows("pool_owner", "owner_cta:steve_pool_exhausted")
    assert len(rows) == 1
    assert rows[0]["link"] == f"/subscription_plans?open=community_addons&community_id={cid}"
    assert _audit_count("owner_cta_steve_pool_exhausted") == 1

    # The rate-limit identity embeds the cycle month → next month is a new key.
    month_key = datetime.utcnow().strftime("%Y-%m")
    assert any(f"{cid}:{month_key}" in k for k in stub_rate_limit_cache.counts)


def test_pool_exhausted_never_fires_for_owner_own_denial(
    mysql_dsn, cta_env, capture_push, stub_rate_limit_cache
):
    from backend.services import owner_billing_ctas
    from tests.fixtures import make_community, make_user

    make_user("pool_self")
    cid = make_community("Pool Self", creator_username="pool_self", tier="paid_l1")

    assert owner_billing_ctas.notify_pool_exhausted(cid, "pool_self") is False
    assert capture_push == []


# ── Gate wiring (pure — no DB, everything stubbed) ───────────────────────


def _stub_gate(monkeypatch, *, pool_active: bool, pool_used: int = 0, pool_cap: int = 0):
    """Drive check_steve_access to a deny with all IO stubbed out."""
    from backend.services import ai_usage, entitlements_gate as gate
    from backend.services import owner_billing_ctas

    monkeypatch.setenv("ENTITLEMENTS_ENFORCEMENT_ENABLED", "true")
    monkeypatch.setattr(gate, "resolve_entitlements", lambda u: {"can_use_steve": False})
    monkeypatch.setattr(gate, "_community_tiers_field_map", lambda: {})
    monkeypatch.setattr(
        gate,
        "get_paid_steve_package_config",
        lambda fields: SimpleNamespace(
            monthly_credit_pool=pool_cap,
            monthly_provider_cost_ceiling_usd=0,
            provider_cost_reservation_usd=0,
        ),
    )
    monkeypatch.setattr(gate, "_user_member_community", lambda u, cid: True)
    monkeypatch.setattr(gate.community_svc, "resolve_root_community_id", lambda cid: (int(cid), True))
    monkeypatch.setattr(gate.community_billing, "has_active_steve_package", lambda cid: pool_active)
    monkeypatch.setattr(gate.ai_usage, "community_monthly_steve_pool_usage", lambda cid: pool_used)
    monkeypatch.setattr(gate.ai_usage, "log_block", lambda *a, **k: None)
    monkeypatch.setattr(gate, "_snapshot", lambda u, e: {})
    monkeypatch.setattr(gate.errs, "build_error", lambda reason, **k: ({"reason": reason}, 403))
    monkeypatch.setattr(
        gate, "_steve_addon_reroute_overrides",
        lambda root_id: {"message": "addon"} if not pool_active else None,
    )

    calls = {"member_blocked": [], "pool_exhausted": []}
    monkeypatch.setattr(
        owner_billing_ctas, "notify_member_blocked",
        lambda cid, user: calls["member_blocked"].append((cid, user)) or True,
    )
    monkeypatch.setattr(
        owner_billing_ctas, "notify_pool_exhausted",
        lambda cid, user: calls["pool_exhausted"].append((cid, user)) or True,
    )
    return gate, ai_usage, calls


def test_gate_premium_required_deny_fires_member_blocked(monkeypatch):
    gate, ai_usage, calls = _stub_gate(monkeypatch, pool_active=False)

    allowed, payload, status, _ent = gate.check_steve_access(
        "some_member", ai_usage.SURFACE_FEED, community_id=42,
        estimated_credits_debit=1.0,
    )
    assert allowed is False and payload["reason"] == gate.errs.REASON_PREMIUM_REQUIRED
    assert calls["member_blocked"] == [(42, "some_member")]
    assert calls["pool_exhausted"] == []


def test_gate_pool_exhausted_deny_fires_pool_cta(monkeypatch):
    gate, ai_usage, calls = _stub_gate(
        monkeypatch, pool_active=True, pool_used=10, pool_cap=10
    )

    allowed, payload, status, _ent = gate.check_steve_access(
        "some_member", ai_usage.SURFACE_FEED, community_id=42,
        estimated_credits_debit=1.0,
    )
    assert allowed is False
    assert payload["reason"] == gate.errs.REASON_COMMUNITY_POOL_EXHAUSTED
    assert calls["pool_exhausted"] == [(42, "some_member")]
    assert calls["member_blocked"] == []


def test_gate_deny_survives_cta_service_crash(monkeypatch):
    """The CTA side-channel must never break the gate's deny response."""
    from backend.services import owner_billing_ctas

    gate, ai_usage, _calls = _stub_gate(monkeypatch, pool_active=False)

    def boom(cid, user):
        raise RuntimeError("cta side-channel exploded")

    monkeypatch.setattr(owner_billing_ctas, "notify_member_blocked", boom)
    allowed, payload, status, _ent = gate.check_steve_access(
        "some_member", ai_usage.SURFACE_FEED, community_id=42,
        estimated_credits_debit=1.0,
    )
    assert allowed is False
    assert payload["reason"] == gate.errs.REASON_PREMIUM_REQUIRED
