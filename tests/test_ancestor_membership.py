"""Joining a nested community implies joining its whole ancestor chain.

Founder rule (July 2026, TAP onboarding): an invite to a nested community
(root -> sub -> nested) must also add the member to the owning
sub-community and the root network. Root-scoped surfaces (feeds, member
lists, the groups directory) only see members of the communities they are
scoped to, so a nested-only membership left invitees half-invisible.

``ensure_ancestor_memberships`` runs inside ``add_user_to_community`` -- the
single chokepoint used by invites, join requests, and admin adds -- BEFORE
the target insert, root-first, so a capped root aborts the whole join.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.usefixtures("mysql_dsn")


from backend.services.community import (
    CommunityMembershipLimitError,
    ensure_ancestor_memberships,
)
from backend.services.database import get_db_connection, get_sql_placeholder

from tests.fixtures import (
    days_ago,
    fill_community_members,
    kb_override_field,
    make_community,
    make_user,
)


def _member_rows(user_id: int) -> set[int]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT community_id FROM user_communities WHERE user_id = {ph}",
            (user_id,),
        )
        return {
            int(r["community_id"] if hasattr(r, "keys") else r[0])
            for r in (c.fetchall() or [])
        }


def _run(user_id: int, community_id: int, username: str | None = None):
    with get_db_connection() as conn:
        c = conn.cursor()
        result = ensure_ancestor_memberships(c, user_id, community_id, username=username)
        try:
            conn.commit()
        except Exception:
            pass
        return result


class TestAncestorChainJoin:
    def test_nested_join_adds_sub_and_root(self):
        """The TAP shape: invite to PNT also lands in Pessoal Navegante + root."""
        u = make_user("anc_member")
        root = make_community("anc-root", tier="enterprise", creator_username="anc_owner")
        sub = make_community("anc-sub", tier="free", parent_community_id=root)
        nested = make_community("anc-nested", tier="free", parent_community_id=sub)

        added = _run(int(u["id"]), nested)

        assert set(added) == {root, sub}
        assert _member_rows(int(u["id"])) == {root, sub}  # target row is the caller's job

    def test_idempotent_when_already_in_ancestors(self):
        u = make_user("anc_repeat")
        root = make_community("anc-root2", tier="enterprise", creator_username="anc_owner2")
        sub = make_community("anc-sub2", tier="free", parent_community_id=root)

        first = _run(int(u["id"]), sub)
        second = _run(int(u["id"]), sub)

        assert first == [root]
        assert second == []
        assert _member_rows(int(u["id"])) == {root}

    def test_partial_chain_fills_only_the_gaps(self):
        """Already in the root -> only the intermediate sub is added."""
        u = make_user("anc_partial")
        root = make_community("anc-root3", tier="enterprise", creator_username="anc_owner3")
        sub = make_community("anc-sub3", tier="free", parent_community_id=root)
        nested = make_community("anc-nested3", tier="free", parent_community_id=sub)
        fill_community_members(root, 0)  # ensure table exists on lean schemas
        # Seed the root membership directly.
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"INSERT INTO user_communities (user_id, community_id, role) VALUES ({ph}, {ph}, 'member')",
                (int(u["id"]), root),
            )
            conn.commit()

        added = _run(int(u["id"]), nested)

        assert added == [sub]
        assert _member_rows(int(u["id"])) == {root, sub}

    def test_capped_free_root_aborts_the_chain(self):
        """A full Free root rejects the nested invite exactly like a direct join."""
        make_user("anc_free_owner", subscription="free", created_at=days_ago(60))
        kb_override_field("user-tiers", "free_members_per_owned_community", 25)
        u = make_user("anc_blocked")
        root = make_community("anc-free-root", tier="free", creator_username="anc_free_owner")
        sub = make_community("anc-free-sub", tier="free", parent_community_id=root)
        fill_community_members(root, 25)

        with pytest.raises(CommunityMembershipLimitError):
            _run(int(u["id"]), sub, username="anc_blocked")

        assert _member_rows(int(u["id"])) == set()

    def test_root_join_is_a_noop(self):
        u = make_user("anc_root_only")
        root = make_community("anc-root4", tier="free", creator_username="anc_owner4")
        assert _run(int(u["id"]), root) == []
