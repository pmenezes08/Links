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


def merge_defer_into_state_patch(
    *,
    now_utc: Optional[datetime] = None,
) -> Dict[str, Any]:
    deferred_at, defer_until = build_defer_timestamps(now_utc)
    return {
        "profile_deferred_at": deferred_at,
        "profile_defer_until": defer_until,
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
    }
    if firestore_doc and firestore_doc.get("onboarding_intent"):
        payload["onboardingIntent"] = firestore_doc.get("onboarding_intent")
    return payload
