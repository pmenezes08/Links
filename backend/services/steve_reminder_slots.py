"""Grok JSON slot extraction for Reminder Vault (intent + subject + time phrase).

All persisted UTC times are validated via ``steve_reminder_parse.try_parse_fire_datetime`` — never raw model timestamps.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Literal, Optional

from backend.services.content_generation.llm import XAI_API_KEY, generate_json

logger = logging.getLogger(__name__)

_MAX_SUBJECT = 520
_MAX_PHRASE = 240

ReminderSlotIntent = Literal["schedule", "not_reminder"]


@dataclass(frozen=True)
class ReminderSlots:
    intent: ReminderSlotIntent
    subject: Optional[str]
    time_phrase: Optional[str]


_SYSTEM_FRESH = """You classify a single direct message to Steve about reminders.
Output one JSON object with keys:
- intent: "schedule" if the user wants Steve to remind them of something at a time; "not_reminder" for anything else (chat, questions, cancel handled elsewhere).
- subject: short task text in the user's language (what to remember), or null if unknown.
- time_phrase: the date/time part only, exactly as the user expressed it (e.g. "demain 14h", "Tuesday 3pm", "in 2 hours"), or null if no time was given.

Rules:
- Do not invent times. If the user did not give a time, set time_phrase to null.
- subject should not include "remind me" boilerplate — only the task (e.g. "call my mom").
- Keep subject under 500 characters."""

_SYSTEM_DRAFT_CONTINUATION = """You are completing a pending reminder: Steve already asked the user WHAT to remind them about and is waiting for WHEN.

The field PENDING_TASK below is authoritative — the user already agreed to that task.

Output one JSON object with keys:
- intent: "schedule" if the user is supplying a time/date (or clarifying when), OR is still scheduling this reminder. Use "not_reminder" ONLY if they clearly changed topic and are not answering the time question.
- subject: the task to remember. If the latest message is ONLY a time or date, set subject to null (the task is PENDING_TASK). Otherwise you may refine the task from the latest message.
- time_phrase: the date/time part from the LATEST message only (e.g. "11am", "tomorrow 9", "in 20 minutes"), or null if the latest message has no time.

Rules:
- If the latest message looks like only a clock time, short time, or relative time ("11am", "3pm", "14h30", "in 1 hour"), intent MUST be "schedule" and time_phrase MUST capture that text.
- Do not invent times not present in the latest message.
- Keep subject under 500 characters."""


def _clean_str(val: object, cap: int) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    s = re.sub(r"\s+", " ", s)
    if len(s) > cap:
        s = s[: cap - 1].rstrip() + "…"
    return s


def extract_reminder_slots_llm(
    *,
    username: str,
    user_message: str,
    tz_label: str,
    current_utc_hint: str,
    draft_subject: Optional[str] = None,
) -> Optional[ReminderSlots]:
    """Calls Grok for structured extraction. Returns None only if API is unavailable."""
    if not XAI_API_KEY:
        return None

    trimmed = (user_message or "").strip()
    if not trimmed:
        return None

    system = _SYSTEM_DRAFT_CONTINUATION if (draft_subject or "").strip() else _SYSTEM_FRESH

    if (draft_subject or "").strip():
        user_prompt = (
            f"User timezone setting: {tz_label}\n"
            f"Current reference time (UTC): {current_utc_hint}\n\n"
            f"PENDING_TASK:\n{(draft_subject or '').strip()}\n\n"
            f"LATEST_MESSAGE:\n{trimmed}\n"
        )
    else:
        user_prompt = (
            f"User timezone setting: {tz_label}\n"
            f"Current reference time (UTC): {current_utc_hint}\n\n"
            f"Message:\n{trimmed}\n"
        )

    try:
        raw = generate_json(system, user_prompt, max_tokens=400, temperature=0.05)
    except Exception as exc:
        logger.warning("Reminder slots LLM failed: %s", exc)
        return None

    try:
        from backend.services import ai_usage

        ai_usage.log_usage(
            username.strip(),
            surface=ai_usage.SURFACE_DM,
            request_type="steve_reminder_slots",
            model="grok-json",
        )
    except Exception:
        pass

    intent_raw = str(raw.get("intent") or "").strip().lower()
    if intent_raw == "schedule":
        intent: ReminderSlotIntent = "schedule"
    else:
        intent = "not_reminder"

    subj = _clean_str(raw.get("subject"), _MAX_SUBJECT)
    tph = _clean_str(raw.get("time_phrase"), _MAX_PHRASE)

    return ReminderSlots(intent=intent, subject=subj, time_phrase=tph)


def merged_text_for_datetime_parse(subject: Optional[str], time_phrase: Optional[str]) -> str:
    """Combine subject + time for dateparser."""
    parts = []
    if subject:
        parts.append(subject)
    if time_phrase:
        parts.append(time_phrase)
    return " ".join(parts).strip()
