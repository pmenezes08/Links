"""Weekly member digest — cron auth, kill-switch, dedup, quiet skip, attribution.

The digest is the member-side return loop (the owner pulse's sibling). These
tests drive `/api/cron/member-weekly-digest` end-to-end against the MySQL
testcontainer with the push transport monkeypatched. The critical invariants:

* **Off by default** — staging shares the prod Cloud SQL instance, so a
  staging cron run must never push to real members. Real sends require
  MEMBER_DIGEST_ENABLED; dry_run works regardless and writes nothing.
* One digest per member per ISO week; owners excluded (they get the pulse);
  quiet communities skipped; each send writes a `digest_sent`
  retention_events row for tap-through measurement.
"""

from __future__ import annotations

import pytest

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user

CRON_SECRET = "test-cron-secret"


@pytest.fixture(autouse=True)
def _digest_env(monkeypatch):
    monkeypatch.setenv("CRON_SHARED_SECRET", CRON_SECRET)
    monkeypatch.setenv("MEMBER_DIGEST_ENABLED", "true")
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            for table in ("member_digest_sends", "retention_events"):
                try:
                    c.execute(f"DELETE FROM {table}")
                except Exception:
                    pass
            try:
                conn.commit()
            except Exception:
                pass
    except Exception:
        pass
    yield


def _add_member(username: str, community_id: int) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
        uid = row["id"] if hasattr(row, "keys") else row[0]
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role) VALUES ({ph}, {ph}, 'member')",
            (uid, community_id),
        )
        conn.commit()


def _post_now(community_id: int, username: str, n: int = 1) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        for _ in range(n):
            c.execute(
                f"INSERT INTO posts (community_id, username, content) VALUES ({ph}, {ph}, {ph})",
                (community_id, username, "weekly activity"),
            )
        conn.commit()


def _capture_sends(monkeypatch):
    import backend.services.notifications as notif

    sent = []

    def fake_push(username, payload):
        sent.append({"username": username, **(payload or {})})

    monkeypatch.setattr(notif, "send_push_to_user", fake_push)
    return sent


def _run(client, *, dry_run=False, secret=CRON_SECRET, max_sends=None):
    qs = []
    if dry_run:
        qs.append("dry_run=1")
    if max_sends is not None:
        qs.append(f"max_sends={max_sends}")
    suffix = ("?" + "&".join(qs)) if qs else ""
    headers = {"X-Cron-Secret": secret} if secret else {}
    return client.post(f"/api/cron/member-weekly-digest{suffix}", headers=headers)


def _retention_rows(username: str):
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"SELECT event_type, source, community_id FROM retention_events WHERE username = {ph}",
                (username,),
            )
            return c.fetchall() or []
        except Exception:
            return []


def _seed_active_community(owner: str, member: str, poster: str, name: str) -> int:
    """Community where `poster` posted enough this week for `member` to qualify."""
    make_user(owner)
    make_user(member)
    make_user(poster)
    cid = make_community(name, creator_username=owner)
    _add_member(member, cid)
    _add_member(poster, cid)
    _post_now(cid, poster, n=3)
    return cid


def test_requires_cron_secret(mysql_dsn):
    import bodybuilding_app

    client = bodybuilding_app.app.test_client()
    assert _run(client, secret=None).status_code == 403
    assert _run(client, secret="wrong").status_code == 403


def test_disabled_by_default_blocks_real_sends(mysql_dsn, monkeypatch):
    """The launch posture: no env var → 409 and zero pushes."""
    import bodybuilding_app

    sent = _capture_sends(monkeypatch)
    monkeypatch.delenv("MEMBER_DIGEST_ENABLED", raising=False)
    _seed_active_community("dg_owner0", "dg_member0", "dg_poster0", "Digest Off")
    client = bodybuilding_app.app.test_client()

    resp = _run(client)
    assert resp.status_code == 409
    assert resp.get_json()["sent"] == 0
    assert sent == []
    # dry_run still previews with the switch off.
    dry = _run(client, dry_run=True)
    assert dry.status_code == 200
    assert dry.get_json()["dry_run"] is True


