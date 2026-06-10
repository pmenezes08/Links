from __future__ import annotations

import pytest


def test_calendar_extract_time_handles_datetime_strings():
    from backend.services import community_calendar

    assert community_calendar.extract_time("2026-04-27 18:30:00") == "18:30"
    assert community_calendar.extract_time("18:30") == "18:30"
    assert community_calendar.extract_time("0000-00-00 00:00:00") is None


def test_calendar_validate_event_input_rejects_backwards_end():
    from backend.services import api_errors, community_calendar

    with pytest.raises(community_calendar.CalendarError, match="End time cannot be before start time"):
        community_calendar.validate_event_input(
            community_calendar.EventInput(
                title="Lift",
                date="2026-04-27",
                start_time="18:00",
                end_time="17:00",
            )
        )


def test_calendar_validation_error_localized_payload():
    from backend.services import api_errors, community_calendar

    try:
        community_calendar.validate_event_input(
            community_calendar.EventInput(title="", date="2026-04-27")
        )
    except community_calendar.CalendarError as exc:
        assert exc.message_key == "calendar.errors.title_start_required"
        payload = api_errors.error_payload(exc.message_key, locale="pt-PT")
        assert payload["message_key"] == "calendar.errors.title_start_required"
        assert "obrigat" in payload["message"].lower()
    else:
        pytest.fail("expected CalendarError")


def test_calendar_validate_event_input_allows_none_reminders():
    from backend.services import community_calendar

    data = community_calendar.EventInput(
        title="Lift",
        date="2026-04-27",
        start_time="18:00",
        notification_preferences="none",
    )

    community_calendar.validate_event_input(data)
    assert data.notification_preferences == "none"


def test_calendar_validate_event_input_rejects_non_https_meeting_url():
    from backend.services import community_calendar

    data = community_calendar.EventInput(
        title="Lift",
        date="2026-04-27",
        meeting_url="http://meet.google.com/abc-defg-hij",
    )

    with pytest.raises(community_calendar.CalendarError, match="Meeting link"):
        community_calendar.validate_event_input(data)


def test_format_event_ics_all_day_and_uid():
    from backend.services import community_calendar

    body = community_calendar.format_event_ics(
        {
            "id": 42,
            "title": "Team social",
            "date": "2026-06-10",
            "end_date": "2026-06-11",
            "description": None,
            "community_name": "Main Gym",
        },
        public_base_url="https://app.example.test",
    )
    assert "BEGIN:VCALENDAR" in body
    assert "UID:cpoint-event-42@c-point.calendar" in body
    assert "DTSTART;VALUE=DATE:20260610" in body
    # Exclusive end date: last day June 11 -> DTEND June 12
    assert "DTEND;VALUE=DATE:20260612" in body
    assert "SUMMARY:Team social" in body
    assert "LOCATION:Main Gym" in body
    assert "https://app.example.test/event/42" in body


def test_format_event_ics_escapes_summary_special_chars():
    from backend.services import community_calendar

    body = community_calendar.format_event_ics(
        {"id": 7, "title": "Meet; Greet", "date": "2026-01-15"},
        public_base_url="https://x.test",
    )
    assert "SUMMARY:Meet\\; Greet" in body


def test_format_event_ics_includes_meeting_url():
    from backend.services import community_calendar

    body = community_calendar.format_event_ics(
        {
            "id": 8,
            "title": "Meet online",
            "date": "2026-01-15",
            "meeting_url": "https://meet.google.com/abc-defg-hij",
        },
        public_base_url="https://x.test",
    )

    assert "Meeting link: https://meet.google.com/abc-defg-hij" in body
    assert "URL:https://meet.google.com/abc-defg-hij" in body


def test_format_event_ics_timed_with_default_end():
    from backend.services import community_calendar

    body = community_calendar.format_event_ics(
        {
            "id": 3,
            "title": "Lift",
            "date": "2026-04-27",
            "start_time": "18:00",
            "end_time": None,
        },
        public_base_url="https://x.test",
    )
    assert "DTSTART:20260427T180000" in body
    assert "DTEND:20260427T190000" in body


