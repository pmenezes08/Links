"""Unit tests for onboarding session helpers (deferral, resume, effective profile)."""

from datetime import datetime, timedelta, timezone

from backend.services import onboarding_session as osess


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def test_profile_defer_active_future():
    now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
    until = now + timedelta(hours=1)
    doc = {"profile_defer_until": _iso(until)}
    assert osess.profile_defer_active(doc, now) is True


def test_profile_defer_active_past():
    now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
    until = now - timedelta(hours=1)
    doc = {"profile_defer_until": _iso(until)}
    assert osess.profile_defer_active(doc, now) is False


def test_requires_onboarding_resume_after_defer():
    now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
    until = now - timedelta(minutes=1)
    doc = {"stage": "welcome", "profile_defer_until": _iso(until)}
    assert osess.requires_onboarding_resume(doc=doc, now_utc=now) is True


def test_requires_onboarding_resume_false_when_complete():
    now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
    until = now - timedelta(hours=1)
    doc = {"stage": "complete", "profile_defer_until": _iso(until), "completed_at": _iso(now)}
    assert osess.requires_onboarding_resume(doc=doc, now_utc=now) is False


def test_compute_profile_complete_effective_false_during_defer():
    now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
    until = now + timedelta(hours=24)
    doc = {"stage": "name", "profile_defer_until": _iso(until)}
    assert (
        osess.compute_profile_complete_effective(sql_profile_complete=True, doc=doc, now_utc=now)
        is False
    )


def test_compute_profile_complete_effective_sql_when_no_firestore_inflight():
    now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
    assert (
        osess.compute_profile_complete_effective(sql_profile_complete=True, doc=None, now_utc=now)
        is True
    )


def test_build_onboarding_state_payload_requires_resume():
    now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
    until = now - timedelta(hours=1)
    row = ("a", "b", "c", "d", "e", "f", "g")
    doc = {"stage": "welcome", "profile_defer_until": _iso(until)}
    payload = osess.build_onboarding_state_payload(
        username="u1",
        sql_row=row,
        firestore_doc=doc,
        now_utc=now,
    )
    assert payload["requiresOnboardingResume"] is True
    assert payload["profileCompleteEffective"] is False
