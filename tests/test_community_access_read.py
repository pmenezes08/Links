"""Unit tests for ``community_access.can_view_community_content``.

This is the shared READ-authorization policy behind the community post-detail,
reply, reaction, and feed surfaces (privacy IDOR gate). It mirrors the community
feed's membership rule: allow app admins, the creator, direct members, and
admins/owners of an ancestor community; general / home-feed posts (no
``community_id``) stay public.
"""

from __future__ import annotations

from datetime import datetime

from backend.services.community_access import (
    can_view_community_content,
    can_view_poll,
    can_view_post,
    can_view_reply,
)
from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _join(username: str, community_id: int, role: str = "member") -> None:
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        uid = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role, joined_at) "
            f"VALUES ({ph}, {ph}, {ph}, {ph})",
            (int(uid), community_id, role, ts),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _check(username: str, community_id):
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        return can_view_community_content(c, ph, username, community_id)


def test_general_feed_post_is_public(mysql_dsn):
    make_user("ca_anyone")
    # No community (None) and the legacy general id (0) are both public.
    assert _check("ca_anyone", None) == (True, None)
    assert _check("ca_anyone", 0) == (True, None)


def test_nonexistent_community_is_not_found(mysql_dsn):
    make_user("ca_user")
    allowed, reason = _check("ca_user", 99999999)
    assert allowed is False
    assert reason == "not_found"


def test_non_member_is_forbidden(mysql_dsn):
    make_user("ca_owner")
    make_user("ca_outsider")
    cid = make_community("ca-private", creator_username="ca_owner")
    allowed, reason = _check("ca_outsider", cid)
    assert allowed is False
    assert reason == "forbidden"


def test_direct_member_allowed(mysql_dsn):
    make_user("ca_owner2")
    make_user("ca_member")
    cid = make_community("ca-priv2", creator_username="ca_owner2")
    _join("ca_member", cid)
    assert _check("ca_member", cid) == (True, None)


def test_creator_allowed_without_membership_row(mysql_dsn):
    make_user("ca_creator")
    cid = make_community("ca-priv3", creator_username="ca_creator")
    # The creator has no user_communities row but is still allowed.
    assert _check("ca_creator", cid) == (True, None)


def test_app_admin_allowed(mysql_dsn):
    make_user("ca_admin", is_admin=True)
    make_user("ca_owner3")
    cid = make_community("ca-priv4", creator_username="ca_owner3")
    allowed, _ = _check("ca_admin", cid)
    assert allowed is True


def test_member_match_is_case_insensitive(mysql_dsn):
    # is_app_admin / membership joins compare usernames case-insensitively
    # elsewhere; the creator short-circuit here is exact, but membership rows
    # are matched via the users table, so a member is recognized regardless of
    # how the session spells their name.
    make_user("ca_owner_ci")
    make_user("CaMember_CI")
    cid = make_community("ca-ci", creator_username="ca_owner_ci")
    _join("CaMember_CI", cid)
    allowed, _ = _check("CaMember_CI", cid)
    assert allowed is True


def test_ancestor_admin_can_view_sub_community(mysql_dsn):
    make_user("ca_root_admin")
    make_user("ca_sub_owner")
    parent = make_community("ca-parent", creator_username="ca_sub_owner")
    child = make_community(
        "ca-child", creator_username="ca_sub_owner", parent_community_id=parent
    )
    # Admin of the PARENT, not a member of the child — cascades down.
    _join("ca_root_admin", parent, role="admin")
    allowed, _ = _check("ca_root_admin", child)
    assert allowed is True


def test_plain_parent_member_cannot_view_child(mysql_dsn):
    """Characterization: only ancestor admins/owners cascade down, not plain
    parent members — mirrors the community feed's exact policy so post-detail
    access stays consistent with feed visibility."""
    make_user("ca_p_owner")
    make_user("ca_p_member")
    parent = make_community("ca-parent2", creator_username="ca_p_owner")
    child = make_community(
        "ca-child2", creator_username="ca_p_owner", parent_community_id=parent
    )
    _join("ca_p_member", parent, role="member")
    allowed, reason = _check("ca_p_member", child)
    assert allowed is False
    assert reason == "forbidden"


# ── Resolver helpers (post / reply / poll -> community) ──────────────────────


def _insert_post(community_id, username: str, content: str = "x") -> int:
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO posts (username, content, timestamp, community_id) "
            f"VALUES ({ph}, {ph}, {ph}, {ph})",
            (username, content, ts, community_id),
        )
        pid = int(c.lastrowid)
        try:
            conn.commit()
        except Exception:
            pass
        return pid


def _insert_reply(post_id: int, community_id, username: str) -> int:
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO replies (post_id, community_id, username, content, timestamp) "
            f"VALUES ({ph}, {ph}, {ph}, {ph}, {ph})",
            (post_id, community_id, username, "r", ts),
        )
        rid = int(c.lastrowid)
        try:
            conn.commit()
        except Exception:
            pass
        return rid


def _insert_poll(post_id: int, created_by: str) -> int:
    ph = get_sql_placeholder()
    ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO polls (post_id, question, created_by, created_at) "
            f"VALUES ({ph}, {ph}, {ph}, {ph})",
            (post_id, "Q?", created_by, ts),
        )
        pid = int(c.lastrowid)
        try:
            conn.commit()
        except Exception:
            pass
        return pid


def _resolve(fn, username: str, target_id):
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        return fn(c, ph, username, target_id)


def test_can_view_post_resolves_community(mysql_dsn):
    make_user("cvp_owner")
    make_user("cvp_member")
    make_user("cvp_out")
    cid = make_community("cvp-comm", creator_username="cvp_owner")
    _join("cvp_member", cid)
    pid = _insert_post(cid, "cvp_owner")

    assert _resolve(can_view_post, "cvp_member", pid)[0] is True
    allowed, reason = _resolve(can_view_post, "cvp_out", pid)
    assert allowed is False
    assert reason == "forbidden"


def test_can_view_post_general_feed_and_missing_are_lenient(mysql_dsn):
    make_user("cvp_anyone")
    gen_pid = _insert_post(None, "cvp_anyone")
    # General-feed post stays public; a missing post is left to the caller's own
    # existence check rather than the gate.
    assert _resolve(can_view_post, "cvp_anyone", gen_pid) == (True, None)
    assert _resolve(can_view_post, "cvp_anyone", 99999999) == (True, None)


def test_can_view_reply_resolves_via_parent_post(mysql_dsn):
    make_user("cvr_owner")
    make_user("cvr_member")
    make_user("cvr_out")
    cid = make_community("cvr-comm", creator_username="cvr_owner")
    _join("cvr_member", cid)
    pid = _insert_post(cid, "cvr_owner")
    rid = _insert_reply(pid, cid, "cvr_owner")

    assert _resolve(can_view_reply, "cvr_member", rid)[0] is True
    allowed, reason = _resolve(can_view_reply, "cvr_out", rid)
    assert allowed is False
    assert reason == "forbidden"


def test_can_view_poll_resolves_via_post(mysql_dsn):
    make_user("cvq_owner")
    make_user("cvq_member")
    make_user("cvq_out")
    cid = make_community("cvq-comm", creator_username="cvq_owner")
    _join("cvq_member", cid)
    pid = _insert_post(cid, "cvq_owner")
    poll_id = _insert_poll(pid, "cvq_owner")

    assert _resolve(can_view_poll, "cvq_member", poll_id)[0] is True
    allowed, reason = _resolve(can_view_poll, "cvq_out", poll_id)
    assert allowed is False
    assert reason == "forbidden"