def test_dry_run_writes_nothing(mysql_dsn):
    import bodybuilding_app

    _seed_active_community("dg_owner1", "dg_member1", "dg_poster1", "Digest Dry")
    client = bodybuilding_app.app.test_client()

    body = _run(client, dry_run=True).get_json()
    assert body["candidates"] >= 1
    assert body["sent"] == 0
    assert any(p["username"] == "dg_member1" for p in body.get("preview", []))

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("SELECT COUNT(*) AS n FROM member_digest_sends")
        row = c.fetchone()
        assert int(row["n"] if hasattr(row, "keys") else row[0]) == 0


def test_real_run_sends_once_dedups_and_records_attribution(mysql_dsn, monkeypatch):
    import bodybuilding_app

    sent = _capture_sends(monkeypatch)
    cid = _seed_active_community("dg_owner2", "dg_member2", "dg_poster2", "Digest Real")
    client = bodybuilding_app.app.test_client()

    body = _run(client).get_json()
    assert body["sent"] >= 1
    pushes = [s for s in sent if s["username"] == "dg_member2"]
    assert len(pushes) == 1
    # Deep link carries the attribution source param.
    assert pushes[0]["url"] == f"/community_feed_react/{cid}?source=weekly_digest_push"

    # digest_sent attribution row written by the cron.
    rows = _retention_rows("dg_member2")
    assert len(rows) == 1
    r = rows[0]
    etype = r["event_type"] if hasattr(r, "keys") else r[0]
    source = r["source"] if hasattr(r, "keys") else r[1]
    assert etype == "digest_sent"
    assert source == "weekly_digest_cron"

    # Owner never gets the member digest (they have the pulse).
    assert not [s for s in sent if s["username"] == "dg_owner2"]

    # Same week again → dedup, no second push.
    body2 = _run(client).get_json()
    assert body2["skipped_dedup"] >= 1
    assert len([s for s in sent if s["username"] == "dg_member2"]) == 1


def test_quiet_communities_send_nothing(mysql_dsn, monkeypatch):
    """Fewer than MIN_NEW_POSTS by others → member is not a candidate at all."""
    import bodybuilding_app

    sent = _capture_sends(monkeypatch)
    make_user("dg_owner3")
    make_user("dg_member3")
    cid = make_community("Digest Quiet", creator_username="dg_owner3")
    _add_member("dg_member3", cid)
    _post_now(cid, "dg_owner3", n=1)  # below the 3-post threshold
    client = bodybuilding_app.app.test_client()

    body = _run(client).get_json()
    assert not [s for s in sent if s["username"] == "dg_member3"]
    assert body["candidates"] == 0


def test_own_posts_do_not_count_toward_threshold(mysql_dsn, monkeypatch):
    """A member's own posts aren't 'what you missed'."""
    import bodybuilding_app

    sent = _capture_sends(monkeypatch)
    make_user("dg_owner4")
    make_user("dg_member4")
    cid = make_community("Digest SelfPost", creator_username="dg_owner4")
    _add_member("dg_member4", cid)
    _post_now(cid, "dg_member4", n=5)  # all by the member themselves
    client = bodybuilding_app.app.test_client()

    _run(client)
    assert not [s for s in sent if s["username"] == "dg_member4"]


def test_max_sends_caps_a_run(mysql_dsn, monkeypatch):
    import bodybuilding_app

    sent = _capture_sends(monkeypatch)
    make_user("dg_owner5")
    make_user("dg_poster5")
    cid = make_community("Digest Cap", creator_username="dg_owner5")
    _add_member("dg_poster5", cid)
    for i in range(3):
        make_user(f"dg_capm{i}")
        _add_member(f"dg_capm{i}", cid)
    _post_now(cid, "dg_poster5", n=3)
    client = bodybuilding_app.app.test_client()

    body = _run(client, max_sends=1).get_json()
    assert body["sent"] == 1
    assert body["skipped_cap"] >= 1
    assert len(sent) == 1


def test_recipient_locale_copy(mysql_dsn, monkeypatch):
    """A pt-PT member gets pt-PT copy."""
    import bodybuilding_app
    from backend.services import user_locale

    sent = _capture_sends(monkeypatch)
    _seed_active_community("dg_owner6", "dg_member6", "dg_poster6", "Digest PT")
    monkeypatch.setattr(user_locale, "get_preferred_locale",
                        lambda u: "pt-PT" if u == "dg_member6" else "en")
    client = bodybuilding_app.app.test_client()

    _run(client)
    pushes = [s for s in sent if s["username"] == "dg_member6"]
    assert len(pushes) == 1
    assert "esta semana" in pushes[0]["title"].lower()
