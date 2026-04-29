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


_SYSTEM = """You classify a single direct message to Steve about reminders.
Output one JSON object with keys:
- intent: "schedule" if the user wants Steve to remind them of something at a time; "not_reminder" for anything else (chat, questions, cancel handled elsewhere).
- subject: short task text in the user's language (what to remember), or null if unknown.
- time_phrase: the date/time part only, exactly as the user expressed it (e.g. "demain 14h", "Tuesday 3pm", "in 2 hours"), or null if no time was given.

Rules:
- Do not invent times. If the user did not give a time, set time_phrase to null.
- subject should not include "remind me" boilerplate — only the task (e.g. "call my mom").
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
) -> Optional[ReminderSlots]:
    """Calls Grok for structured extraction. Returns None only if API is unavailable."""
    if not XAI_API_KEY:
        return None

    trimmed = (user_message or "").strip()
    if not trimmed:
        return None

    user_prompt = (
        f"User timezone setting: {tz_label}\n"
        f"Current reference time (UTC): {current_utc_hint}\n\n"
        f"Message:\n{trimmed}\n"
    )

    try:
        raw = generate_json(_SYSTEM, user_prompt, max_tokens=400, temperature=0.05)
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
