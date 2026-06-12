"""Section-aware profile prompts (cron-dispatched).

Replaces the old whole-onboarding 24h/48h nags. The rules, in four
sentences: Steve asks for one profile section at a time, professional
first. A prompt fires no earlier than 48h after Tier-1 (the welcome
modal's You page), respects a global one-profile-ask-per-day budget and
72h spacing between section prompts, and never exceeds two pushes per
member, ever. An ignored section rotates once to the other section. Once
both sections are effectively complete, the member never hears from this
cron again.

Copy resolves in the recipient's locale via notification_copy
(``notifications.profile_section_{professional,personal}`` in
backend/locales). Deep link: the scoped two-minute section builder.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from backend.services import notification_copy
from backend.services.notifications import create_notification, send_push_to_user
from backend.services.onboarding_session import (
    _parse_iso_utc,
    collected_personal_section_complete,
    collected_professional_section_complete,
    durable_personal_section_complete_from_row,
    durable_professional_section_complete_from_row,
)

logger = logging.getLogger(__name__)

# Cadence floor after Tier-1: the welcome modal just asked for things —
# the product must go quiet before it asks for more.
MIN_HOURS_AFTER_TIER1 = 48
# Spacing between section prompts (the "3 days later" of the ask system).
SECTION_PROMPT_SPACING_HOURS = 72
# Global ask budget: at most one profile ask per member per day, shared
# with every other ask surface via the same marker.
PROFILE_ASK_BUDGET_HOURS = 24
# Lifetime push budget for this cron. Two, ever. Silence is a feature.
MAX_SECTION_PROMPTS = 2

MARKER_LAST_SENT = "section_prompt_last_sent_at"
MARKER_LAST_SECTION = "section_prompt_last_section"
MARKER_COUNT = "section_prompt_count"
MARKER_LAST_PROFILE_ASK = "last_profile_ask_at"


def _firestore_client():
    from backend.services.firestore_reads import _get_client

    return _get_client()


def _doc_to_dict(snapshot: Any) -> Dict[str, Any]:
    if hasattr(snapshot, "to_dict"):
        return snapshot.to_dict() or {}
    if isinstance(snapshot, dict):
        return snapshot
    return {}


def _doc_id(snapshot: Any) -> str:
    return str(getattr(snapshot, "id", "") or "")


def _doc_ref(snapshot: Any) -> Optional[Any]:
    return getattr(snapshot, "reference", None)


def _fetch_sql_row(username: str) -> Optional[Any]:
    """The canonical profile row (same SELECT as /api/onboarding/state)."""
    try:
        from backend.services.database import get_db_connection, get_sql_placeholder

        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT u.first_name, u.last_name, u.role, u.company,
                       u.country, u.city, p.bio, u.linkedin,
                       u.professional_about, u.professional_company_intel,
                       u.personal_highlight_answers
                FROM users u LEFT JOIN user_profiles p ON u.username = p.username
                WHERE u.username = {ph}
                """,
                (username,),
            )
            return c.fetchone()
    except Exception as exc:
        logger.warning("section prompts: sql row fetch failed for %s: %s", username, exc)
        return None


def section_status(doc: Dict[str, Any], sql_row: Optional[Any]) -> Tuple[bool, bool]:
    """(personal_complete, professional_complete) — durable OR collected."""
    collected = doc.get("collected") if isinstance(doc.get("collected"), dict) else {}
    personal = durable_personal_section_complete_from_row(sql_row) or collected_personal_section_complete(collected)
    professional = (
        durable_professional_section_complete_from_row(sql_row)
        or collected_professional_section_complete(collected)
    )
    return personal, professional


def pick_section(
    personal_complete: bool,
    professional_complete: bool,
    last_section: Optional[str],
) -> Optional[str]:
    """Professional first; an ignored section rotates once to its sibling."""
    incomplete = [
        s
        for s, done in (("professional", professional_complete), ("personal", personal_complete))
        if not done
    ]
    if not incomplete:
        return None
    if len(incomplete) == 1:
        return incomplete[0]
    # Both incomplete: rotate away from whatever was asked last.
    if last_section in incomplete:
        return next(s for s in incomplete if s != last_section)
    return "professional"


def _hours_since(value: Optional[str], now: datetime) -> Optional[float]:
    parsed = _parse_iso_utc(value)
    if not parsed:
        return None
    return (now - parsed).total_seconds() / 3600


def dispatch_onboarding_reminders(
    *,
    db: Optional[Any] = None,
    now_utc: Optional[datetime] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Send at most one section prompt per eligible member. Idempotent via
    per-doc markers; safe to run on any cron schedule."""
    now = now_utc or datetime.now(timezone.utc)
    fs = db or _firestore_client()
    checked = 0
    sent = 0
    skipped = 0

    try:
        snapshots = fs.collection("steve_onboarding").stream()
    except Exception as exc:
        logger.warning("section prompts: firestore stream failed: %s", exc)
        return {"success": False, "error": "firestore_unavailable", "checked": 0, "sent": 0}

    for snap in snapshots:
        checked += 1
        username = _doc_id(snap)
        doc = _doc_to_dict(snap)
        if not username or doc.get("completed_at") or doc.get("stage") == "complete":
            skipped += 1
            continue

        # Anchor on Tier-1 completion (the You page records it via
        # defer_profile). No anchor → unknown account state → stay quiet.
        anchor_hours = _hours_since(doc.get("profile_deferred_at"), now)
        if anchor_hours is None or anchor_hours < MIN_HOURS_AFTER_TIER1:
            skipped += 1
            continue

        if int(doc.get(MARKER_COUNT) or 0) >= MAX_SECTION_PROMPTS:
            skipped += 1
            continue

        spacing = _hours_since(doc.get(MARKER_LAST_SENT), now)
        if spacing is not None and spacing < SECTION_PROMPT_SPACING_HOURS:
            skipped += 1
            continue

        budget = _hours_since(doc.get(MARKER_LAST_PROFILE_ASK), now)
        if budget is not None and budget < PROFILE_ASK_BUDGET_HOURS:
            skipped += 1
            continue

        sql_row = _fetch_sql_row(username)
        personal_complete, professional_complete = section_status(doc, sql_row)
        section = pick_section(
            personal_complete, professional_complete, doc.get(MARKER_LAST_SECTION)
        )
        if not section:
            skipped += 1
            continue

        event = f"profile_section_{section}"
        link = f"/steve/profile-builder/{section}"
        if not dry_run:
            try:
                locale = notification_copy.recipient_locale(username)
                message = notification_copy.in_app_text(event, locale)
                create_notification(
                    username,
                    "Steve",
                    event,
                    None,
                    None,
                    message,
                    link=link,
                    preview_text=message,
                )
                push = notification_copy.push_payload(event, locale)
                send_push_to_user(username, push["title"], push["body"], data={"url": link})
            except Exception as exc:
                logger.warning("section prompts: send failed for %s: %s", username, exc)
                continue

            ref = _doc_ref(snap)
            if ref:
                try:
                    ref.set(
                        {
                            MARKER_LAST_SENT: now.isoformat(),
                            MARKER_LAST_SECTION: section,
                            MARKER_COUNT: int(doc.get(MARKER_COUNT) or 0) + 1,
                            MARKER_LAST_PROFILE_ASK: now.isoformat(),
                            "updated_at": now.isoformat(),
                        },
                        merge=True,
                    )
                except Exception as exc:
                    logger.warning("section prompts: marker write failed for %s: %s", username, exc)
        sent += 1

    return {"success": True, "checked": checked, "sent": sent, "skipped": skipped, "dry_run": dry_run}
