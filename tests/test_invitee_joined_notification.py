"""The inviter's "your invitee joined" moment (community_invites.notify_community_new_member)."""

from __future__ import annotations

import pytest

from backend.services import community_invites, i18n
from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


@pytest.fixture(autouse=True)
def _catalogs():
    i18n.reload_catalogs()
    yield


def _attach_member(username: str, community_id: int) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        user_id = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role) VALUES ({ph}, {ph}, 'member')",
            (int(user_id), community_id),
        )
        conn.commit()


def _set_broadcast(community_id: int, enabled: bool) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE communities SET notify_on_new_member = {ph} WHERE id = {ph}",
            (1 if enabled else 0, community_id),
        )
        conn.commit()


def _capture_sends(monkeypatch):
    notifications, pushes = [], []
    monkeypatch.setattr(
        community_invites,
        "create_notification",
        lambda *args, **kwargs: notifications.append((args, kwargs)),
    )

    def fake_push(target_username, payload):
        assert isinstance(payload, dict) and "title" in payload
        pushes.append((target_username, payload))

    monkeypatch.setattr(community_invites, "send_push_to_user", fake_push)
    return notifications, pushes


def _setup(monkeypatch, *, broadcast: bool):
    make_user("inv_newbie")
    make_user("inv_sender")
    make_user("inv_other")
    cid = make_community("Invite Test", creator_username="inv_sender")
    _attach_member("inv_sender", cid)
    _attach_member("inv_other", cid)
    _set_broadcast(cid, broadcast)
    return cid, _capture_sends(monkeypatch)


def _types_by_recipient(notifications):
    return {(args[0]): args[2] for args, _kwargs in notifications}


def test_inviter_gets_distinguished_moment_others_get_broadcast(monkeypatch):
    cid, (notifications, pushes) = _setup(monkeypatch, broadcast=True)

    with get_db_connection() as conn:
        community_invites.notify_community_new_member(
            cid, "inv_newbie", conn, inviter_username="inv_sender"
        )

    types = _types_by_recipient(notifications)
    assert types["inv_sender"] == "invitee_joined"
    assert types["inv_other"] == "new_member"
    # The inviter is excluded from the generic broadcast — one moment, not two.
    sender_rows = [a for a, _k in notifications if a[0] == "inv_sender"]
    assert len(sender_rows) == 1
    # Localized message with both params resolved.
    inviter_args, inviter_kwargs = next(
        (a, k) for a, k in notifications if a[0] == "inv_sender"
    )
    assert "inv_newbie" in inviter_kwargs["message"]
    assert "Invite Test" in inviter_kwargs["message"]
    inviter_push = next(p for u, p in pushes if u == "inv_sender")
    assert inviter_push["tag"] == f"invitee_joined_{cid}_inv_newbie"


def test_inviter_moment_fires_even_when_broadcast_disabled(monkeypatch):
    cid, (notifications, pushes) = _setup(monkeypatch, broadcast=False)

    with get_db_connection() as conn:
        community_invites.notify_community_new_member(
            cid, "inv_newbie", conn, inviter_username="inv_sender"
        )

    types = _types_by_recipient(notifications)
    assert types == {"inv_sender": "invitee_joined"}  # no generic broadcast


def test_no_inviter_keeps_legacy_broadcast_shape(monkeypatch):
    cid, (notifications, pushes) = _setup(monkeypatch, broadcast=True)

    with get_db_connection() as conn:
        community_invites.notify_community_new_member(cid, "inv_newbie", conn)

    types = _types_by_recipient(notifications)
    assert types == {"inv_sender": "new_member", "inv_other": "new_member"}


def test_self_invite_gets_no_invitee_joined(monkeypatch):
    cid, (notifications, pushes) = _setup(monkeypatch, broadcast=True)

    with get_db_connection() as conn:
        community_invites.notify_community_new_member(
            cid, "inv_newbie", conn, inviter_username="inv_newbie"
        )

    assert "invitee_joined" not in _types_by_recipient(notifications).values()


def test_non_member_inviter_gets_nothing(monkeypatch):
    cid, (notifications, pushes) = _setup(monkeypatch, broadcast=True)
    make_user("inv_outsider")

    with get_db_connection() as conn:
        community_invites.notify_community_new_member(
            cid, "inv_newbie", conn, inviter_username="inv_outsider"
        )

    types = _types_by_recipient(notifications)
    assert "inv_outsider" not in types
    assert types == {"inv_sender": "new_member", "inv_other": "new_member"}
