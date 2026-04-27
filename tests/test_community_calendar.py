from __future__ import annotations

import pytest


def test_calendar_extract_time_handles_datetime_strings():
    from backend.services import community_calendar

    assert community_calendar.extract_time("2026-04-27 18:30:00") == "18:30"
    assert community_calendar.extract_time("18:30") == "18:30"
    assert community_calendar.extract_time("0000-00-00 00:00:00") is None


def test_calendar_validate_event_input_rejects_backwards_end():
    from backend.services import community_calendar

    with pytest.raises(community_calendar.CalendarError, match="End time cannot be before start time"):
        community_calendar.validate_event_input(
            community_calendar.EventInput(
                title="Lift",
                date="2026-04-27",
                start_time="18:00",
                end_time="17:00",
            )
        )


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
