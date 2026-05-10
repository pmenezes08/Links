from __future__ import annotations

from backend.services import ai_usage, community_billing, knowledge_base
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.entitlements_gate import check_steve_access
from tests.fixtures import days_ago, make_community, make_user


def _free_entitlements() -> dict:
    return {
        "tier": "free",
        "can_use_steve": False,
        "ai_daily_limit": None,
        "steve_uses_per_month": 0,
        "monthly_spend_ceiling_eur": None,
    }


def _premium_entitlements() -> dict:
    return {
        "tier": "premium",
        "can_use_steve": True,
        "ai_daily_limit": 1,
        "steve_uses_per_month": 1,
        "monthly_spend_ceiling_eur": None,
    }


def test_free_member_pool_gate_allows_with_community_context(monkeypatch):
    from backend.services import entitlements_gate as gate

    monkeypatch.setattr(gate, "resolve_entitlements", lambda username: _free_entitlements())
    monkeypatch.setattr(
        gate,
        "_community_tiers_field_map",
        lambda: {
            "paid_steve_package_free_member_access": True,
            "paid_steve_package_monthly_credit_pool": 300,
        },
    )
    monkeypatch.setattr(gate, "_user_member_community", lambda username, community_id: True)
    monkeypatch.setattr(gate.community_svc, "resolve_root_community_id", lambda cid: (123, True))
    monkeypatch.setattr(gate.community_billing, "has_active_steve_package", lambda root_id: True)
    monkeypatch.setattr(gate.ai_usage, "community_monthly_steve_pool_usage", lambda root_id: 42)

    allowed, payload, status, _ent = gate.check_steve_access(
        "JohnDoe",
        ai_usage.SURFACE_FEED,
        community_id=456,
    )

    assert allowed is True
    assert payload is None
    assert status is None


def test_premium_member_pool_gate_skips_personal_caps(monkeypatch):
    from backend.services import entitlements_gate as gate

    monkeypatch.setattr(gate, "resolve_entitlements", lambda username: _premium_entitlements())
    monkeypatch.setattr(
        gate,
        "_community_tiers_field_map",
        lambda: {
            "paid_steve_package_premium_priority": True,
            "paid_steve_package_monthly_credit_pool": 300,
        },
    )
    monkeypatch.setattr(gate, "_user_member_community", lambda username, community_id: True)
    monkeypatch.setattr(gate.community_svc, "resolve_root_community_id", lambda cid: (123, True))
    monkeypatch.setattr(gate.community_billing, "has_active_steve_package", lambda root_id: True)
    monkeypatch.setattr(gate.ai_usage, "community_monthly_steve_pool_usage", lambda root_id: 42)
    monkeypatch.setattr(
        gate.ai_usage,
        "daily_count",
        lambda username: (_ for _ in ()).throw(AssertionError("personal daily cap checked")),
    )
    monkeypatch.setattr(
        gate.ai_usage,
        "monthly_steve_count",
        lambda username: (_ for _ in ()).throw(AssertionError("personal monthly cap checked")),
    )

    allowed, payload, status, _ent = gate.check_steve_access(
        "PremiumJane",
        ai_usage.SURFACE_FEED,
        community_id=456,
    )

    assert allowed is True
    assert payload is None
    assert status is None


def test_preflight_ignores_non_steve_text_even_when_enforced(monkeypatch):
    from backend.services import entitlements_gate as gate

    monkeypatch.setattr(gate, "entitlements_enforcement_enabled", lambda: True)
    monkeypatch.setattr(
        gate,
        "check_steve_access",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("gate should not run")),
    )

    allowed, payload, status, _ent = gate.preflight_steve_mention(
        "JohnDoe",
        "hello everyone",
        ai_usage.SURFACE_FEED,
        community_id=123,
    )

    assert allowed is True
    assert payload is None
    assert status is None


def test_preflight_delegates_steve_mentions_when_enforced(monkeypatch):
    from backend.services import entitlements_gate as gate

    calls = []

    def fake_check(username, surface, *, community_id=None, **kwargs):
        calls.append((username, surface, community_id))
        return False, {"success": False, "error": "entitlements_error", "reason": "premium_required"}, 403, {}

    monkeypatch.setattr(gate, "entitlements_enforcement_enabled", lambda: True)
    monkeypatch.setattr(gate, "check_steve_access", fake_check)

    allowed, payload, status, _ent = gate.preflight_steve_mention(
        "JohnDoe",
        "@Steve help",
        ai_usage.SURFACE_FEED,
        community_id=123,
    )

    assert allowed is False
    assert status == 403
    assert payload and payload.get("reason") == "premium_required"
    assert calls == [("JohnDoe", ai_usage.SURFACE_FEED, 123)]


def test_free_member_pool_gate_blocks_without_community_context(monkeypatch):
    from backend.services import entitlements_gate as gate

    monkeypatch.setattr(gate, "resolve_entitlements", lambda username: _free_entitlements())
    monkeypatch.setattr(gate, "_community_tiers_field_map", lambda: {})
    monkeypatch.setattr(gate.ai_usage, "log_block", lambda *args, **kwargs: None)

    allowed, payload, status, _ent = gate.check_steve_access(
        "JohnDoe",
        ai_usage.SURFACE_FEED,
    )

    assert allowed is False
    assert status is not None
    assert payload and payload.get("reason") == "premium_required"


def _add_member(username: str, community_id: int) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        user_id = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"""
            INSERT INTO user_communities (user_id, community_id, role, joined_at)
            VALUES ({ph}, {ph}, {ph}, NOW())
            """,
            (int(user_id), int(community_id), "member"),
        )
        try:
            conn.commit()
        except Exception:
            pass


def test_free_member_can_use_feed_steve_via_active_community_pool(mysql_dsn):
    knowledge_base.seed_default_pages(force=True)
    community_billing.ensure_tables()
    ai_usage.ensure_tables()
    make_user("pool_owner", subscription="free", created_at=days_ago(60))
    make_user("JohnDoe", subscription="free", created_at=days_ago(60))
    community_id = make_community(
        "Pool Community",
        tier="paid_l1",
        creator_username="pool_owner",
    )
    _add_member("JohnDoe", community_id)
    community_billing.mark_steve_package_subscription(
        community_id,
        subscription_id="sub_steve_pool",
        status="active",
    )

    allowed, payload, status, _ent = check_steve_access(
        "JohnDoe",
        ai_usage.SURFACE_FEED,
        community_id=community_id,
    )

    assert allowed is True
    assert payload is None
    assert status is None


def test_free_member_without_community_context_is_still_blocked(mysql_dsn):
    knowledge_base.seed_default_pages(force=True)
    make_user("JohnNoCtx", subscription="free", created_at=days_ago(60))

    allowed, payload, status, _ent = check_steve_access(
        "JohnNoCtx",
        ai_usage.SURFACE_FEED,
    )

    assert allowed is False
    assert status is not None
    assert payload and payload.get("reason") == "premium_required"