def test_api_calendar_event_ics_happy_path(monkeypatch):
    from flask import Blueprint, Flask

    import backend.blueprints.community_calendar as cal_bp_mod
    from backend.services import community_calendar

    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.config["PUBLIC_BASE_URL"] = "https://staging.example.test"
    auth = Blueprint("auth", __name__)

    @auth.route("/login")
    def login_stub():
        return "login"

    app.register_blueprint(auth)
    app.register_blueprint(cal_bp_mod.community_calendar_bp)

    sample = {
        "id": 99,
        "title": "ICS test",
        "date": "2026-08-01",
        "end_date": "2026-08-01",
        "start_time": None,
        "end_time": None,
        "description": None,
        "timezone": None,
        "community_name": "C",
    }

    monkeypatch.setattr(cal_bp_mod.calendar_svc, "ensure_user_can_view_event", lambda *_a, **_k: None)
    monkeypatch.setattr(cal_bp_mod.calendar_svc, "get_event", lambda *_a, **_k: sample)

    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "alice"
        resp = client.get("/api/calendar_events/99/ics")
    assert resp.status_code == 200
    assert resp.mimetype.startswith("text/calendar")
    data = resp.get_data(as_text=True)
    assert "BEGIN:VCALENDAR" in data
    assert "SUMMARY:ICS test" in data
    assert "staging.example.test" in data


def test_api_calendar_event_ics_forbidden(monkeypatch):
    from flask import Blueprint, Flask

    import backend.blueprints.community_calendar as cal_bp_mod
    from backend.services import community_calendar

    def deny(*_a, **_k):
        raise community_calendar.CalendarError("nope", 403)

    app = Flask(__name__)
    app.secret_key = "test-secret"
    auth = Blueprint("auth", __name__)

    @auth.route("/login")
    def login_stub():
        return "login"

    app.register_blueprint(auth)
    app.register_blueprint(cal_bp_mod.community_calendar_bp)
    monkeypatch.setattr(cal_bp_mod.calendar_svc, "ensure_user_can_view_event", deny)

    with app.test_client() as client:
        with client.session_transaction() as sess:
            sess["username"] = "alice"
        resp = client.get("/api/calendar_events/1/ics")
    assert resp.status_code == 403


def test_calendar_timezone_validation():
    from backend.services import community_calendar

    # Valid IANA timezone
    data_ok = community_calendar.EventInput(
        title="Lift",
        date="2026-06-08",
        timezone="Europe/Lisbon",
    )
    community_calendar.validate_event_input(data_ok)

    # Valid legacy abbreviation
    data_legacy = community_calendar.EventInput(
        title="Lift",
        date="2026-06-08",
        timezone="GMT",
    )
    community_calendar.validate_event_input(data_legacy)

    # Invalid timezone
    data_bad = community_calendar.EventInput(
        title="Lift",
        date="2026-06-08",
        timezone="Invalid/Timezone",
    )
    with pytest.raises(community_calendar.CalendarError, match="Invalid timezone"):
        community_calendar.validate_event_input(data_bad)


def test_derive_utc_instants():
    from backend.services import community_calendar
    from datetime import datetime, timezone

    # Lisbon is WEST (UTC+1) in June (DST active)
    starts, ends = community_calendar.derive_utc_instants(
        date_str="2026-06-08",
        end_date_str=None,
        start_time_str="10:00",
        end_time_str="11:30",
        tz_name="Europe/Lisbon",
    )
    assert starts == datetime(2026, 6, 8, 9, 0, tzinfo=timezone.utc)
    assert ends == datetime(2026, 6, 8, 10, 30, tzinfo=timezone.utc)

    # Lisbon is WET (UTC+0) in December (DST inactive)
    starts, ends = community_calendar.derive_utc_instants(
        date_str="2026-12-08",
        end_date_str=None,
        start_time_str="10:00",
        end_time_str="11:30",
        tz_name="Europe/Lisbon",
    )
    assert starts == datetime(2026, 12, 8, 10, 0, tzinfo=timezone.utc)
    assert ends == datetime(2026, 12, 8, 11, 30, tzinfo=timezone.utc)


def test_format_event_ics_with_utc_instants():
    from backend.services import community_calendar

    body = community_calendar.format_event_ics(
        {
            "id": 123,
            "title": "Lisbon Event",
            "date": "2026-06-08",
            "starts_at_utc": "2026-06-08 09:00:00",
            "ends_at_utc": "2026-06-08 10:30:00",
            "timezone": "Europe/Lisbon",
        },
        public_base_url="https://x.test",
    )
    assert "DTSTART:20260608T090000Z" in body
    assert "DTEND:20260608T103000Z" in body
