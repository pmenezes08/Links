"""
Server-side onboarding session rules: profile deferral window, combined state for the client.

Firestore doc ``steve_onboarding/{username}`` holds ``stage``, ``collected``, ``messages``,
optional ``profile_defer_until`` (ISO UTC), ``profile_deferred_at``, ``onboarding_intent``,
and completion markers ``completed_at`` / ``stage == "complete"``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

PROFILE_DEFER_GRACE_HOURS = 72
PERSONAL_STAGES = {
    "talk_all_day",
    "reach_out",
    "journey",
    "recommend",
    "optional_social",
    "personal_bio_review",
}

PROFESSIONAL_STAGES = {
    "professional",
    "professional_confirm",
    "fix_role",
    "fix_company",
    "professional_associations",
    "professional_strengths",
    "linkedin",
    "professional_bio_review",
    "cv_upload",
    "cv_review",
}


def _parse_iso_utc(value: Optional[str]) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def sql_profile_complete_from_row(row: Optional[Any]) -> bool:
    """Match legacy onboarding SQL heuristic: >= 4 of 7 profile fields filled."""
    if not row:
        return False
    try:
        if hasattr(row, "keys"):
            vals = list(row.values())[:7]
        else:
            vals = [row[i] for i in range(7)]
    except Exception:
        return False
    filled = sum(1 for v in vals if v and str(v).strip())
    return filled >= 4


def _row_get(row: Optional[Any], key: str, index: Optional[int] = None) -> Any:
    if not row:
        return None
    try:
        if hasattr(row, "keys"):
            return row[key]
    except Exception:
        pass
    if index is None:
        return None
    try:
        return row[index]
    except Exception:
        return None


def _filled(value: Any) -> bool:
    return bool(value and str(value).strip())


def durable_personal_section_complete_from_row(row: Optional[Any]) -> bool:
    """True when durable profile data already contains the personal background section."""
    return _filled(_row_get(row, "bio", 6)) or _filled(_row_get(row, "personal_highlight_answers", 10))


def durable_professional_section_complete_from_row(row: Optional[Any]) -> bool:
    """True when durable profile data already contains a usable professional background."""
    if _filled(_row_get(row, "professional_about", 8)):
        return True
    role = _row_get(row, "role", 2)
    company = _row_get(row, "company", 3)
    linkedin = _row_get(row, "linkedin", 7)
    return (_filled(role) and _filled(company)) or (_filled(role) and _filled(linkedin))


def collected_personal_section_complete(collected: Optional[Dict[str, Any]]) -> bool:
    data = collected or {}
    # The completion flag alone is not trusted: section-only builder runs
    # historically persisted a faked flag for the section they skipped
    # (poisoned docs exist in the wild). The flag only counts when at
    # least one actual personal answer backs it up.
    has_content = _filled(data.get("bio")) or any(
        _filled(data.get(key))
        for key in ("talkAllDay", "reachOut", "journey", "recommend")
    )
    if data.get("personalSectionComplete") and has_content:
        return True
    return has_content


def collected_professional_section_complete(collected: Optional[Dict[str, Any]]) -> bool:
    data = collected or {}
    role = data.get("role")
    company = data.get("company")
    linkedin = data.get("linkedin")
    has_content = (
        _filled(data.get("professionalBio"))
        or (_filled(role) and _filled(company))
        or (_filled(role) and _filled(linkedin))
    )
    # Same poisoned-flag rule as the personal section: the flag needs
    # content behind it.
    if data.get("professionalSectionComplete") and has_content:
        return True
    return has_content


def firestore_onboarding_complete(doc: Optional[Dict[str, Any]]) -> bool:
    if not doc:
        return False
    if doc.get("completed_at"):
        return True
    return str(doc.get("stage") or "").lower() == "complete"


def profile_defer_active(doc: Optional[Dict[str, Any]], now_utc: datetime) -> bool:
    if not doc:
        return False
    until = _parse_iso_utc(doc.get("profile_defer_until"))
    if until is None:
        return False
    return until > now_utc


def has_in_progress_onboarding(doc: Optional[Dict[str, Any]]) -> bool:
    if not doc:
        return False
    if firestore_onboarding_complete(doc):
        return False
    stage = str(doc.get("stage") or "").strip().lower()
    if not stage or stage == "complete":
        return False
    return True


def compute_profile_complete_effective(
    *,
    sql_profile_complete: bool,
    doc: Optional[Dict[str, Any]],
    now_utc: datetime,
) -> bool:
    """
    While deferral is active, do not treat SQL partial profile as "complete enough"
    to skip onboarding prompts (dashboard uses this via GET state).

    If Firestore shows an in-flight onboarding conversation, never use SQL-only
    completeness to skip — users can fill ≥4 fields mid-flow.
    """
    if firestore_onboarding_complete(doc):
        return True
    if profile_defer_active(doc, now_utc):
        return False
    if has_in_progress_onboarding(doc):
        return False
    return sql_profile_complete


def requires_onboarding_resume(
    *,
    doc: Optional[Dict[str, Any]],
    now_utc: datetime,
) -> bool:
    """True when defer window expired and onboarding was never completed."""
    if firestore_onboarding_complete(doc):
        return False
    until = _parse_iso_utc((doc or {}).get("profile_defer_until"))
    if until is None:
        return False
    return until <= now_utc


def build_defer_timestamps(now_utc: Optional[datetime] = None) -> Tuple[str, str]:
    base = now_utc or datetime.now(timezone.utc)
    until = base + timedelta(hours=PROFILE_DEFER_GRACE_HOURS)
    return base.isoformat(), until.isoformat()


def _section_started(section: str, data: Dict[str, Any]) -> bool:
    if section == "personal":
        keys = ("talkAllDay", "reachOut", "journey", "recommend", "bio")
        return any(str(data.get(key) or "").strip() for key in keys)
    base = any(
        str(data.get(key) or "").strip()
        for key in (
            "role",
            "professionalAssociations",
            "professionalStrengths",
            "linkedin",
            "professionalBio",
        )
    )
    return base or bool(data.get("linkedinDone"))


def _first_unanswered_stage_for_section(section: str, data: Dict[str, Any]) -> str:
    if section == "personal":
        if not str(data.get("talkAllDay") or "").strip():
            return "talk_all_day"
        if not str(data.get("reachOut") or "").strip():
            return "reach_out"
        if not str(data.get("journey") or "").strip():
            return "journey"
        if not str(data.get("recommend") or "").strip():
            return "recommend"
        if not str(data.get("bio") or "").strip():
            return "optional_social"
        return "personal_bio_review"

    if not str(data.get("role") or "").strip():
        return "professional"
    if not str(data.get("professionalAssociations") or "").strip():
        return "professional_associations"
    if not str(data.get("professionalStrengths") or "").strip():
        return "professional_strengths"
    if not bool(data.get("linkedinDone")):
        return "linkedin"
    return "professional_bio_review"


def _start_or_resume_section(section: str, data: Dict[str, Any]) -> str:
    if section == "personal":
        if data.get("personalSectionComplete"):
            return "profile_review" if data.get("professionalSectionComplete") else "section_picker"
        if _section_started("personal", data):
            return _first_unanswered_stage_for_section("personal", data)
        return "personal_section_intro"

    if data.get("professionalSectionComplete"):
        return "profile_review" if data.get("personalSectionComplete") else "section_picker"
    if _section_started("professional", data):
        return _first_unanswered_stage_for_section("professional", data)
    return "professional_section_intro"


def next_incomplete_profile_stage(collected: Optional[Dict[str, Any]]) -> str:
    """Return the next profile section entry point for mixed complete/incomplete state."""
    data = collected or {}
    personal_complete = bool(data.get("personalSectionComplete"))
    professional_complete = bool(data.get("professionalSectionComplete"))
    if not personal_complete and not professional_complete:
        return "section_picker"
    if personal_complete and not professional_complete:
        return _start_or_resume_section("professional", data)
    if professional_complete and not personal_complete:
        return _start_or_resume_section("personal", data)
    return "profile_review"


def next_unanswered_profile_stage(
    stage: Optional[str],
    collected: Optional[Dict[str, Any]],
) -> str:
    """Return the next durable profile prompt from saved onboarding answers."""
    data = collected or {}
    saved_stage = str(stage or "").strip()
    if saved_stage == "complete":
        return "complete"

    if saved_stage == "linkedin":
        if data.get("professionalSectionComplete"):
            return next_incomplete_profile_stage(data)
        return "linkedin"

    if saved_stage in ("cv_upload", "cv_review"):
        return saved_stage

    if saved_stage in PERSONAL_STAGES:
        if data.get("personalSectionComplete"):
            return next_incomplete_profile_stage(data)
        return _first_unanswered_stage_for_section("personal", data)

    if saved_stage in PROFESSIONAL_STAGES:
        if data.get("professionalSectionComplete"):
            return next_incomplete_profile_stage(data)
        return _first_unanswered_stage_for_section("professional", data)

    if saved_stage == "section_picker":
        return next_incomplete_profile_stage(data)

    if saved_stage == "profile_review":
        if data.get("personalSectionComplete") and data.get("professionalSectionComplete"):
            return "profile_review"
        return next_incomplete_profile_stage(data)

    return saved_stage or "section_picker"


def merge_defer_into_state_patch(
    *,
    now_utc: Optional[datetime] = None,
) -> Dict[str, Any]:
    deferred_at, defer_until = build_defer_timestamps(now_utc)
    return {
        "profile_deferred_at": deferred_at,
        "profile_defer_until": defer_until,
        "onboarding_auto_open_suppressed": True,
        "onboarding_reminder_24h_sent_at": None,
        "onboarding_reminder_48h_sent_at": None,
        "updated_at": deferred_at,
    }


def build_onboarding_state_payload(
    *,
    username: str,
    sql_row: Optional[Any],
    firestore_doc: Optional[Dict[str, Any]],
    now_utc: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Assemble JSON-serialisable extras for GET /api/onboarding/state."""
    now = now_utc or datetime.now(timezone.utc)
    sql_pc = sql_profile_complete_from_row(sql_row)
    complete_fs = firestore_onboarding_complete(firestore_doc)
    defer_until_raw = (firestore_doc or {}).get("profile_defer_until")
    payload: Dict[str, Any] = {
        "profileComplete": sql_pc,
        "profileCompleteEffective": compute_profile_complete_effective(
            sql_profile_complete=sql_pc,
            doc=firestore_doc,
            now_utc=now,
        ),
        "profileDeferUntil": defer_until_raw,
        "serverTime": now.isoformat(),
        "requiresOnboardingResume": requires_onboarding_resume(doc=firestore_doc, now_utc=now),
        "onboardingComplete": complete_fs,
        "onboardingAutoOpenSuppressed": bool((firestore_doc or {}).get("onboarding_auto_open_suppressed")),
        "profileDeferredAt": (firestore_doc or {}).get("profile_deferred_at"),
    }
    collected = (firestore_doc or {}).get("collected") or {}
    if isinstance(collected, dict):
        personal_effective = (
            durable_personal_section_complete_from_row(sql_row)
            or collected_personal_section_complete(collected)
        )
        professional_effective = (
            durable_professional_section_complete_from_row(sql_row)
            or collected_professional_section_complete(collected)
        )
        payload["onboardingProgress"] = {
            "personalSectionComplete": bool(collected.get("personalSectionComplete")),
            "professionalSectionComplete": bool(collected.get("professionalSectionComplete")),
            "personalSectionCompleteEffective": bool(personal_effective),
            "professionalSectionCompleteEffective": bool(professional_effective),
            "activeProfileSection": collected.get("activeProfileSection"),
            "nextStage": next_unanswered_profile_stage((firestore_doc or {}).get("stage"), collected),
        }
    else:
        payload["onboardingProgress"] = {
            "personalSectionComplete": False,
            "professionalSectionComplete": False,
            "personalSectionCompleteEffective": bool(durable_personal_section_complete_from_row(sql_row)),
            "professionalSectionCompleteEffective": bool(durable_professional_section_complete_from_row(sql_row)),
            "activeProfileSection": None,
            "nextStage": "section_picker",
        }
    if firestore_doc and firestore_doc.get("onboarding_intent"):
        payload["onboardingIntent"] = firestore_doc.get("onboarding_intent")
    return payload
