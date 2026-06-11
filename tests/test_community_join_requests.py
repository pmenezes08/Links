"""Find-by-handle lookup + join requests — privacy and flow invariants.

Locks down:
  1. Non-enumeration — nonexistent handle, non-discoverable community,
     and sub-community handle return byte-identical responses.
  2. Lookup payload allowlist — bucketed member count, no owner, no
     member list, nothing structural.
  3. Request lifecycle — single pending row per (community, user),
     idempotent re-request, withdraw, and the silent-expiry decline:
     a rejected requester keeps seeing "pending" during the cooldown
     and the decline writes nothing requester-visible.
  4. Accept parity — membership write goes through the (stubbed) shared
     join path; cap errors leave the request pending.
  5. Rate limiting — lookup returns 429 past the window limit.
"""

from __future__ import annotations

import pytest

from backend.services import community_join_requests as cjr
from backend.services.community import CommunityMembershipLimitError
from backend.services.community_handles import ensure_handle_columns
from backend.services.database import get_db_connection, get_sql_placeholder

from tests.fixtures import make_community, make_user


@pytest.fixture(autouse=True)
def _clear_rate_limit_cache():
    from redis_cache import cache as shared_cache

    for store in ("cache", "expiry"):
        try:
            getattr(shared_cache, store).clear()
        except Exception:
            pass
    yield


@pytest.fixture(autouse=True)
def _stub_side_effects(monkeypatch):
    """Stub the heavy collaborators: monolith join helpers, Steve welcome,
    and notification fan-out. The service's orchestration is under test,
    not their internals (each has its own suite)."""
    def _join(cursor, user_id, community_id, *, username=None):
        ph = get_sql_placeholder()
        cursor.execute(
            f"INSERT INTO user_communities (user_id, community_id, role) VALUES ({ph}, {ph}, 'member')",
            (int(user_id), int(community_id)),
        )

    monkeypatch.setattr(cjr, "_add_user_to_community", _join)
    monkeypatch.setattr(cjr, "_has_manage_permission", lambda u, cid: u == "owner")
    monkeypatch.setattr(cjr, "ensure_introduce_yourself_thread", lambda c, cid: None)
    monkeypatch.setattr(cjr, "mirror_introduce_yourself_thread", lambda pid, cid: None)
    monkeypatch.setattr(cjr, "notify_community_new_member", lambda *a, **k: None)
    notifications = []
    monkeypatch.setattr(cjr, "create_notification", lambda *a, **k: notifications.append((a, k)))
    monkeypatch.setattr(cjr, "send_push_to_user", lambda *a, **k: None)
    monkeypatch.setattr(cjr.notification_copy, "recipient_locale", lambda u: "en")
    yield notifications


def _make_findable(name: str, owner: str, *, discoverable: bool = True) -> tuple:
    """Community with a handle; returns (id, handle)."""
    ensure_handle_columns()
    cjr.ensure_tables()
    cid = make_community(name, creator_username=owner)
    handle = name.lower().replace(" ", "-")
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE communities SET handle = {ph}, discoverable = {ph} WHERE id = {ph}",
            (handle, 1 if discoverable else 0, cid),
        )
        conn.commit()
    return cid, handle


def _join_member(username: str, community_id: int) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        uid = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role) VALUES ({ph}, {ph}, 'member')",
            (int(uid), int(community_id)),
        )
        conn.commit()


def _request_row(community_id: int, username: str) -> dict:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT status, decided_by FROM community_join_requests WHERE community_id = {ph} AND username = {ph}",
            (community_id, username),
        )
        row = c.fetchone()
    if not row:
        return {}
    return dict(row) if hasattr(row, "keys") else {"status": row[0], "decided_by": row[1]}


# ── 1 + 2. Lookup ───────────────────────────────────────────────────────


class TestLookup:
    def test_non_enumeration_three_doors_one_answer(self, mysql_dsn):
        make_user("seeker")
        make_user("owner")
        # Non-discoverable community with a handle:
        _make_findable("Hidden Club", "owner", discoverable=False)
        # Sub-community with a (hand-planted) handle:
        root = make_community("Root Host", creator_username="owner")
        sub = make_community("Sub Spot", creator_username="owner", parent_community_id=root)
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"UPDATE communities SET handle = 'sub-spot', discoverable = 1 WHERE id = {ph}", (sub,))
            conn.commit()

        missing = cjr.lookup_by_handle("seeker", "does-not-exist")
        hidden = cjr.lookup_by_handle("seeker", "hidden-club")
        nested = cjr.lookup_by_handle("seeker", "sub-spot")

        assert missing == hidden == nested  # identical body AND status

    def test_lookup_payload_allowlist(self, mysql_dsn):
        make_user("seeker")
        make_user("owner")
        cid, handle = _make_findable("Open House", "owner")
        _join_member("owner", cid)

        body, status = cjr.lookup_by_handle("seeker", f"@{handle.upper()}")
        assert status == 200
        community = body["community"]
        assert community["name"] == "Open House"
        assert community["handle"] == handle
        assert community["member_bucket"] == "<10"  # bucketed, never exact
        assert community["already_member"] is False
        assert "creator_username" not in community
        assert "member_count" not in community

    def test_member_sees_already_member(self, mysql_dsn):
        make_user("owner")
        cid, handle = _make_findable("My Place", "owner")
        _join_member("owner", cid)
        body, _ = cjr.lookup_by_handle("owner", handle)
        assert body["community"]["already_member"] is True

    def test_lookup_rate_limited(self, mysql_dsn, monkeypatch):
        make_user("scanner")
        monkeypatch.setattr(cjr, "LOOKUP_RATE_LIMIT", (3, 60))
        for _ in range(3):
            cjr.lookup_by_handle("scanner", "whatever")
        body, status = cjr.lookup_by_handle("scanner", "whatever")
        assert status == 429


