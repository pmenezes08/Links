"""Deterministic parsing for Steve Reminder Vault (regex openers + dateparser + normalization).

LLM-assisted extraction lives in :mod:`backend.services.steve_reminder_slots`.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Match, Optional, Pattern, Tuple

logger = logging.getLogger(__name__)

# Openers longest-first — "remind me to" must beat bare "remind me".
# Optional "Steve," / "@Steve" — callers often strip leading @Steve, leaving "remind me…" only.
_RE_CREATE: Pattern[str] = re.compile(
    r"^\s*(?:(?:@\s*)?steve,?\s*)?"
    r"(?P<opener>"
    r"remind\s+me\s+to\s+|"
    r"remind\s+me\s+that\s+|"
    r"don'?t\s+forget\s+(?:to\s+)?|"
    r"remember\s+that\s+|"
    r"remind\s+me\s+"
    r")"
    r"(?P<tail>.*)$",
    re.I | re.S,
)

RE_REMINDER_LIST = re.compile(
    r"^\s*(what are my reminders\b|show (my )?reminders\b|list (my )?reminders\b|my reminders\b)\s*[.!?]?\s*$",
    re.I,
)

RE_REMINDER_CANCEL = re.compile(
    r"^\s*(cancel|delete|remove)\s+(?:reminder\s*)?(?:#?\s*)?(\d+)\s*$",
    re.I,
)

# Broad hint for hybrid path (avoid LLM on every DM line).
_REMINDER_PLAUSIBLE = re.compile(
    r"(^|\b)(remind|reminder|rappel|recordatorio|recuerda|lembr"
    r"|nudge|ping|schedule|program|fixe|agenda)\w*",
    re.I,
)

_RE_STEVE_PREFIX = re.compile(r"^\s*steve\b", re.I)
_RE_AT_STEVE = re.compile(r"@\s*steve\b", re.I)

# e.g. 2h14, 2h14am, 14h30, 14h30pm
_RE_H_CLOCK = re.compile(
    r"\b(\d{1,2})\s*h\s*(\d{2})(?:\s*(am|pm|a\.m\.|p\.m\.))?\b",
    re.I,
)


def match_create_opener(stripped: str) -> Optional[Match[str]]:
    """If the line opens with @Steve + a known reminder phrase, return the match (use group ``tail``)."""
    return _RE_CREATE.match((stripped or "").strip())


def normalize_time_phrases_for_parse(text: str) -> str:
    """Rewrite French-style and compact clock forms so dateparser can see a time."""
    raw = (text or "").strip()
    if not raw:
        return raw

    def repl(m: Match[str]) -> str:
        h_s, mn, suf = m.group(1), m.group(2), (m.group(3) or "").strip().lower()
        try:
            h = int(h_s)
        except ValueError:
            return m.group(0)
        minute = mn.zfill(2)
        clock = f"{h}:{minute}"
        if suf in ("am", "a.m.", "a.m"):
            return f"{clock} am"
        if suf in ("pm", "p.m.", "p.m"):
            return f"{clock} pm"
        return clock

    return _RE_H_CLOCK.sub(repl, raw)


def extract_subject(reminder_strip: str) -> str:
    """Heuristic subject before trailing time/date (English-oriented `` at `` / `` on ``)."""
    t = reminder_strip.strip()
    low = t.lower()
    for marker in (" on ", " at "):
        idx = low.rfind(marker)
        if idx > 12:
            maybe = t[:idx].strip()
            if len(maybe) >= 8:
                return maybe
    return t


def try_parse_fire_datetime(text_after_trigger: str, tz_name: str) -> Tuple[Optional[datetime], Optional[str]]:
    """Parse a reminder fire time using dateparser (+ light fallbacks).

    Approximate weekday/tomorrow semantics use naive UTC noon math for the fallback lane only;
    dateparser is preferred when it finds explicit dates/times relative to user's timezone."""
    normalized = normalize_time_phrases_for_parse(text_after_trigger)
    raw = normalized.strip()
    if not raw:
        return None, None
    try:
        import dateparser  # type: ignore

        tz = tz_name or "UTC"
        dp_out = dateparser.search.search_dates(
            raw,
            settings={
                "TIMEZONE": tz,
                "RETURN_AS_TIMEZONE_AWARE": True,
                "PREFER_DATES_FROM": "future",
            },
            languages=["en", "es", "fr", "pt"],
        )
        if dp_out:
            parsed_local = dp_out[0][1]
            if parsed_local.tzinfo is None:
                parsed_local = parsed_local.replace(tzinfo=timezone.utc)
            fire_utc = parsed_local.astimezone(timezone.utc).replace(tzinfo=None)
            fmt = parsed_local.strftime("%a %d %b %Y, %H:%M")
            when_face = f"{fmt} ({tz})"
            return fire_utc, when_face
    except Exception as exc:
        logger.warning("Reminder dateparser failed (%s): %s", tz_name, exc)

    low = raw.lower()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    candidate: Optional[datetime] = None
    if "tomorrow" in low:
        base = datetime(now.year, now.month, now.day) + timedelta(days=1)
        candidate = base.replace(hour=9, minute=0, second=0)

    weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    for i, day in enumerate(weekdays):
        if day in low:
            target_dow = i
            days_ahead = (target_dow - now.weekday()) % 7
            if days_ahead == 0:
                days_ahead = 7
            base = datetime(now.year, now.month, now.day) + timedelta(days=days_ahead)
            candidate = base.replace(hour=9, minute=0, second=0)
            break

    if candidate:
        fmt = candidate.strftime("%a %d %b %Y, %H:%M")
        return candidate, f"{fmt} UTC (approximate — say a specific time if you need precision)"

    return None, None


def reminder_intent_llm_plausible(stripped_message: str, original_message: str) -> bool:
    """Cheap gate before invoking slot extraction."""
    raw = stripped_message.strip()
    if not raw:
        return False
    if _RE_STEVE_PREFIX.match(raw):
        return True
    if _RE_AT_STEVE.search(original_message or ""):
        return True
    if _REMINDER_PLAUSIBLE.search(raw):
        return True
    return False
