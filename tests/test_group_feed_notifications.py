"""Group feed fan-out: in-app + push hooks."""

from __future__ import annotations

from tests.fixtures import make_community, make_user
from tests.test_group_feed_blueprint import (
    _add_group_member,
    _insert_group,
    _insert_group_post,
    _insert_group_reply,
)


def test_fanout_group_post_notifies_other_members(monkeypatch, mysql_dsn):
    calls = []
    pushes = []

    def capture_create(*args, **kwargs):
        calls.append((args, kwargs))

    def capture_push(username, payload):
        pushes.append((username, payload))

    monkeypatch.setattr(
        "backend.services.group_feed_notifications.create_notification",
        capture_create,
    )
    monkeypatch.setattr(
        "backend.services.group_feed_notifications.send_push_to_user",
        capture_push,
    )

    make_user("gfn_owner", subscription="premium")
    make_user("gfn_member", subscription="premium")
    cid = make_community("gfn-comm", tier="free", creator_username="gfn_owner")
    gid = _insert_group(cid, "Gfn", "gfn_owner")
    _add_group_member(gid, "gfn_owner")
    _add_group_member(gid, "gfn_member")
    pid = _insert_group_post(gid, "gfn_owner", "Hello from owner")

    from backend.services.group_feed_notifications import fanout_group_post_notifications

    fanout_group_post_notifications(
        group_id=gid,
        group_post_id=pid,
        author_username="gfn_owner",
        content="Hello from owner",
        community_id=cid,
    )

    assert len(calls) == 1
    args, kwargs = calls[0]
    assert args[0] == "gfn_member"
    assert args[1] == "gfn_owner"
    assert args[2] == "group_feed_post"
    assert kwargs.get("post_id") == pid
    assert len(pushes) == 1
    assert pushes[0][0] == "gfn_member"
    assert pushes[0][1].get("url") == f"/post/{pid}"


def test_notify_group_reply_reaches_post_owner(monkeypatch, mysql_dsn):
    calls = []
    pushes = []

    monkeypatch.setattr(
        "backend.services.group_feed_notifications.create_notification",
        lambda *a, **k: calls.append((a, k)),
    )
    monkeypatch.setattr(
        "backend.services.group_feed_notifications.send_push_to_user",
        lambda u, p: pushes.append((u, p)),
    )

    make_user("grn_owner", subscription="premium")
    make_user("grn_member", subscription="premium")
    cid = make_community("grn-comm", tier="free", creator_username="grn_owner")
    gid = _insert_group(cid, "Grn", "grn_owner")
    _add_group_member(gid, "grn_owner")
    _add_group_member(gid, "grn_member")
    pid = _insert_group_post(gid, "grn_owner", "Topic")
    rid = _insert_group_reply(pid, "grn_member", "A reply here")

    from backend.services.group_feed_notifications import notify_group_post_reply_recipients

    notify_group_post_reply_recipients(
        group_post_id=pid,
        group_id=gid,
        from_user="grn_member",
        community_id=cid,
        parent_reply_id=None,
        reply_id=rid,
        reply_content="A reply here",
    )

    assert len(calls) == 1
    args, kwargs = calls[0]
    assert args[0] == "grn_owner"
    assert args[2] == "group_feed_reply"
    assert kwargs.get("post_id") == pid
    assert len(pushes) == 1
    assert pushes[0][0] == "grn_owner"
    assert pushes[0][1]["url"] == f"/group_reply/{rid}"
