"""Lifecycle email system — consent, chokepoint, unsubscribe, cron sweeps.

Invariants under test:

  1. ``email_preferences`` consent model: lifecycle is opt-out (no row =
     send), marketing is opt-in (no row = don't), ``hard_suppressed``
     overrides both; ``purge_user`` removes the row.
  2. The ``lifecycle_email`` chokepoint: suppression is enforced BEFORE the
     transport is touched, RFC 8058 headers ride every send, the footer
     placeholder is substituted with a tokenized unsubscribe link, and the
     master kill-switch (``LIFECYCLE_EMAIL_ENABLED``) blocks real sends.
  3. Unsubscribe HTTP surface: GET never mutates (mail-client prefetch
     safety), POST one-click opts out, responses are non-enumerating
     (invalid token → same 200 + generic page), resubscribe round-trips.
  4. Welcome sweep: owner variant for organic signups, member variant when
     a membership exists, INSERT-first reservation makes retries idempotent,
     and a ``lifecycle_email_sent`` retention event lands per send.
  5. Activation nudges: no-community cohort (2–14d, no membership),
     empty-community cohort (root community ≥96h with only the owner),
     ``invite_sent`` kills the empty-community nudge, and the 48h
     cross-kind contact gap holds.
  6. Verification reminder: unverified ``pending_signups`` 24h–7d old get
     exactly one fresh-token reminder; younger rows and already-registered
     emails are excluded.
  7. Cron endpoints: X-Cron-Secret rejected/accepted, ``?dry_run=1``
     returns counters without writing reservations.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List

import pytest
from flask import Flask

from backend.services import email_preferences, lifecycle_email, retention_events
from backend.services import lifecycle_email_dispatch as dispatch
from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user

CRON_HEADERS = {"X-Cron-Secret": "test-secret"}


# ── Helpers ─────────────────────────────────────────────────────────────


def _enable_all(monkeypatch) -> None:
    monkeypatch.setenv("LIFECYCLE_EMAIL_ENABLED", "1")
    monkeypatch.setenv("WELCOME_EMAIL_ENABLED", "1")
    monkeypatch.setenv("ACTIVATION_NUDGE_EMAIL_ENABLED", "1")
    monkeypatch.setenv("VERIFICATION_REMINDER_EMAIL_ENABLED", "1")


def _capture_sends(monkeypatch) -> List[Dict[str, Any]]:
    """Stub the Resend transport; record every send the chokepoint lets out."""
    sent: List[Dict[str, Any]] = []

    def _fake_send(to_email, subject, html, *, text=None, headers=None):
        sent.append({
            "to": to_email, "subject": subject, "html": html,
            "text": text, "headers": headers or {},
        })
        return True

    from backend.services import transactional_email

    monkeypatch.setattr(transactional_email, "send", _fake_send)
    return sent


def _user_id(username: str) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
        row = c.fetchone()
    return int(row["id"] if hasattr(row, "keys") else row[0])


def _join_community(username: str, community_id: int) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO user_communities (user_id, community_id, role) VALUES ({ph}, {ph}, 'member')",
            (_user_id(username), community_id),
        )
        conn.commit()


def _backdate_community(community_id: int, days: int) -> None:
    ph = get_sql_placeholder()
    created = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE communities SET created_at = {ph} WHERE id = {ph}",
            (created, community_id),
        )
        conn.commit()


def _sends_rows() -> List[tuple]:
    ph = get_sql_placeholder()  # noqa: F841 - table may not exist yet
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute("SELECT recipient, kind FROM lifecycle_email_sends ORDER BY id")
        except Exception:
            return []
        rows = c.fetchall() or []
    return [
        ((r["recipient"] if hasattr(r, "keys") else r[0]),
         (r["kind"] if hasattr(r, "keys") else r[1]))
        for r in rows
    ]


def _ensure_pending_signups_table() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS pending_signups (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(191),
                email VARCHAR(191) NOT NULL UNIQUE,
                password TEXT NOT NULL,
                first_name TEXT,
                last_name TEXT,
                mobile TEXT,
                created_at TEXT,
                verification_sent_at TEXT
            )
            """
        )
        conn.commit()


