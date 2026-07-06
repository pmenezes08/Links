"""Weekly Steve owner pulse — cron auth, dry-run, dedup, kill-switch, locale.

The pulse is the Owner Dashboard's return loop: one templated push + in-app
row per owner per ISO week. These tests drive the cron route end-to-end
against the MySQL testcontainer, with the push transport monkeypatched (no
FCM/APNs in CI).
"""

from __future__ import annotations

import pytest

from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user

CRON_SECRET = "test-cron-secret"


@pytest.fixture(autouse=True)
def _pulse_env(monkeypatch):
    monkeypatch.setenv("CRON_SHARED_SECRET", CRON_SECRET)
    monkeypatch.setenv("OWNER_PULSE_ENABLED", "true")
    # Clean dedup rows between tests (table is lazily created).
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            try:
                c.execute("DELETE FROM owner_pulse_sends")
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
        try:
            conn.commit()
        except Exception:
            pass


def _post_now(community_id: int, username: str) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO posts (community_id, username, content) VALUES ({ph}, {ph}, {ph})",
            (community_id, username, "weekly activity"),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _capture_sends(monkeypatch):
    """Patch the push transport; the in-app row goes to the real DB."""
    from backend.services import owner_pulse  # noqa: F401  (import for patch targets)
    import backend.services.notifications as notif

    sent = []

    def fake_push(username, payload):
        sent.append({"username": username, **(payload or {})})

    monkeypatch.setattr(notif, "send_push_to_user", fake_push)
    return sent


def _run(client, *, dry_run=False, secret=CRON_SECRET):
    qs = "?dry_run=1" if dry_run else ""
    headers = {"X-Cron-Secret": secret} if secret else {}
    return client.post(f"/api/cron/owner-weekly-pulse{qs}", headers=headers)


def test_requires_cron_secret(mysql_dsn):
    import bodybuilding_app

    client = bodybuilding_app.app.test_client()
    assert _run(client, secret=None).status_code == 403
    assert _run(client, secret="wrong").status_code == 403


def test_dry_run_lists_candidates_and_writes_nothing(mysql_dsn):
    import bodybuilding_app

    make_user("pulse_owner")
    make_user("pulse_m1")
    client = bodybuilding_app.app.test_client()
    a = make_community("Pulse A", creator_username="pulse_owner")
    _add_member("pulse_m1", a)
    _post_now(a, "pulse_m1")

    resp = _run(client, dry_run=True)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["dry_run"] is True
    assert body["candidates"] >= 1
    assert body["sent"] == 0
    assert any(p["owner"] == "pulse_owner" for p in body.get("preview", []))

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("SELECT COUNT(*) AS n FROM owner_pulse_sends")
        row = c.fetchone()
        n = row["n"] if hasattr(row, "keys") else row[0]
    assert int(n) == 0


def test_real_run_sends_once_then_dedups(mysql_dsn, monkeypatch):
    import bodybuilding_app

    sent = _capture_sends(monkeypatch)
    make_user("pulse_owner")
    make_user("pulse_m1")
    client = bodybuilding_app.app.test_client()
    a = make_community("Pulse A", creator_username="pulse_owner")
    _add_member("pulse_m1", a)
    _post_now(a, "pulse_m1")

    resp = _run(client)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["sent"] == 1
    pulse_pushes = [s for s in sent if s["username"] == "pulse_owner"]
    assert len(pulse_pushes) == 1
    assert pulse_pushes[0]["url"] == f"/community/{a}/owner"

    # In-app row exists and deep-links to the dashboard.
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT link FROM notifications WHERE user_id = {ph} AND type = 'owner_pulse'",
            ("pulse_owner",),
        )
        row = c.fetchone()
    assert row is not None
    link = row["link"] if hasattr(row, "keys") else row[0]
    assert link == f"/community/{a}/owner"

    # Same week again → dedup, no second push.
    resp2 = _run(client)
    assert resp2.get_json()["skipped_dedup"] >= 1
    assert len([s for s in sent if s["username"] == "pulse_owner"]) == 1


def test_quiet_communities_are_skipped(mysql_dsn, monkeypatch):
    """No activity this week → no pulse (never a '0 active' shame-gram)."""
    import bodybuilding_app

    sent = _capture_sends(monkeypatch)
    make_user("quiet_owner")
    make_user("quiet_m1")
    client = bodybuilding_app.app.test_client()
    a = make_community("Quiet A", creator_username="quiet_owner")
    _add_member("quiet_m1", a)   # member but zero activity

    body = _run(client).get_json()
    assert body["skipped_quiet"] >= 1
    assert not [s for s in sent if s["username"] == "quiet_owner"]


def test_kill_switch_blocks_real_sends(mysql_dsn, monkeypatch):
    import bodybuilding_app

    sent = _capture_sends(monkeypatch)
    monkeypatch.setenv("OWNER_PULSE_ENABLED", "false")
    make_user("kill_owner")
    make_user("kill_m1")
    client = bodybuilding_app.app.test_client()
    a = make_community("Kill A", creator_username="kill_owner")
    _add_member("kill_m1", a)
    _post_now(a, "kill_m1")

    resp = _run(client)
    assert resp.status_code == 409
    assert resp.get_json()["sent"] == 0
    assert sent == []
    # dry_run still works with the switch off
    assert _run(client, dry_run=True).status_code == 200


def test_multi_root_owner_gets_one_pulse_for_largest_network(mysql_dsn, monkeypatch):
    import bodybuilding_app

    sent = _capture_sends(monkeypatch)
    make_user("multi_owner")
    for i in range(3):
        make_user(f"multi_m{i}")
    client = bodybuilding_app.app.test_client()
    small = make_community("Multi Small", creator_username="multi_owner")
    big = make_community("Multi Big", creator_username="multi_owner")
    _add_member("multi_m0", small)
    for i in range(3):
        _add_member(f"multi_m{i}", big)
    _post_now(small, "multi_m0")
    _post_now(big, "multi_m1")

    body = _run(client).get_json()
    pushes = [s for s in sent if s["username"] == "multi_owner"]
    assert body["sent"] >= 1
    assert len(pushes) == 1
    assert pushes[0]["url"] == f"/community/{big}/owner"


def test_recipient_locale_copy(mysql_dsn, monkeypatch):
    """A pt-PT owner gets pt-PT copy (informal 'tu' register)."""
    import bodybuilding_app
    from backend.services import user_locale

    sent = _capture_sends(monkeypatch)
    make_user("pt_owner")
    make_user("pt_m1")
    monkeypatch.setattr(user_locale, "get_preferred_locale", lambda u: "pt-PT" if u == "pt_owner" else "en")
    client = bodybuilding_app.app.test_client()
    a = make_community("PT A", creator_username="pt_owner")
    _add_member("pt_m1", a)
    _post_now(a, "pt_m1")

    _run(client)
    pushes = [s for s in sent if s["username"] == "pt_owner"]
    assert len(pushes) == 1
    assert "pulso semanal" in pushes[0]["title"].lower()
