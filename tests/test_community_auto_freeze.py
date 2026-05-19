"""Tests for the community auto-freeze flow on subscription expiration.

Coverage:

  * Auto-freeze when ``customer.subscription.deleted`` fires for a
    community whose member count exceeds the Free-tier cap.
  * No-freeze when member count is at or below the cap.
  * Kill switch via ``community_lifecycle_notifications_enabled = False``
    on the ``community-tiers`` KB page.
  * Custom Free-tier cap — the KB value drives the threshold.
  * Auto-unfreeze after ``maybe_auto_unfreeze`` is called once members
    drop back to the cap.
  * Idempotency: calling ``freeze_for_subscription_expired`` twice does
    not duplicate notifications.
  * Renewal validation: ``customer.subscription.created`` /
    ``customer.subscription.updated`` with status ``active`` lifts the
    auto-freeze.

The tests run against the shared MySQL testcontainer; they skip cleanly
when Docker isn't available. Notification delivery is patched so we can
assert call counts without a live SMTP.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.usefixtures("mysql_dsn")


from backend.blueprints import subscription_webhooks as webhooks
from backend.services import community_billing, community_lifecycle
from tests.fixtures import (
    fill_community_members,
    kb_override_field,
    make_community,
    make_user,
)


@pytest.fixture(autouse=True)
def _patch_notifications(monkeypatch):
    """Capture owner / admin notifications so tests can assert counts."""
    notifications = {"owner_freeze": [], "owner_admin": [], "platform_admin": []}

    def fake_owner_freeze(*, community_id, member_count, cap):
        notifications["owner_freeze"].append(
            {"community_id": community_id, "member_count": member_count, "cap": cap}
        )

    def fake_owner_admin(**kwargs):
        notifications["owner_admin"].append(kwargs)
        return True

    def fake_platform_admin(**kwargs):
        notifications["platform_admin"].append(kwargs)
        return 1

    monkeypatch.setattr(
        community_lifecycle,
        "_notify_owner_subscription_freeze",
        fake_owner_freeze,
    )
    monkeypatch.setattr(
        webhooks.community_admin_notifications,
        "notify_owner_of_admin_action",
        fake_owner_admin,
    )
    monkeypatch.setattr(
        webhooks.community_admin_notifications,
        "notify_platform_admins_of_stripe_cancellation",
        fake_platform_admin,
    )
    return notifications


def _seed_default_kb(*, enabled: bool = True, cap: int = 25):
    """Seed the freeze knobs the lifecycle code reads from KB.

    Each call replaces both fields so tests don't accumulate stale
    values. Real KB pages have many fields, but the helper only reads
    these three.
    """
    kb_override_field(
        "community-tiers",
        "free_community_max_members",
        cap,
        field_type="integer",
    )
    kb_override_field(
        "community-tiers",
        "community_lifecycle_notifications_enabled",
        bool(enabled),
        field_type="boolean",
    )


def _setup_paid_community(name: str, *, owner: str, members: int) -> int:
    """Create a paid community with N members and an active subscription row."""
    make_user(owner)
    cid = make_community(name, creator_username=owner, tier="paid_l1")
    fill_community_members(cid, members)
    community_billing.mark_subscription(
        cid,
        tier_code="paid_l1",
        subscription_id=f"sub_{cid}",
        customer_id=f"cus_{cid}",
        status="active",
    )
    return cid


def _trigger_subscription_deleted(community_id: int, owner: str) -> None:
    webhooks._handle_community_tier_event(
        "customer.subscription.deleted",
        {
            "id": f"sub_{community_id}",
            "metadata": {
                "sku": "community_tier",
                "community_id": str(community_id),
            },
        },
        owner,
    )


# ── Auto-freeze on subscription expiration ─────────────────────────────


def test_auto_freeze_when_members_exceed_free_cap(_patch_notifications):
    _seed_default_kb(cap=25)
    cid = _setup_paid_community("Big Community", owner="freeze_owner_a", members=30)

    _trigger_subscription_deleted(cid, "freeze_owner_a")

    state = community_lifecycle.get_freeze_state(cid)
    assert state["is_frozen"] is True
    assert state["frozen_reason"] == "subscription_expired"
    assert state["frozen_by"] == "system"
    assert _patch_notifications["owner_freeze"] == [
        {"community_id": cid, "member_count": 30, "cap": 25}
    ]


def test_no_freeze_when_members_within_free_cap(_patch_notifications):
    _seed_default_kb(cap=25)
    cid = _setup_paid_community("Small Community", owner="freeze_owner_b", members=10)

    _trigger_subscription_deleted(cid, "freeze_owner_b")

    state = community_lifecycle.get_freeze_state(cid)
    assert state["is_frozen"] is False
    assert _patch_notifications["owner_freeze"] == []


def test_kill_switch_disables_auto_freeze(_patch_notifications):
    _seed_default_kb(enabled=False, cap=25)
    cid = _setup_paid_community("Kill-switched", owner="freeze_owner_c", members=50)

    _trigger_subscription_deleted(cid, "freeze_owner_c")

    state = community_lifecycle.get_freeze_state(cid)
    assert state["is_frozen"] is False
    assert _patch_notifications["owner_freeze"] == []


def test_custom_free_member_cap(_patch_notifications):
    _seed_default_kb(cap=10)
    cid = _setup_paid_community("Custom Cap", owner="freeze_owner_d", members=12)

    _trigger_subscription_deleted(cid, "freeze_owner_d")

    state = community_lifecycle.get_freeze_state(cid)
    assert state["is_frozen"] is True
    assert _patch_notifications["owner_freeze"][0]["cap"] == 10
    assert _patch_notifications["owner_freeze"][0]["member_count"] == 12


def test_freeze_is_idempotent(_patch_notifications):
    _seed_default_kb(cap=25)
    cid = _setup_paid_community("Idempotent", owner="freeze_owner_e", members=30)

    _trigger_subscription_deleted(cid, "freeze_owner_e")
    _trigger_subscription_deleted(cid, "freeze_owner_e")

    assert len(_patch_notifications["owner_freeze"]) == 1
    state = community_lifecycle.get_freeze_state(cid)
    assert state["is_frozen"] is True


# ── Auto-unfreeze paths ────────────────────────────────────────────────


def test_maybe_auto_unfreeze_when_under_cap(_patch_notifications):
    _seed_default_kb(cap=25)
    cid = _setup_paid_community("Recover", owner="freeze_owner_f", members=30)
    _trigger_subscription_deleted(cid, "freeze_owner_f")
    assert community_lifecycle.get_freeze_state(cid)["is_frozen"] is True

    # Drop to within the cap — emulate member removal.
    from backend.services.database import get_db_connection, get_sql_placeholder
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"DELETE FROM user_communities WHERE community_id = {ph} LIMIT 10",
            (cid,),
        )
        try:
            conn.commit()
        except Exception:
            pass

    unfrozen = community_lifecycle.maybe_auto_unfreeze(cid)
    assert unfrozen is True
    state = community_lifecycle.get_freeze_state(cid)
    assert state["is_frozen"] is False


def test_maybe_auto_unfreeze_skips_when_still_over_cap(_patch_notifications):
    _seed_default_kb(cap=25)
    cid = _setup_paid_community("Still Over", owner="freeze_owner_g", members=40)
    _trigger_subscription_deleted(cid, "freeze_owner_g")
    assert community_lifecycle.get_freeze_state(cid)["is_frozen"] is True

    # Remove a few members but stay above the cap.
    from backend.services.database import get_db_connection, get_sql_placeholder
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"DELETE FROM user_communities WHERE community_id = {ph} LIMIT 5",
            (cid,),
        )
        try:
            conn.commit()
        except Exception:
            pass

    unfrozen = community_lifecycle.maybe_auto_unfreeze(cid)
    assert unfrozen is False
    state = community_lifecycle.get_freeze_state(cid)
    assert state["is_frozen"] is True


def test_maybe_auto_unfreeze_skips_admin_freeze(_patch_notifications):
    """Admin-initiated freezes survive member-count auto-unfreeze."""
    _seed_default_kb(cap=25)
    cid = _setup_paid_community("Admin Frozen", owner="freeze_owner_h", members=10)
    community_lifecycle.set_freeze_state_system(
        cid, frozen=True, reason="admin_action"
    )
    assert community_lifecycle.get_freeze_state(cid)["is_frozen"] is True

    unfrozen = community_lifecycle.maybe_auto_unfreeze(cid)
    assert unfrozen is False
    assert community_lifecycle.get_freeze_state(cid)["is_frozen"] is True


def test_subscription_active_event_unfreezes_community(_patch_notifications, monkeypatch):
    _seed_default_kb(cap=25)
    cid = _setup_paid_community(
        "Renewal", owner="freeze_owner_i", members=30
    )
    _trigger_subscription_deleted(cid, "freeze_owner_i")
    assert community_lifecycle.get_freeze_state(cid)["is_frozen"] is True

    # Restore subscription via webhook update to active.
    monkeypatch.setattr(webhooks, "_tier_from_subscription_price", lambda obj: "paid_l1")
    webhooks._handle_community_tier_event(
        "customer.subscription.updated",
        {
            "id": f"sub_{cid}",
            "status": "active",
            "cancel_at_period_end": False,
            "metadata": {"sku": "community_tier", "community_id": str(cid)},
        },
        "freeze_owner_i",
    )

    state = community_lifecycle.get_freeze_state(cid)
    assert state["is_frozen"] is False


def test_subscription_created_event_unfreezes_community(_patch_notifications, monkeypatch):
    _seed_default_kb(cap=25)
    cid = _setup_paid_community(
        "New Subscription", owner="freeze_owner_j", members=30
    )
    _trigger_subscription_deleted(cid, "freeze_owner_j")
    assert community_lifecycle.get_freeze_state(cid)["is_frozen"] is True

    monkeypatch.setattr(webhooks, "_tier_from_subscription_price", lambda obj: "paid_l1")
    webhooks._handle_community_tier_event(
        "customer.subscription.created",
        {
            "id": f"sub_new_{cid}",
            "status": "active",
            "cancel_at_period_end": False,
            "metadata": {"sku": "community_tier", "community_id": str(cid)},
        },
        "freeze_owner_j",
    )

    assert community_lifecycle.get_freeze_state(cid)["is_frozen"] is False
