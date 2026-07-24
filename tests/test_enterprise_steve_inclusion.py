"""Enterprise deals that buy the size, not the AI.

Two things used to be welded together: ``communities.tier = 'enterprise'``
meant "uncapped membership" *and* "every member who joins gets a
Premium-equivalent Steve seat, forever". Sales-assisted deals need those
separated — an Enterprise community can be uncapped while Steve stays a
paid add-on (or a time-boxed trial that simply lapses).

Covered here:

  1. ``ensure_free_parent_member_capacity`` ignores Enterprise communities
     even when the owner is on a Free personal plan — the normal shape for
     a contract-billed customer, and previously the reason an "Enterprise"
     community still hit the Free owner cap.
  2. ``community_structure_caps_exempt`` lifts the Free-plan *structure*
     caps (sub-community count / nesting depth / own-parent-only) anywhere
     under an Enterprise root — Enterprise buys unlimited sub-communities
     too, and group-chat creation was never count-capped for anyone.
  3. ``start_seat`` honours the per-deal ``enterprise_steve_included``
     override, falling back to the ``community-tiers`` KB policy.
  4. ``package_included_for`` reports the same clause to the billing
     surfaces so a Steve-less Enterprise owner sees the add-on path.

What we deliberately don't test here: the community Steve *pool* gate.
That already keys off the Steve-package subscription columns
(``entitlements_gate`` / ``group_steve_agent``), never off the tier, so a
lapsed package trial stops Steve without any tier involvement.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.usefixtures("mysql_dsn")


from backend.services import enterprise_membership as em
from backend.services.community import (
    CommunityMembershipLimitError,
    community_structure_caps_exempt,
    ensure_free_parent_member_capacity,
)
from backend.services.database import get_db_connection

from tests.fixtures import (
    days_ago,
    fill_community_members,
    kb_override_field,
    make_community,
    make_user,
)


def _run_with_cursor(fn, *args, **kwargs):
    with get_db_connection() as conn:
        c = conn.cursor()
        return fn(c, *args, **kwargs)


def _kb_seats(enabled: bool) -> None:
    """Set the tier-wide seat policy (``enterprise_grants_premium_steve``)."""
    kb_override_field(
        "community-tiers",
        "enterprise_grants_premium_steve",
        enabled,
        field_type="boolean",
    )


# ── 1. Member cap ───────────────────────────────────────────────────────


class TestEnterpriseMemberCap:
    """Enterprise is uncapped regardless of the owner's personal plan."""

    def test_free_owner_does_not_cap_an_enterprise_community(self):
        make_user("ent_owner_free", subscription="free", created_at=days_ago(60))
        kb_override_field("user-tiers", "free_members_per_owned_community", 25)
        cid = make_community(
            "ent-uncapped", tier="enterprise", creator_username="ent_owner_free",
        )
        fill_community_members(cid, 40)

        # Would raise for any non-Enterprise tier owned by a Free user.
        _run_with_cursor(
            ensure_free_parent_member_capacity,
            cid,
            extra_members=1,
            attempted_username="member_41",
        )

    def test_free_owner_still_caps_a_free_community(self):
        """Control: the Enterprise exemption must not uncap everything."""
        make_user("free_owner_ctl", subscription="free", created_at=days_ago(60))
        kb_override_field("user-tiers", "free_members_per_owned_community", 25)
        cid = make_community(
            "free-capped", tier="free", creator_username="free_owner_ctl",
        )
        fill_community_members(cid, 25)

        with pytest.raises(CommunityMembershipLimitError) as excinfo:
            _run_with_cursor(
                ensure_free_parent_member_capacity,
                cid,
                extra_members=1,
                attempted_username="member_26",
            )
        assert excinfo.value.cap == 25


# ── 1b. Structure caps ──────────────────────────────────────────────────


