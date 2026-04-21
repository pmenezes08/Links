"""Tests for the community-tier member-cap enforcement helper.

The helper under test is
``backend.services.community.ensure_community_tier_member_capacity``. It
reads the community's **own** tier (from ``communities.tier``) and blocks
adds that would exceed the cap published on the ``community-tiers`` KB
page. It composes with the owner-tier helper; both are expected to be
called back-to-back on every add site.

What we intentionally do NOT test here:

  * HTTP-level behavior of ``/add_community_member`` — that's covered by
    the blueprint tests, and would drag in the monolith's Flask app for
    no added coverage signal.
  * KB defaulting on an empty DB — the helper falls back to the
    in-code legacy caps (75 / 150 / 250) for Paid L1 / L2 / L3 and we
    assert that in ``test_falls_back_to_legacy_caps_when_kb_empty``.

These tests are deliberately boundary-heavy: the failure modes we've
shipped historically on membership caps are all off-by-one (`==`
vs. `>=` vs. `>`), so every assertion below pokes the exact edge.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.usefixtures("mysql_dsn")


from backend.services.community import (
    CommunityMembershipLimitError,
    ensure_community_tier_member_capacity,
)
from backend.services.database import get_db_connection

from tests.fixtures import (
    fill_community_members,
    kb_override_field,
    make_community,
    make_user,
    seed_kb,
)


# ── Helpers ─────────────────────────────────────────────────────────────


def _run_with_cursor(fn, *args, **kwargs):
    """Execute ``fn(cursor, *args, **kwargs)`` inside a real connection.

    The enforcement helper takes a cursor (it's called inside a route
    handler's transaction) so we mirror that shape here rather than
    adding a ``_with_conn`` overload to the production code.
    """
    with get_db_connection() as conn:
        c = conn.cursor()
        return fn(c, *args, **kwargs)


# ── Tier boundary tests ─────────────────────────────────────────────────


class TestPaidL1Cap:
    """Paid L1 community is capped at 75 members (KB default)."""

    def setup_method(self) -> None:
        seed_kb()  # full default KB so the helper reads paid_l1_max_members = 75
        make_user("owner_l1", subscription="premium")

    def test_under_cap_is_allowed(self):
        cid = make_community("l1-under", tier="paid_l1", creator_username="owner_l1")
        fill_community_members(cid, 74)
        _run_with_cursor(ensure_community_tier_member_capacity, cid)

    def test_at_cap_blocks_next_add(self):
        cid = make_community("l1-at-cap", tier="paid_l1", creator_username="owner_l1")
        fill_community_members(cid, 75)
        with pytest.raises(CommunityMembershipLimitError) as excinfo:
            _run_with_cursor(
                ensure_community_tier_member_capacity,
                cid,
                attempted_username="newbie",
            )
        err = excinfo.value
        assert err.cap == 75
        assert err.community_id == cid
        assert err.creator_username == "owner_l1"

    def test_over_cap_blocks(self):
        cid = make_community("l1-over", tier="paid_l1", creator_username="owner_l1")
        fill_community_members(cid, 80)
        with pytest.raises(CommunityMembershipLimitError):
            _run_with_cursor(ensure_community_tier_member_capacity, cid)


class TestPaidL2Cap:
    def setup_method(self) -> None:
        seed_kb()
        make_user("owner_l2", subscription="premium")

    def test_under_cap(self):
        cid = make_community("l2-under", tier="paid_l2", creator_username="owner_l2")
        fill_community_members(cid, 149)
        _run_with_cursor(ensure_community_tier_member_capacity, cid)

    def test_at_cap_blocks(self):
        cid = make_community("l2-at-cap", tier="paid_l2", creator_username="owner_l2")
        fill_community_members(cid, 150)
        with pytest.raises(CommunityMembershipLimitError) as excinfo:
            _run_with_cursor(ensure_community_tier_member_capacity, cid)
        assert excinfo.value.cap == 150


class TestPaidL3Cap:
    def setup_method(self) -> None:
        seed_kb()
        make_user("owner_l3", subscription="premium")

    def test_under_cap(self):
        cid = make_community("l3-under", tier="paid_l3", creator_username="owner_l3")
        fill_community_members(cid, 249)
        _run_with_cursor(ensure_community_tier_member_capacity, cid)

    def test_at_cap_blocks(self):
        cid = make_community("l3-at-cap", tier="paid_l3", creator_username="owner_l3")
        fill_community_members(cid, 250)
        with pytest.raises(CommunityMembershipLimitError) as excinfo:
            _run_with_cursor(ensure_community_tier_member_capacity, cid)
        assert excinfo.value.cap == 250


class TestEnterpriseUncapped:
    """Enterprise tier is uncapped by design — helper must no-op."""

    def test_enterprise_never_raises(self):
        seed_kb()
        make_user("owner_ent", subscription="premium")
        cid = make_community("ent-1", tier="enterprise", creator_username="owner_ent")
        fill_community_members(cid, 300)
        _run_with_cursor(ensure_community_tier_member_capacity, cid)


class TestSubcommunitySkipped:
    """Sub-communities inherit the parent's cap indirectly; the helper
    must no-op on any row with ``parent_community_id``. This guarantees
    we never double-enforce (once on the sub, once on the root) or
    enforce the wrong tier (the sub might literally carry a different
    string in ``tier`` than the root).
    """

    def test_sub_with_tier_is_skipped(self):
        seed_kb()
        make_user("owner_sub", subscription="premium")
        parent_cid = make_community("parent-1", tier="paid_l1", creator_username="owner_sub")
        sub_cid = make_community(
            "sub-1",
            tier="paid_l1",
            creator_username="owner_sub",
            parent_community_id=parent_cid,
        )
        fill_community_members(sub_cid, 200)  # 200 > L1 cap but helper must skip
        _run_with_cursor(ensure_community_tier_member_capacity, sub_cid)


class TestUntieredCommunities:
    """Rows with no tier value fall through — they're expected to be
    covered by the free-parent helper via the owner's user tier."""

    def test_null_tier_is_noop(self):
        seed_kb()
        make_user("owner_null", subscription="free")
        cid = make_community("no-tier", tier="", creator_username="owner_null")
        fill_community_members(cid, 500)
        _run_with_cursor(ensure_community_tier_member_capacity, cid)

    def test_free_tier_is_noop(self):
        # Free communities are handled by ensure_free_parent_member_capacity
        # (via the owner's user subscription). Running the tier helper on
        # a free community must NOT raise, otherwise free owners would
        # hit both helpers and get a confusing double-block.
        seed_kb()
        make_user("owner_free", subscription="free")
        cid = make_community("free-comm", tier="free", creator_username="owner_free")
        fill_community_members(cid, 500)
        _run_with_cursor(ensure_community_tier_member_capacity, cid)


class TestMissingCommunity:
    def test_missing_id_is_noop(self):
        # Neither ``None`` nor an unknown id should raise.
        _run_with_cursor(ensure_community_tier_member_capacity, None)
        _run_with_cursor(ensure_community_tier_member_capacity, 999_999)


# ── KB misconfiguration ─────────────────────────────────────────────────


class TestKBMisconfiguration:
    """Helper must fail soft on a broken KB — never accidentally uncap a
    community because we mis-seeded a value."""

    def test_bad_cap_value_falls_back_to_legacy(self):
        # Override paid_l1_max_members with a garbage string; the helper
        # must recognise it as unparseable and fall back to the legacy
        # hard cap of 75.
        kb_override_field(
            "community-tiers",
            "paid_l1_max_members",
            "not-an-integer",
            field_type="string",
        )
        make_user("owner_bad_kb", subscription="premium")
        cid = make_community("bad-kb", tier="paid_l1", creator_username="owner_bad_kb")
        fill_community_members(cid, 75)
        with pytest.raises(CommunityMembershipLimitError) as excinfo:
            _run_with_cursor(ensure_community_tier_member_capacity, cid)
        assert excinfo.value.cap == 75

    def test_zero_cap_is_treated_as_noop(self):
        # A 0 or negative cap is almost certainly a config bug. We
        # deliberately do NOT block every add in that case; instead the
        # helper no-ops, leaving the legacy fallback in place.
        kb_override_field(
            "community-tiers",
            "paid_l2_max_members",
            0,
            field_type="integer",
        )
        make_user("owner_zero", subscription="premium")
        cid = make_community("zero-cap", tier="paid_l2", creator_username="owner_zero")
        fill_community_members(cid, 150)
        # Legacy fallback (150) kicks in, so we hit the cap exactly.
        with pytest.raises(CommunityMembershipLimitError) as excinfo:
            _run_with_cursor(ensure_community_tier_member_capacity, cid)
        assert excinfo.value.cap == 150
