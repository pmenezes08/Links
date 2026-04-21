"""Phase 1 — structured member-cap exception + owner notification.

Locks in three contracts exercised by the refactor:

  1. ``ensure_free_parent_member_capacity`` raises
     :class:`~backend.services.community.CommunityMembershipLimitError`
     with the structured attributes the blueprint relies on
     (``community_id``, ``community_name``, ``cap``,
     ``attempted_username``, ``creator_username``). The legacy
     ``str(exc)`` payload never ends up in the client response anymore.

  2. :func:`~backend.services.community.render_member_cap_error` branches
     on ownership — owners see the "paid tiers coming soon" copy,
     invitees see the neutral "reach out to the owner/admin" message,
     and never sees the word "Upgrade".

  3. :func:`~backend.services.notifications.notify_community_member_blocked`
     inserts a single in-app notification for the community owner on
     the first blocked attempt, and **dedupes** identical attempts
     within the 24 h window so a spammy invite link can't flood the
     bell.

We deliberately exercise these via the service layer (not HTTP) so the
tests stay fast and don't drag in the monolith's 300+ Flask routes.
"""

from __future__ import annotations

import pytest

from backend.services.community import (
    CommunityMembershipLimitError,
    ensure_free_parent_member_capacity,
    render_member_cap_error,
)
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.notifications import notify_community_member_blocked

from tests.fixtures import days_ago, kb_override_field, make_user


# ── helpers ─────────────────────────────────────────────────────────────


def _make_free_community(*, owner: str, name: str = "cap-test") -> int:
    """Insert a Free-tier community owned by ``owner`` and return its id.

    We bypass :func:`tests.fixtures.make_community` because it doesn't set
    ``creator_username``, which the refactored helper reads to decide
    whether enforcement applies.
    """
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO communities (name, tier, creator_username) "
            f"VALUES ({ph}, {ph}, {ph})",
            (name, "free", owner),
        )
        cid = c.lastrowid
        try:
            conn.commit()
        except Exception:
            pass
    return int(cid)


def _seed_members(community_id: int, count: int) -> list[int]:
    """Insert ``count`` synthetic users and attach them to the community.

    Returns the list of user_ids so the test body can assert against
    counts if needed.
    """
    ph = get_sql_placeholder()
    ids: list[int] = []
    with get_db_connection() as conn:
        c = conn.cursor()
        for i in range(count):
            uname = f"synthetic_{i}"
            c.execute(
                f"INSERT INTO users (username, email, subscription) "
                f"VALUES ({ph}, {ph}, 'free')",
                (uname, f"{uname}@test.local"),
            )
            uid = int(c.lastrowid)
            ids.append(uid)
            c.execute(
                f"INSERT INTO user_communities (user_id, community_id, role) "
                f"VALUES ({ph}, {ph}, 'member')",
                (uid, community_id),
            )
        try:
            conn.commit()
        except Exception:
            pass
    return ids


def _count_notifications(*, user_id: str, community_id: int) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT COUNT(*) FROM notifications "
            f"WHERE user_id = {ph} AND community_id = {ph} "
            f"AND type = 'member_blocked'",
            (user_id, community_id),
        )
        row = c.fetchone()
        if not row:
            return 0
        if hasattr(row, "keys"):
            return int(list(row.values())[0] or 0)
        return int(row[0] or 0)


# ── 1. Structured exception ────────────────────────────────────────────


class TestExceptionPayload:
    """The raised exception carries the attributes the blueprint renders."""

    def test_raises_with_cap_and_ids_at_26th_member(self, mysql_dsn):
        make_user("owner_a", subscription="free", created_at=days_ago(60))
        kb_override_field(
            "user-tiers", "free_members_per_owned_community", 25,
        )
        cid = _make_free_community(owner="owner_a", name="owner_a_community")
        _seed_members(cid, 25)

        with get_db_connection() as conn:
            c = conn.cursor()
            with pytest.raises(CommunityMembershipLimitError) as excinfo:
                ensure_free_parent_member_capacity(
                    c, cid, extra_members=1,
                    attempted_username="invitee_bob",
                )

        exc = excinfo.value
        assert exc.cap == 25
        assert exc.community_id == cid
        assert exc.community_name == "owner_a_community"
        assert exc.attempted_username == "invitee_bob"
        assert exc.creator_username == "owner_a"

    def test_does_not_raise_at_exact_cap(self, mysql_dsn):
        """25 seated members + extra_members=0 must not trip the check."""
        make_user("owner_b", subscription="free", created_at=days_ago(60))
        kb_override_field(
            "user-tiers", "free_members_per_owned_community", 25,
        )
        cid = _make_free_community(owner="owner_b")
        _seed_members(cid, 25)

        with get_db_connection() as conn:
            c = conn.cursor()
            # Should not raise.
            ensure_free_parent_member_capacity(
                c, cid, extra_members=0,
                attempted_username="noop",
            )

    def test_premium_owner_is_not_enforced(self, mysql_dsn):
        """Premium-owned communities skip the Free cap entirely."""
        make_user("owner_c", subscription="premium", created_at=days_ago(60))
        kb_override_field(
            "user-tiers", "free_members_per_owned_community", 25,
        )
        cid = _make_free_community(owner="owner_c")
        _seed_members(cid, 25)

        with get_db_connection() as conn:
            c = conn.cursor()
            # Should not raise — Premium owners are uncapped here.
            ensure_free_parent_member_capacity(
                c, cid, extra_members=1,
                attempted_username="invitee_26",
            )


