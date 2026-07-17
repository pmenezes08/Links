"""Activation instrumentation + admin funnel endpoint.

Covers the signup → create-community → invite funnel plumbing:

  1. The new server-only retention events (``community_created``,
     ``invite_sent``) are accepted by the service write helper and windowed
     correctly by ``activation_summary``.
  2. The client sink (`/api/retention/event`) REJECTS the server-only
     events — a browser console must not be able to inflate founder
     metrics.
  3. The invite endpoints fire ``invite_sent`` end-to-end through the real
     HTTP surface (link generation + username invite).
  4. ``onboarding_events.funnel_summary`` counts DISTINCT users per event
     and per stage (consecutive stage saves are deduped upstream, but the
     read must also collapse repeat rows from the same user).
  5. ``GET /api/admin/activation_funnel`` is app-admin-gated (401 anon,
     403 non-admin) and returns the documented JSON contract.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from backend.services import onboarding_events, retention_events
from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


def _backdate_retention_event(username: str, event_type: str, days: int) -> None:
    """Insert a raw row with a fabricated created_at (window-boundary tests)."""
    retention_events.ensure_events_table()
    ph = get_sql_placeholder()
    created = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO retention_events
                (username, event_type, source, community_id, group_id, detail, created_at)
            VALUES ({ph}, {ph}, {ph}, NULL, NULL, NULL, {ph})
            """,
            (username, event_type, "server", created),
        )
        try:
            conn.commit()
        except Exception:
            pass


def _retention_rows(event_type: str):
    retention_events.ensure_events_table()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT username, source, community_id, detail
            FROM retention_events WHERE event_type = {ph}
            ORDER BY id
            """,
            (event_type,),
        )
        rows = c.fetchall() or []
    out = []
    for row in rows:
        if hasattr(row, "keys"):
            out.append(
                (row["username"], row["source"], row["community_id"], row["detail"])
            )
        else:
            out.append((row[0], row[1], row[2], row[3]))
    return out


# ---------------------------------------------------------------------------
# Event write helpers
# ---------------------------------------------------------------------------


def test_record_activation_events_accepted(mysql_dsn):
    assert retention_events.record_event(
        "creator_kim",
        event_type="community_created",
        source="server",
        community_id=42,
    ) is True
    assert retention_events.record_event(
        "creator_kim",
        event_type="invite_sent",
        source="server",
        community_id=42,
        detail="invite_link",
    ) is True

    created = _retention_rows("community_created")
    assert created == [("creator_kim", "server", 42, None)]
    sent = _retention_rows("invite_sent")
    assert sent == [("creator_kim", "server", 42, "invite_link")]


def test_activation_summary_distinct_users_and_window(mysql_dsn):
    # Two creators, one of whom creates twice; one inviter with three sends.
    retention_events.record_event("c1", event_type="community_created", source="server", community_id=1)
    retention_events.record_event("c1", event_type="community_created", source="server", community_id=2)
    retention_events.record_event("c2", event_type="community_created", source="server", community_id=3)
    for _ in range(3):
        retention_events.record_event("inv1", event_type="invite_sent", source="server", community_id=1)
    # Outside the 30-day window: must not count.
    _backdate_retention_event("old_creator", "community_created", days=40)
    _backdate_retention_event("old_inviter", "invite_sent", days=40)

    summary = retention_events.activation_summary(days=30)
    assert summary["community_created"] == {"users": 2, "total": 3}
    assert summary["invite_sent"] == {"users": 1, "total": 3}

    # A wider window picks the old rows back up.
    wide = retention_events.activation_summary(days=60)
    assert wide["community_created"] == {"users": 3, "total": 4}
    assert wide["invite_sent"] == {"users": 2, "total": 4}


def test_client_sink_rejects_server_only_events(mysql_dsn):
    import bodybuilding_app

    make_user("sneaky")
    client = bodybuilding_app.app.test_client()
    _login(client, "sneaky")

    for etype in ("community_created", "invite_sent"):
        resp = client.post("/api/retention/event", json={"event_type": etype})
        assert resp.status_code == 200
        assert resp.get_json()["recorded"] is False

    # Nothing landed in the table.
    assert _retention_rows("community_created") == []
    assert _retention_rows("invite_sent") == []

    # Sanity: a legit client event still records through the same sink.
    resp = client.post(
        "/api/retention/event",
        json={"event_type": "digest_opened", "source": "weekly_digest_push"},
    )
    assert resp.get_json()["recorded"] is True


# ---------------------------------------------------------------------------
# invite_sent fires end-to-end through the real invite endpoints
# ---------------------------------------------------------------------------


def test_invite_link_endpoint_records_invite_sent(mysql_dsn):
    import bodybuilding_app

    make_user("owner_funnel_link", subscription="premium")
    community_id = make_community(
        "funnel-invite-link", tier="free", creator_username="owner_funnel_link"
    )
    client = bodybuilding_app.app.test_client()
    _login(client, "owner_funnel_link")

    resp = client.post("/api/community/invite_link", json={"community_id": community_id})
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    rows = _retention_rows("invite_sent")
    assert rows == [("owner_funnel_link", "server", community_id, "invite_link")]


def test_invite_username_endpoint_records_invite_sent(mysql_dsn, monkeypatch):
    import bodybuilding_app
    from backend.services import community_invites as invites_svc

    monkeypatch.setattr(invites_svc, "send_push_to_user", lambda *a, **k: None)

    make_user("owner_funnel_uname", subscription="premium")
    make_user("target_funnel_uname")
    community_id = make_community(
        "funnel-invite-uname", tier="free", creator_username="owner_funnel_uname"
    )
    client = bodybuilding_app.app.test_client()
    _login(client, "owner_funnel_uname")

    resp = client.post(
        "/api/community/invite_username",
        json={"community_id": community_id, "username": "target_funnel_uname"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    rows = _retention_rows("invite_sent")
    assert rows == [("owner_funnel_uname", "server", community_id, "invite_username")]


def test_failed_invite_does_not_record_event(mysql_dsn):
    """A 403 (outsider) must leave the funnel untouched."""
    import bodybuilding_app

    make_user("owner_funnel_forbidden", subscription="premium")
    make_user("outsider_funnel")
    community_id = make_community(
        "funnel-invite-forbidden", tier="free", creator_username="owner_funnel_forbidden"
    )
    client = bodybuilding_app.app.test_client()
    _login(client, "outsider_funnel")

    resp = client.post("/api/community/invite_link", json={"community_id": community_id})
    assert resp.status_code == 403
    assert _retention_rows("invite_sent") == []


# ---------------------------------------------------------------------------
# Onboarding funnel read
# ---------------------------------------------------------------------------


def test_funnel_summary_counts_distinct_users_per_event_and_stage(mysql_dsn):
    # u1 walks two stages then completes; u2 reaches one stage twice (raw
    # duplicate rows) then defers; u3 only triggers resume_required.
    onboarding_events.record_onboarding_event("u1", onboarding_events.EVENT_STAGE, stage="intent")
    onboarding_events.record_onboarding_event("u1", onboarding_events.EVENT_STAGE, stage="profile")
    onboarding_events.record_onboarding_event("u1", onboarding_events.EVENT_COMPLETED)
    onboarding_events.record_onboarding_event("u2", onboarding_events.EVENT_STAGE, stage="intent")
    onboarding_events.record_onboarding_event("u2", onboarding_events.EVENT_STAGE, stage="intent")
    onboarding_events.record_onboarding_event("u2", onboarding_events.EVENT_DEFERRED)
    onboarding_events.record_onboarding_event("u3", onboarding_events.EVENT_RESUME_REQUIRED)

    summary = onboarding_events.funnel_summary(days=30)
    assert summary["started"] == 2                    # u1 + u2 have stage rows
    assert summary["stages"]["intent"] == 2           # u2's duplicate collapses
    assert summary["stages"]["profile"] == 1
    assert summary["completed"] == 1
    assert summary["deferred"] == 1
    assert summary["resume_required"] == 1
    assert summary["bootstrap_communities"] == 0


def test_funnel_summary_respects_window(mysql_dsn):
    onboarding_events.ensure_tables()
    ph = get_sql_placeholder()
    old = (datetime.utcnow() - timedelta(days=45)).strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO onboarding_events (username, event, stage, created_at)
            VALUES ({ph}, {ph}, {ph}, {ph})
            """,
            ("ancient", onboarding_events.EVENT_STAGE, "intent", old),
        )
        try:
            conn.commit()
        except Exception:
            pass
    onboarding_events.record_onboarding_event(
        "fresh", onboarding_events.EVENT_STAGE, stage="intent"
    )

    assert onboarding_events.funnel_summary(days=30)["started"] == 1
    assert onboarding_events.funnel_summary(days=60)["started"] == 2


