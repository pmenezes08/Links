"""Billing reads resolve sub-communities to their root network."""

from __future__ import annotations

import pytest

from backend.services import community_billing
from tests.fixtures import make_community, make_user


def test_get_billing_state_uses_root_tier_for_subcommunity(mysql_dsn):
    community_billing.ensure_tables()
    make_user("owner")
    root_id = make_community("RootNet", tier="paid_l1", creator_username="owner")
    sub_id = make_community("SubNet", tier="free", creator_username="owner", parent_community_id=root_id)

    state_sub = community_billing.get_billing_state(sub_id) or {}
    state_root = community_billing.get_billing_state(root_id) or {}

    assert state_sub.get("tier") == state_root.get("tier") == "paid_l1"