# ── 3. Request lifecycle ────────────────────────────────────────────────


class TestRequestLifecycle:
    def test_create_is_idempotent_single_pending_row(self, mysql_dsn, _stub_side_effects):
        make_user("knocker")
        make_user("owner")
        cid, _ = _make_findable("Door One", "owner")

        first, s1 = cjr.create_request("knocker", cid)
        second, s2 = cjr.create_request("knocker", cid)
        assert (s1, s2) == (200, 200)
        assert first["request_status"] == second["request_status"] == "pending"

        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"SELECT COUNT(*) AS n FROM community_join_requests WHERE community_id = {ph} AND username = {ph}",
                (cid, "knocker"),
            )
            row = c.fetchone()
        assert int(row["n"] if hasattr(row, "keys") else row[0]) == 1

    def test_request_refused_through_closed_door(self, mysql_dsn):
        make_user("knocker")
        make_user("owner")
        cid, _ = _make_findable("Closed Door", "owner", discoverable=False)
        body, status = cjr.create_request("knocker", cid)
        assert status == 404  # same closed door as the lookup

    def test_withdraw_then_re_request(self, mysql_dsn):
        make_user("knocker")
        make_user("owner")
        cid, _ = _make_findable("Revolving Door", "owner")
        cjr.create_request("knocker", cid)
        cjr.withdraw_request("knocker", cid)
        assert _request_row(cid, "knocker")["status"] == "withdrawn"
        body, _ = cjr.create_request("knocker", cid)
        assert body["request_status"] == "pending"
        assert _request_row(cid, "knocker")["status"] == "pending"

    def test_decline_is_silent_and_cooldown_holds(self, mysql_dsn):
        make_user("knocker")
        make_user("owner")
        cid, handle = _make_findable("Polite House", "owner")
        cjr.create_request("knocker", cid)
        cjr.decide_request("owner", cid, "knocker", "reject")

        # DB knows the truth…
        assert _request_row(cid, "knocker")["status"] == "rejected"
        # …the requester does not: lookup still reads pending,
        body, _ = cjr.lookup_by_handle("knocker", handle)
        assert body["community"]["request_status"] == "pending"
        # …and a re-knock inside the cooldown changes nothing.
        again, status = cjr.create_request("knocker", cid)
        assert status == 200
        assert again["request_status"] == "pending"
        assert _request_row(cid, "knocker")["status"] == "rejected"


# ── 4. Owner decisions ──────────────────────────────────────────────────


class TestDecisions:
    def test_non_manager_cannot_decide(self, mysql_dsn):
        make_user("knocker")
        make_user("owner")
        make_user("rando")
        cid, _ = _make_findable("Guarded", "owner")
        cjr.create_request("knocker", cid)
        body, status = cjr.decide_request("rando", cid, "knocker", "accept")
        assert status == 403

    def test_accept_joins_and_notifies_requester(self, mysql_dsn, _stub_side_effects):
        make_user("knocker")
        make_user("owner")
        cid, _ = _make_findable("Welcoming", "owner")
        cjr.create_request("knocker", cid)
        _stub_side_effects.clear()  # drop the admin-notify entries

        body, status = cjr.decide_request("owner", cid, "knocker", "accept")
        assert status == 200
        assert body["status"] == "accepted"
        assert _request_row(cid, "knocker")["status"] == "accepted"

        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""SELECT 1 FROM user_communities uc JOIN users u ON uc.user_id = u.id
                    WHERE uc.community_id = {ph} AND u.username = {ph}""",
                (cid, "knocker"),
            )
            assert c.fetchone() is not None
        # Exactly one notification: the requester's acceptance. No decline
        # notification exists anywhere in this module by design.
        assert len(_stub_side_effects) == 1
        assert _stub_side_effects[0][0][2] == "community_join_request_accepted"

    def test_cap_block_leaves_request_pending(self, mysql_dsn, monkeypatch):
        make_user("knocker")
        make_user("owner")
        cid, _ = _make_findable("Full House", "owner")
        cjr.create_request("knocker", cid)

        def _blocked(cursor, user_id, community_id, *, username=None):
            raise CommunityMembershipLimitError(
                community_id=community_id,
                community_name="Full House",
                cap=1,
                attempted_username=username,
                creator_username="owner",
            )

        monkeypatch.setattr(cjr, "_add_user_to_community", _blocked)
        monkeypatch.setattr(cjr, "render_member_cap_error", lambda exc, session_username=None: ({"success": False, "reason_code": "community_member_limit"}, 403))

        body, status = cjr.decide_request("owner", cid, "knocker", "accept")
        assert status == 403
        assert _request_row(cid, "knocker")["status"] == "pending"


class TestManagerSurfaces:
    def test_pending_list_and_count(self, mysql_dsn):
        make_user("knocker")
        make_user("knocker2")
        make_user("owner")
        cid, _ = _make_findable("Busy Door", "owner")
        cjr.create_request("knocker", cid)
        cjr.create_request("knocker2", cid)

        listing, _ = cjr.list_pending_for_manager("owner")
        assert {r["username"] for r in listing["requests"]} == {"knocker", "knocker2"}

        count, _ = cjr.pending_count_for_community("owner", cid)
        assert count["count"] == 2
        assert len(count["requesters"]) == 2
