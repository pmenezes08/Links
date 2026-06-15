"""Privacy-IDOR tests for the calendar read routes.

Four calendar read routes accepted a client-supplied event_id and returned event
+ member data (invitee / RSVP usernames) with no visibility check. The fix
centralizes authorization inside ``community_calendar.get_event`` (covering the
four routes + the .ics export) and keeps an explicit
``ensure_user_can_view_event`` before ``rsvp_details`` in the two RSVP routes.

Two layers of coverage:

1. **Route wiring** (monkeypatch, no DB) — matches the existing
   ``test_api_calendar_event_ics_*`` convention (the calendar tables are not in
   the test bootstrap, so route tests stub the service). Proves each of the four
   routes returns 403 when authorization denies and 200 when it allows.

2. **Real authorization decision** (MySQL) — exercises the actual
   ``ensure_user_can_view_event`` SQL against a minimal calendar schema: the
   creator and an invitee are allowed; a non-member and an anonymous user get a
   403, and ``get_event`` itself denies the non-member.
"""

from __future__ import annotations

import pytest

from backend.services.database import get_db_connection, get_sql_placeholder


# ── Sample payloads for the allow-path route tests ──────────────────────────

_SAMPLE_EVENT = {
    "id": 5,
    "title": "Members only",
    "date": "2026-09-01",
    "rsvp_counts": {"going": 0, "maybe": 0, "not_going": 0},
    "user_rsvp": None,
}

_SAMPLE_RSVP_DETAILS = {
    "attendees": {"going": [], "maybe": [], "not_going": [], "no_response": []},
    "invited": [],
}

# (method, path) for each of the four gated read routes.
def _routes(event_id: int):
    return [
        f"/api/calendar_events/{event_id}",
        f"/get_calendar_event/{event_id}",
        f"/event/{event_id}/rsvps",
        f"/get_event_rsvp_details?event_id={event_id}",
    ]


def _make_app():
    from flask import Blueprint, Flask

    import backend.blueprints.community_calendar as cal_bp_mod

    app = Flask(__name__)
    app.secret_key = "test-secret"
    auth = Blueprint("auth", __name__)

    @auth.route("/login")
    def login_stub():
        return "login"

    app.register_blueprint(auth)
    app.register_blueprint(cal_bp_mod.community_calendar_bp)
    return app, cal_bp_mod


# ── 1. Route wiring (no DB) ─────────────────────────────────────────────────


def test_all_four_calendar_read_routes_return_403_when_denied(monkeypatch):
    from backend.services import community_calendar

    app, cal_bp_mod = _make_app()

    def deny(*_a, **_k):
        raise community_calendar.CalendarError("forbidden", 403)

    # Whichever function a route reaches first, denial surfaces as 403.
    monkeypatch.setattr(cal_bp_mod.calendar_svc, "ensure_user_can_view_event", deny)
    monkeypatch.setattr(cal_bp_mod.calendar_svc, "get_event", deny)
    monkeypatch.setattr(cal_bp_mod.calendar_svc, "rsvp_details", deny)

    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "outsider"
        for path in _routes(77):
            resp = client.get(path)
            assert resp.status_code == 403, f"{path} -> {resp.status_code}, expected 403"


def test_all_four_calendar_read_routes_return_200_when_allowed(monkeypatch):
    app, cal_bp_mod = _make_app()

    monkeypatch.setattr(cal_bp_mod.calendar_svc, "ensure_user_can_view_event", lambda *_a, **_k: None)
    monkeypatch.setattr(cal_bp_mod.calendar_svc, "get_event", lambda *_a, **_k: dict(_SAMPLE_EVENT))
    monkeypatch.setattr(cal_bp_mod.calendar_svc, "rsvp_details", lambda *_a, **_k: dict(_SAMPLE_RSVP_DETAILS))

    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "creator"
        for path in _routes(5):
            resp = client.get(path)
            assert resp.status_code == 200, f"{path} -> {resp.status_code}, expected 200"
            assert resp.get_json().get("success") is True


# ── 2. Real authorization decision (MySQL) ──────────────────────────────────


def _ensure_minimal_calendar_schema() -> None:
    """Create just the columns ``ensure_user_can_view_event`` reads.

    The full calendar schema is owned by the monolith and not part of the test
    bootstrap; the authorization query only needs ``calendar_events(id, username)``
    and ``event_invitations(event_id, invited_username)``.
    """
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS calendar_events (
                id INT PRIMARY KEY AUTO_INCREMENT,
                username VARCHAR(191),
                community_id INT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS event_invitations (
                id INT PRIMARY KEY AUTO_INCREMENT,
                event_id INT NOT NULL,
                invited_username VARCHAR(191) NOT NULL,
                invited_by VARCHAR(191),
                invited_at VARCHAR(64)
            )
            """
        )
        conn.commit()


def _make_event(creator: str, invitee: str | None = None) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"INSERT INTO calendar_events (username) VALUES ({ph})", (creator,))
        event_id = int(c.lastrowid)
        if invitee:
            c.execute(
                f"INSERT INTO event_invitations (event_id, invited_username) VALUES ({ph}, {ph})",
                (event_id, invitee),
            )
        conn.commit()
        return event_id


def test_ensure_user_can_view_event_allows_creator_and_invitee_blocks_others(mysql_dsn):
    from backend.services import community_calendar as cal

    _ensure_minimal_calendar_schema()
    event_id = _make_event("cal_creator", invitee="cal_invitee")

    # Creator and invitee: no exception.
    cal.ensure_user_can_view_event(event_id, "cal_creator")
    cal.ensure_user_can_view_event(event_id, "cal_invitee")

    # Non-member and anonymous: CalendarError(403).
    with pytest.raises(cal.CalendarError) as outsider:
        cal.ensure_user_can_view_event(event_id, "cal_outsider")
    assert outsider.value.status == 403

    with pytest.raises(cal.CalendarError) as anon:
        cal.ensure_user_can_view_event(event_id, None)
    assert anon.value.status == 403


def test_get_event_denies_non_member(mysql_dsn):
    from backend.services import community_calendar as cal

    _ensure_minimal_calendar_schema()
    event_id = _make_event("cal_creator")

    # get_event now authorizes before fetching, so a non-member is rejected
    # (the 403 short-circuits before the row is shaped).
    with pytest.raises(cal.CalendarError) as exc:
        cal.get_event(event_id, "cal_outsider")
    assert exc.value.status == 403
