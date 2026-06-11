"""Authorization on the Steve networking routes.

POST /api/networking/steve_match and /steve_auto_match take community_id
from the request body; the server must verify the requester belongs to that
community tree before loading any member knowledge (AGENTS.md privacy
invariant). Assertions key on the distinctive membership error string so the
gate can't be confused with the networking-disabled 403 from KB config.
"""

from __future__ import annotations

from tests.fixtures import fill_community_members, make_community, make_user

MEMBERSHIP_ERROR = "Not a member of this community"


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _post_match(client, community_id, message="find me a co-founder"):
    return client.post(
        "/api/networking/steve_match",
        json={"community_id": community_id, "message": message},
    )


def _post_auto_match(client, community_id):
    return client.post(
        "/api/networking/steve_auto_match",
        json={"community_id": community_id},
    )


def test_non_member_gets_403_from_both_steve_routes(mysql_dsn):
    import bodybuilding_app

    make_user("net_gate_owner", subscription="premium")
    make_user("net_gate_outsider", subscription="premium")
    community_id = make_community(
        "net-gate-private",
        tier="free",
        creator_username="net_gate_owner",
    )
    fill_community_members(community_id, 2, prefix="netgate")

    client = bodybuilding_app.app.test_client()
    _login(client, "net_gate_outsider")

    resp = _post_match(client, community_id)
    assert resp.status_code == 403
    assert resp.get_json()["error"] == MEMBERSHIP_ERROR

    resp = _post_auto_match(client, community_id)
    assert resp.status_code == 403
    assert resp.get_json()["error"] == MEMBERSHIP_ERROR


def test_member_of_child_community_passes_the_gate_on_parent(mysql_dsn):
    import bodybuilding_app

    make_user("net_gate_owner2", subscription="premium")
    parent_id = make_community(
        "net-gate-parent",
        tier="free",
        creator_username="net_gate_owner2",
    )
    child_id = make_community(
        "net-gate-child",
        tier="free",
        creator_username="net_gate_owner2",
        parent_community_id=parent_id,
    )
    members = fill_community_members(child_id, 1, prefix="netgatechild")

    client = bodybuilding_app.app.test_client()
    _login(client, members[0])

    # The request may still fail later (networking disabled in test KB, no
    # XAI key), but it must never fail on membership: the child member is
    # inside the parent's community tree.
    resp = _post_match(client, parent_id)
    body = resp.get_json() or {}
    assert body.get("error") != MEMBERSHIP_ERROR

    resp = _post_auto_match(client, parent_id)
    body = resp.get_json() or {}
    assert body.get("error") != MEMBERSHIP_ERROR


def test_unknown_or_invalid_community_is_rejected(mysql_dsn):
    import bodybuilding_app

    make_user("net_gate_user3", subscription="premium")
    client = bodybuilding_app.app.test_client()
    _login(client, "net_gate_user3")

    resp = _post_match(client, "not-a-number")
    assert resp.status_code == 400

    resp = _post_match(client, 99999999)
    assert resp.status_code == 403
    assert resp.get_json()["error"] == MEMBERSHIP_ERROR