class TestEnterpriseStructureUncapped:
    """Sub-community structure caps never apply inside an Enterprise network.

    ``community_structure_caps_exempt`` is the guard the monolith's
    ``create_community`` sub-community branch consults before applying the
    Free-plan structure caps (3 subs / parent, 1 nested level, own-parent
    only). Group-chat creation has no count cap for anyone, so Enterprise
    "unlimited groups" needs no code — only the per-group member cap exists
    (``MAX_GROUP_MEMBERS``), which is orthogonal to tier.
    """

    def test_enterprise_root_is_exempt(self):
        cid = make_community("ent-structure", tier="enterprise", creator_username="struct_owner")
        assert _run_with_cursor(community_structure_caps_exempt, cid) is True

    def test_sub_of_enterprise_root_is_exempt(self):
        """Creating a nested community under an existing sub resolves the root."""
        root = make_community("ent-structure-root", tier="enterprise", creator_username="struct_owner2")
        sub = make_community("ent-structure-sub", tier="free", parent_community_id=root)
        assert _run_with_cursor(community_structure_caps_exempt, sub) is True

    def test_free_root_is_not_exempt(self):
        cid = make_community("free-structure", tier="free", creator_username="free_struct_owner")
        assert _run_with_cursor(community_structure_caps_exempt, cid) is False

    def test_paid_root_is_not_exempt(self):
        """Paid tiers keep whatever structure rules apply to them today."""
        cid = make_community("paid-structure", tier="paid_l3", creator_username="paid_struct_owner")
        assert _run_with_cursor(community_structure_caps_exempt, cid) is False

    def test_missing_community_fails_closed(self):
        assert _run_with_cursor(community_structure_caps_exempt, None) is False
        assert _run_with_cursor(community_structure_caps_exempt, 999_999) is False


# ── 2. Seat grants ──────────────────────────────────────────────────────


class TestSeatGrantHonoursTheDeal:
    def setup_method(self) -> None:
        em.ensure_tables()

    def test_override_off_skips_the_seat(self):
        _kb_seats(True)  # tier-wide policy says "seats included"…
        make_user("tap_member", subscription="free")
        cid = make_community("tap-no-steve", tier="enterprise", creator_username="tap_owner")
        em.set_steve_override(cid, False)  # …but this deal excludes Steve.

        result = em.start_seat(username="tap_member", community_id=cid)

        assert result["skipped"] is True
        assert result["reason"] == "enterprise_steve_not_included"
        assert result["active"] is False
        assert em.active_seat_for("tap_member") is None

    def test_override_on_grants_even_when_policy_is_off(self):
        _kb_seats(False)
        make_user("seat_member", subscription="free")
        cid = make_community("ent-with-steve", tier="enterprise", creator_username="ent_owner")
        em.set_steve_override(cid, True)

        result = em.start_seat(username="seat_member", community_id=cid)

        assert not result.get("skipped")
        seat = em.active_seat_for("seat_member")
        assert seat is not None
        assert seat["community_id"] == cid
        assert seat["active"] is True

    def test_no_override_follows_kb_policy(self):
        _kb_seats(True)
        make_user("policy_member", subscription="free")
        cid = make_community("ent-policy", tier="enterprise", creator_username="policy_owner")

        assert em.steve_override_for(cid) is None
        result = em.start_seat(username="policy_member", community_id=cid)

        assert not result.get("skipped")
        assert em.active_seat_for("policy_member") is not None

    def test_clearing_the_override_returns_to_policy(self):
        _kb_seats(False)
        cid = make_community("ent-clear", tier="enterprise", creator_username="clear_owner")
        em.set_steve_override(cid, True)
        assert em.seats_enabled_for(cid) is True

        em.set_steve_override(cid, None)
        assert em.steve_override_for(cid) is None
        assert em.seats_enabled_for(cid) is False

    def test_non_enterprise_tier_still_raises(self):
        """The override never turns a Paid community into a seat source."""
        make_user("paid_member", subscription="free")
        cid = make_community("paid-l1", tier="paid_l1", creator_username="paid_owner")
        em.set_steve_override(cid, True)

        with pytest.raises(ValueError):
            em.start_seat(username="paid_member", community_id=cid)


# ── 3. Package-included reporting ───────────────────────────────────────


class TestPackageIncludedForBillingSurfaces:
    def setup_method(self) -> None:
        em.ensure_tables()

    def test_override_off_reports_not_included(self):
        cid = make_community("pkg-off", tier="enterprise", creator_username="pkg_owner")
        em.set_steve_override(cid, False)
        assert em.package_included_for(cid, kb_default=True) is False

    def test_no_override_uses_kb_default(self):
        cid = make_community("pkg-default", tier="enterprise", creator_username="pkg_owner2")
        assert em.package_included_for(cid, kb_default=True) is True
        assert em.package_included_for(cid, kb_default=False) is False

    def test_sub_community_inherits_the_root_clause(self):
        root = make_community("pkg-root", tier="enterprise", creator_username="pkg_owner3")
        em.set_steve_override(root, False)
        sub = make_community("pkg-sub", tier="free", parent_community_id=root)
        assert em.package_included_for(sub, kb_default=True) is False