# ── 2. User-facing copy ────────────────────────────────────────────────


class TestRenderMemberCapError:
    """``render_member_cap_error`` branches on ownership and never leaks 'Upgrade'."""

    @pytest.fixture
    def exc(self):
        return CommunityMembershipLimitError(
            community_id=42,
            community_name="Owner's Club",
            cap=25,
            attempted_username="invitee_bob",
            creator_username="owner_a",
        )

    def test_owner_sees_coming_soon(self, exc):
        payload, status = render_member_cap_error(exc, session_username="owner_a")
        assert status == 403
        assert payload["reason_code"] == "community_member_limit"
        assert payload["community_id"] == 42
        assert "coming soon" in payload["error"].lower()
        assert "25" in payload["error"]

    def test_invitee_sees_neutral_copy_no_upgrade_cta(self, exc):
        payload, status = render_member_cap_error(exc, session_username="invitee_bob")
        assert status == 403
        assert payload["reason_code"] == "community_member_limit"
        # Critical: the word "upgrade" must never reach a non-owner.
        # That was the original bug — it leaked a CTA the invitee can't act on.
        assert "upgrade" not in payload["error"].lower()
        assert "owner" in payload["error"].lower() or "admin" in payload["error"].lower()

    def test_owner_check_is_case_insensitive(self, exc):
        """Session names come through with their stored casing; we lowercase
        on both sides before comparing so ``Owner_A`` / ``owner_a`` match."""
        payload_lower, _ = render_member_cap_error(exc, session_username="OWNER_A")
        assert "coming soon" in payload_lower["error"].lower()

    def test_anon_session_falls_through_to_invitee_copy(self, exc):
        """Missing session username is treated as "not the owner"."""
        payload, _ = render_member_cap_error(exc, session_username=None)
        assert "upgrade" not in payload["error"].lower()


# ── 3. Owner notification + dedupe ─────────────────────────────────────


class TestNotifyCommunityMemberBlocked:
    def test_first_blocked_attempt_inserts_notification_for_owner(self, mysql_dsn):
        make_user("owner_n", subscription="free", created_at=days_ago(60))
        cid = _make_free_community(owner="owner_n", name="Notify Me")

        with get_db_connection() as conn:
            c = conn.cursor()
            inserted = notify_community_member_blocked(
                c,
                community_id=cid,
                community_name="Notify Me",
                attempted_username="invitee_bob",
                cap=25,
            )
            conn.commit()

        assert inserted == 1
        assert _count_notifications(user_id="owner_n", community_id=cid) == 1

    def test_dedupes_second_attempt_within_window(self, mysql_dsn):
        """Two identical blocks within 24 h collapse into one notification."""
        make_user("owner_n2", subscription="free", created_at=days_ago(60))
        cid = _make_free_community(owner="owner_n2")

        with get_db_connection() as conn:
            c = conn.cursor()
            notify_community_member_blocked(
                c,
                community_id=cid,
                community_name="cap-test",
                attempted_username="invitee_alice",
                cap=25,
            )
            conn.commit()

            inserted_second = notify_community_member_blocked(
                c,
                community_id=cid,
                community_name="cap-test",
                attempted_username="invitee_alice",
                cap=25,
            )
            conn.commit()

        assert inserted_second == 0
        assert _count_notifications(user_id="owner_n2", community_id=cid) == 1

    def test_message_mentions_the_blocked_username_and_cap(self, mysql_dsn):
        make_user("owner_n3", subscription="free", created_at=days_ago(60))
        cid = _make_free_community(owner="owner_n3", name="My Community")

        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            notify_community_member_blocked(
                c,
                community_id=cid,
                community_name="My Community",
                attempted_username="eve_spammer",
                cap=25,
            )
            conn.commit()

            c.execute(
                f"SELECT message, link FROM notifications "
                f"WHERE user_id = {ph} AND community_id = {ph} "
                f"AND type = 'member_blocked'",
                ("owner_n3", cid),
            )
            row = c.fetchone()

        assert row is not None
        msg = row["message"] if hasattr(row, "keys") else row[0]
        link = row["link"] if hasattr(row, "keys") else row[1]
        assert "eve_spammer" in msg
        assert "My Community" in msg
        assert "25" in msg
        assert "coming soon" in msg.lower()
        # No link in this release — paid-tier upgrade surface ships later.
        assert link is None or link == ""

    def test_end_to_end_block_fires_notification(self, mysql_dsn):
        """The enforcement helper calls the notifier automatically on raise."""
        make_user("owner_e2e", subscription="free", created_at=days_ago(60))
        kb_override_field(
            "user-tiers", "free_members_per_owned_community", 25,
        )
        cid = _make_free_community(owner="owner_e2e", name="E2E Community")
        _seed_members(cid, 25)

        with get_db_connection() as conn:
            c = conn.cursor()
            with pytest.raises(CommunityMembershipLimitError):
                ensure_free_parent_member_capacity(
                    c, cid, extra_members=1,
                    attempted_username="invitee_26",
                )
            conn.commit()

        assert _count_notifications(user_id="owner_e2e", community_id=cid) == 1
