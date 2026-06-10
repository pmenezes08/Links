"""Steve Community Package 14-day trial for new root communities.

The trial is a synthetic (non-Stripe) subscription row: id
``trial_pkg_<community_id>``, status ``trialing``, period end now+14d.
Expiry is enforced at read time in ``get_billing_state`` because no
webhook exists for synthetic rows.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from backend.services import community_billing
from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def test_trial_grants_active_package_on_root(mysql_dsn):
    community_billing.ensure_tables()
    make_user("steve_trial_owner", subscription="free")
    cid = make_community("steve-trial-root", tier="free", creator_username="steve_trial_owner")

    assert community_billing.grant_steve_package_trial(cid) is True

    state = community_billing.get_billing_state(cid)
    assert state["steve_package_subscription_status"] == "trialing"
    assert community_billing.is_synthetic_steve_package_trial(state)
    assert community_billing.has_active_steve_package(cid) is True

    # One trial per community — a second grant must refuse.
    assert community_billing.grant_steve_package_trial(cid) is False


def test_trial_skips_sub_communities(mysql_dsn):
    community_billing.ensure_tables()
    make_user("steve_trial_owner2", subscription="free")
    root = make_community("steve-trial-parent", tier="free", creator_username="steve_trial_owner2")
    sub = make_community(
        "steve-trial-sub",
        tier="free",
        creator_username="steve_trial_owner2",
        parent_community_id=root,
    )

    assert community_billing.grant_steve_package_trial(sub) is False
    # Package state resolves to the root, which received no trial either.
    assert community_billing.has_active_steve_package(sub) is False
    assert community_billing.has_active_steve_package(root) is False


def test_trial_expires_at_read_time(mysql_dsn):
    community_billing.ensure_tables()
    make_user("steve_trial_owner3", subscription="free")
    cid = make_community("steve-trial-expiry", tier="free", creator_username="steve_trial_owner3")
    assert community_billing.grant_steve_package_trial(cid) is True

    ph = get_sql_placeholder()
    past = (datetime.utcnow() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE communities SET steve_package_current_period_end = {ph} WHERE id = {ph}",
            (past, cid),
        )
        conn.commit()

    assert community_billing.has_active_steve_package(cid) is False
    state = community_billing.get_billing_state(cid)
    assert state["steve_package_subscription_active"] is False


def test_trial_never_overwrites_real_subscription(mysql_dsn):
    community_billing.ensure_tables()
    make_user("steve_trial_owner4", subscription="free")
    cid = make_community("steve-trial-real-sub", tier="free", creator_username="steve_trial_owner4")
    community_billing.mark_steve_package_subscription(
        cid,
        subscription_id="sub_real_123",
        status="active",
    )

    assert community_billing.grant_steve_package_trial(cid) is False

    state = community_billing.get_billing_state(cid)
    assert state["steve_package_stripe_subscription_id"] == "sub_real_123"
    assert not community_billing.is_synthetic_steve_package_trial(state)