def _make_pending_signup(email: str, *, sent_hours_ago: int) -> int:
    _ensure_pending_signups_table()
    ph = get_sql_placeholder()
    stamp = (datetime.utcnow() - timedelta(hours=sent_hours_ago)).isoformat()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            INSERT INTO pending_signups (username, email, password, created_at, verification_sent_at)
            VALUES ({ph}, {ph}, 'x', {ph}, {ph})
            """,
            (email.split("@")[0], email, stamp, stamp),
        )
        pid = c.lastrowid
        conn.commit()
    return int(pid)


@pytest.fixture
def client(mysql_dsn):
    from backend.blueprints.lifecycle_emails import lifecycle_emails_bp

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(lifecycle_emails_bp)
    with app.test_client() as c:
        yield c


# ── 1. Consent model ────────────────────────────────────────────────────


def test_consent_defaults_lifecycle_optout_marketing_optin(mysql_dsn):
    make_user("prefs_kim")
    # No row: lifecycle sendable, marketing not.
    assert email_preferences.may_send("prefs_kim", category="lifecycle") is True
    assert email_preferences.may_send("prefs_kim", category="marketing") is False

    row = email_preferences.get_or_create("prefs_kim", "prefs_kim@test.local")
    assert row is not None
    assert row["lifecycle_optout"] in (0, False)
    assert len(row["unsubscribe_token"]) >= 32
    # Token is stable across get_or_create calls.
    again = email_preferences.get_or_create("prefs_kim")
    assert again["unsubscribe_token"] == row["unsubscribe_token"]

    assert email_preferences.set_lifecycle_optout_by_token(row["unsubscribe_token"], True)
    assert email_preferences.may_send("prefs_kim", category="lifecycle") is False

    # hard_suppressed overrides everything, including a later re-subscribe.
    email_preferences.set_lifecycle_optout_by_token(row["unsubscribe_token"], False)
    assert email_preferences.may_send("prefs_kim", category="lifecycle") is True
    email_preferences.hard_suppress("prefs_kim", "bounce")
    assert email_preferences.may_send("prefs_kim", category="lifecycle") is False
    assert email_preferences.may_send("prefs_kim", category="marketing") is False


def test_purge_user_removes_pref_row(mysql_dsn):
    make_user("purge_me")
    email_preferences.get_or_create("purge_me", "purge_me@test.local")
    with get_db_connection() as conn:
        c = conn.cursor()
        email_preferences.purge_user(c, "purge_me")
        conn.commit()
    assert email_preferences.get_for_user("purge_me") is None


# ── 2. Chokepoint ───────────────────────────────────────────────────────


def _lifecycle_html() -> str:
    return f"<html><body><p>hi</p>{lifecycle_email.FOOTER_PLACEHOLDER}</body></html>"


def test_chokepoint_disabled_by_default(mysql_dsn, monkeypatch):
    make_user("choke_off")
    sent = _capture_sends(monkeypatch)
    monkeypatch.delenv("LIFECYCLE_EMAIL_ENABLED", raising=False)
    status = lifecycle_email.send(
        "choke_off", kind="welcome_owner", subject="s", html=_lifecycle_html()
    )
    assert status == "disabled"
    assert sent == []


def test_chokepoint_sends_with_headers_and_footer(mysql_dsn, monkeypatch):
    make_user("choke_send")
    sent = _capture_sends(monkeypatch)
    monkeypatch.setenv("LIFECYCLE_EMAIL_ENABLED", "1")
    status = lifecycle_email.send(
        "choke_send", kind="welcome_owner", subject="s", html=_lifecycle_html()
    )
    assert status == "sent"
    assert len(sent) == 1
    msg = sent[0]
    assert msg["to"] == "choke_send@test.local"
    assert msg["headers"].get("List-Unsubscribe-Post") == "List-Unsubscribe=One-Click"
    prefs = email_preferences.get_for_user("choke_send")
    assert prefs["unsubscribe_token"] in msg["headers"].get("List-Unsubscribe", "")
    # Footer substituted into the body.
    assert lifecycle_email.FOOTER_PLACEHOLDER not in msg["html"]
    assert prefs["unsubscribe_token"] in msg["html"]
    # Instrumentation row landed.
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT detail FROM retention_events WHERE username = {ph} AND event_type = 'lifecycle_email_sent'",
            ("choke_send",),
        )
        rows = c.fetchall() or []
    assert [(r["detail"] if hasattr(r, "keys") else r[0]) for r in rows] == ["welcome_owner"]


def test_chokepoint_respects_optout_before_transport(mysql_dsn, monkeypatch):
    make_user("choke_optout")
    sent = _capture_sends(monkeypatch)
    monkeypatch.setenv("LIFECYCLE_EMAIL_ENABLED", "1")
    row = email_preferences.get_or_create("choke_optout", "choke_optout@test.local")
    email_preferences.set_lifecycle_optout_by_token(row["unsubscribe_token"], True)
    status = lifecycle_email.send(
        "choke_optout", kind="no_community_nudge", subject="s", html=_lifecycle_html()
    )
    assert status == "suppressed"
    assert sent == []


def test_chokepoint_rejects_transactional_category(mysql_dsn):
    with pytest.raises(ValueError):
        lifecycle_email.send(
            "whoever", kind="reset", subject="s", html="<p>x</p>",
            category="transactional",
        )


def test_server_only_lifecycle_event_rejected_from_client_vocab(mysql_dsn):
    # The client sink must not be able to fabricate email-send metrics.
    assert "lifecycle_email_sent" in retention_events.SERVER_ONLY_EVENT_TYPES


# ── 3. Unsubscribe HTTP surface ─────────────────────────────────────────


def test_unsubscribe_get_never_mutates(mysql_dsn, client):
    make_user("unsub_get")
    row = email_preferences.get_or_create("unsub_get", "unsub_get@test.local")
    resp = client.get(f"/email/unsubscribe?t={row['unsubscribe_token']}")
    assert resp.status_code == 200
    assert email_preferences.may_send("unsub_get", category="lifecycle") is True


def test_unsubscribe_one_click_post_and_resubscribe(mysql_dsn, client):
    make_user("unsub_post")
    row = email_preferences.get_or_create("unsub_post", "unsub_post@test.local")
    token = row["unsubscribe_token"]
    # RFC 8058 machine POST — no Accept: text/html.
    resp = client.post(
        f"/email/unsubscribe?t={token}",
        data={"List-Unsubscribe": "One-Click"},
        headers={"Accept": "*/*"},
    )
    assert resp.status_code == 200
    assert email_preferences.may_send("unsub_post", category="lifecycle") is False
    # Human resubscribe from the done page.
    resp = client.post(
        "/email/resubscribe", data={"t": token}, headers={"Accept": "text/html"}
    )
    assert resp.status_code == 200
    assert email_preferences.may_send("unsub_post", category="lifecycle") is True


def test_unsubscribe_invalid_token_non_enumerating(mysql_dsn, client):
    make_user("unsub_bogus")
    email_preferences.get_or_create("unsub_bogus", "unsub_bogus@test.local")
    ok = client.get(
        f"/email/unsubscribe?t={email_preferences.get_for_user('unsub_bogus')['unsubscribe_token']}"
    )
    bad = client.get("/email/unsubscribe?t=definitely-not-a-token")
    # Same status either way; the invalid page carries no user data.
    assert ok.status_code == bad.status_code == 200
    assert b"unsub_bogus" not in bad.data
    # Machine POST with a bogus token is still a bare 200.
    resp = client.post("/email/unsubscribe?t=nope", headers={"Accept": "*/*"})
    assert resp.status_code == 200


# ── 4. Welcome sweep ────────────────────────────────────────────────────


def test_welcome_sweep_owner_and_member_variants(mysql_dsn, monkeypatch):
    _enable_all(monkeypatch)
    sent = _capture_sends(monkeypatch)
    make_user("fresh_owner")
    make_user("fresh_member")
    cid = make_community("Rowing Club", creator_username="someone_else")
    _join_community("fresh_member", cid)

    out = dispatch.run_welcome_sweep(dry_run=True)
    assert out["candidates"] == 2
    variants = {p["username"]: p["variant"] for p in out["preview"]}
    assert variants["fresh_owner"] == "welcome_owner"
    assert variants["fresh_member"] == "welcome_member"
    assert _sends_rows() == []  # dry_run reserves nothing

    out = dispatch.run_welcome_sweep()
    assert out["sent"] == 2
    by_to = {m["to"]: m for m in sent}
    assert "Rowing Club" in by_to["fresh_member@test.local"]["subject"]
    assert "community" in by_to["fresh_owner@test.local"]["subject"].lower()
    assert ("fresh_owner", "welcome") in _sends_rows()

    # Idempotent: a scheduler retry sends nothing new.
    out = dispatch.run_welcome_sweep()
    assert out["candidates"] == 0
    assert len(sent) == 2


def test_welcome_sweep_skips_unverified_and_old_users(mysql_dsn, monkeypatch):
    _enable_all(monkeypatch)
    _capture_sends(monkeypatch)
    make_user("unverified_u")
    make_user("old_u", created_at=datetime.utcnow() - timedelta(days=10))
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE users SET email_verified = 0 WHERE username = {ph}", ("unverified_u",)
        )
        conn.commit()
    out = dispatch.run_welcome_sweep(dry_run=True)
    assert out["candidates"] == 0


def test_welcome_sweep_releases_reservation_on_optout(mysql_dsn, monkeypatch):
    _enable_all(monkeypatch)
    sent = _capture_sends(monkeypatch)
    make_user("optout_fresh")
    row = email_preferences.get_or_create("optout_fresh", "optout_fresh@test.local")
    email_preferences.set_lifecycle_optout_by_token(row["unsubscribe_token"], True)
    out = dispatch.run_welcome_sweep()
    assert out["sent"] == 0
    assert out["skipped_suppressed"] == 1
    assert sent == []
    # Reservation released — the user is not falsely marked as welcomed.
    assert ("optout_fresh", "welcome") not in _sends_rows()


# ── 5. Activation nudges ────────────────────────────────────────────────


def test_no_community_nudge_cohort_and_send(mysql_dsn, monkeypatch):
    _enable_all(monkeypatch)
    sent = _capture_sends(monkeypatch)
    make_user("idle_3d", created_at=datetime.utcnow() - timedelta(days=3))
    make_user("too_fresh")  # < 48h — not in cohort yet
    joined = make_user("joined_3d", created_at=datetime.utcnow() - timedelta(days=3))
    cid = make_community("Busy Club", creator_username="whoever")
    _join_community("joined_3d", cid)
    assert joined  # silence linters

    out = dispatch.run_activation_nudge_sweep(dry_run=True)
    assert out["no_community"]["preview"] == ["idle_3d"]

    out = dispatch.run_activation_nudge_sweep()
    assert out["no_community"]["sent"] == 1
    assert sent[0]["to"] == "idle_3d@test.local"
    # Once ever.
    out = dispatch.run_activation_nudge_sweep()
    assert out["no_community"]["candidates"] == 0


def test_empty_community_nudge_and_invite_sent_stop(mysql_dsn, monkeypatch):
    _enable_all(monkeypatch)
    sent = _capture_sends(monkeypatch)
    make_user("lonely_owner", created_at=datetime.utcnow() - timedelta(days=20))
    make_user("active_owner", created_at=datetime.utcnow() - timedelta(days=20))
    lonely_cid = make_community("Lonely Space", creator_username="lonely_owner")
    active_cid = make_community("Inviting Space", creator_username="active_owner")
    _backdate_community(lonely_cid, 5)
    _backdate_community(active_cid, 5)
    _join_community("lonely_owner", lonely_cid)
    _join_community("active_owner", active_cid)
    # active_owner already sent an invite → nudge suppressed.
    retention_events.record_event(
        "active_owner", event_type="invite_sent", source="server",
        community_id=active_cid, detail="invite_link",
    )

    out = dispatch.run_activation_nudge_sweep(dry_run=True)
    owners = [p["owner"] for p in out["empty_community"]["preview"]]
    assert owners == ["lonely_owner"]

    out = dispatch.run_activation_nudge_sweep()
    assert out["empty_community"]["sent"] == 1
    assert sent[-1]["to"] == "lonely_owner@test.local"
    assert "Lonely Space" in sent[-1]["subject"]


def test_contact_gap_blocks_back_to_back_nudges(mysql_dsn, monkeypatch):
    _enable_all(monkeypatch)
    sent = _capture_sends(monkeypatch)
    make_user("gap_user", created_at=datetime.utcnow() - timedelta(days=3))
    # Simulate a welcome sent an hour ago.
    with get_db_connection() as conn:
        c = conn.cursor()
        dispatch._ensure_sends_table(c)
        ph = get_sql_placeholder()
        c.execute(
            f"INSERT INTO lifecycle_email_sends (recipient, kind, sent_at) VALUES ({ph}, 'welcome', {ph})",
            ("gap_user", (datetime.utcnow() - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()
    out = dispatch.run_activation_nudge_sweep()
    assert out["no_community"]["sent"] == 0
    assert sent == []


# ── 6. Verification reminder ────────────────────────────────────────────


def test_verification_reminder_fresh_token_once(mysql_dsn, monkeypatch):
    _enable_all(monkeypatch)
    sent = _capture_sends(monkeypatch)
    _make_pending_signup("stalled@example.com", sent_hours_ago=30)
    _make_pending_signup("very_fresh@example.com", sent_hours_ago=2)   # too young
    _make_pending_signup("ancient@example.com", sent_hours_ago=24 * 10)  # too old
    # Already registered — must be excluded even though pending row remains.
    _make_pending_signup("done@example.com", sent_hours_ago=30)
    make_user("done_user", email="done@example.com")

    tokens: List[tuple] = []

    def _stub_token(pending_id, email):
        tokens.append((pending_id, email))
        return f"tok-{pending_id}"

    out = dispatch.run_verification_reminder_sweep(dry_run=True, token_factory=_stub_token)
    assert out["candidates"] == 1
    assert out["preview"] == ["stalled@example.com"]

    out = dispatch.run_verification_reminder_sweep(token_factory=_stub_token)
    assert out["sent"] == 1
    assert tokens and tokens[0][1] == "stalled@example.com"
    assert "tok-" in sent[0]["html"]
    # Transactional: no unsubscribe footer machinery.
    assert lifecycle_email.FOOTER_PLACEHOLDER not in sent[0]["html"]
    assert "List-Unsubscribe" not in (sent[0]["headers"] or {})

    out = dispatch.run_verification_reminder_sweep(token_factory=_stub_token)
    assert out["candidates"] == 0  # once per address, ever


# ── 7. Cron endpoints ───────────────────────────────────────────────────


def test_cron_endpoints_reject_without_secret(mysql_dsn, client):
    for path in (
        "/api/cron/email/welcome",
        "/api/cron/email/activation-nudges",
        "/api/cron/email/verification-reminders",
    ):
        resp = client.post(path)
        assert resp.status_code == 403, path


def test_cron_welcome_dry_run_counters(mysql_dsn, client, monkeypatch):
    _enable_all(monkeypatch)
    _capture_sends(monkeypatch)
    make_user("cron_fresh")
    resp = client.post("/api/cron/email/welcome?dry_run=1", headers=CRON_HEADERS)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["dry_run"] is True
    assert body["candidates"] == 1
    assert _sends_rows() == []


def test_cron_welcome_disabled_kill_switch(mysql_dsn, client, monkeypatch):
    _capture_sends(monkeypatch)
    monkeypatch.delenv("WELCOME_EMAIL_ENABLED", raising=False)
    make_user("cron_blocked")
    resp = client.post("/api/cron/email/welcome", headers=CRON_HEADERS)
    assert resp.status_code == 409
    assert resp.get_json()["success"] is False
