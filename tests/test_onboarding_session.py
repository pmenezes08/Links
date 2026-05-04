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


def test_defer_patch_suppresses_auto_open_and_resets_reminders():
    now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
    patch = osess.merge_defer_into_state_patch(now_utc=now)
    assert patch["onboarding_auto_open_suppressed"] is True
    assert patch["onboarding_reminder_24h_sent_at"] is None
    assert patch["onboarding_reminder_48h_sent_at"] is None


def test_next_unanswered_profile_stage_respects_saved_answers():
    collected = {
        "talkAllDay": "AI and tennis",
        "reachOut": "coffee chats",
        "journey": "",
        "recommend": "",
        "bio": "",
    }
    assert osess.next_unanswered_profile_stage("recommend", collected) == "journey"


def test_state_payload_includes_profile_section_progress():
    now = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)
    doc = {
        "stage": "professional_strengths",
        "collected": {
            "personalSectionComplete": True,
            "professionalSectionComplete": False,
            "role": "Founder",
            "professionalAssociations": "community strategy",
        },
    }
    payload = osess.build_onboarding_state_payload(
        username="u1",
        sql_row=None,
        firestore_doc=doc,
        now_utc=now,
    )
    assert payload["onboardingProgress"]["personalSectionComplete"] is True
    assert payload["onboardingProgress"]["professionalSectionComplete"] is False
    assert payload["onboardingProgress"]["nextStage"] == "professional_strengths"