# ---------------------------------------------------------------------------
# Admin endpoint: gating + happy path
# ---------------------------------------------------------------------------


def test_activation_funnel_requires_admin(mysql_dsn):
    import bodybuilding_app

    make_user("plain_member")
    client = bodybuilding_app.app.test_client()

    # Anonymous → 401.
    assert client.get("/api/admin/activation_funnel").status_code == 401

    # Logged-in non-admin → 403.
    _login(client, "plain_member")
    resp = client.get("/api/admin/activation_funnel")
    assert resp.status_code == 403
    assert resp.get_json()["success"] is False


def test_activation_funnel_happy_path(mysql_dsn):
    import bodybuilding_app

    make_user("funnel_admin", is_admin=True)
    make_user("creator_a")
    make_user("creator_b")

    # Seed both sides of the funnel.
    onboarding_events.record_onboarding_event(
        "creator_a", onboarding_events.EVENT_STAGE, stage="intent"
    )
    onboarding_events.record_onboarding_event("creator_a", onboarding_events.EVENT_COMPLETED)
    retention_events.record_event(
        "creator_a", event_type="community_created", source="server", community_id=7
    )
    retention_events.record_event(
        "creator_b", event_type="community_created", source="server", community_id=8
    )
    retention_events.record_event(
        "creator_a", event_type="invite_sent", source="server",
        community_id=7, detail="invite_link",
    )

    client = bodybuilding_app.app.test_client()
    _login(client, "funnel_admin")
    resp = client.get("/api/admin/activation_funnel?days=30")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["window_days"] == 30

    onboarding = body["onboarding"]
    assert onboarding["started"] == 1
    assert onboarding["stages"] == {"intent": 1}
    assert onboarding["completed"] == 1

    activation = body["activation"]
    assert activation["community_created"] == {"users": 2, "total": 2}
    assert activation["invite_sent"] == {"users": 1, "total": 1}


def test_activation_funnel_clamps_days_param(mysql_dsn):
    import bodybuilding_app

    make_user("funnel_admin2", is_admin=True)
    client = bodybuilding_app.app.test_client()
    _login(client, "funnel_admin2")

    # Nonsense and out-of-range values fall back / clamp, never 500.
    assert client.get("/api/admin/activation_funnel?days=abc").get_json()["window_days"] == 30
    assert client.get("/api/admin/activation_funnel?days=0").get_json()["window_days"] == 1
    assert client.get("/api/admin/activation_funnel?days=9999").get_json()["window_days"] == 365
