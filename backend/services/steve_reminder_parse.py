"""Deterministic parsing for Steve Reminder Vault (regex openers + dateparser + normalization).

LLM-assisted extraction lives in :mod:`backend.services.steve_reminder_slots`.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import List, Match, Optional, Pattern, Tuple
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

# Last ``in N minutes/hours`` clause wins (dateparser often misses long reminder tails).
_RE_RELATIVE_IN = re.compile(
    r"\bin\s+(\d+)\s*(minute|minutes|mins|min|hours?|hrs?|hr|h)\b",
    re.I,
)


def _timedelta_from_in_unit(amount: int, unit_raw: str) -> Optional[timedelta]:
    u = unit_raw.lower()
    # ``minute`` prefixes ``minutes``.
    if u.startswith("minute") or u in ("mins", "min"):
        return timedelta(minutes=amount)
    if u.startswith("hour") or u in ("hrs", "hr", "h"):
        return timedelta(hours=amount)
    return None


def _try_parse_relative_in_delta(raw: str, tz_name: str) -> Tuple[Optional[datetime], Optional[str]]:
    """Parse ``in N minutes/hours`` using the user's timezone for *now*, last match wins."""
    txt = (raw or "").strip()
    if not txt:
        return None, None
    ms = list(_RE_RELATIVE_IN.finditer(txt))
    if not ms:
        return None, None
    m = ms[-1]
    try:
        n = int(m.group(1))
    except (TypeError, ValueError):
        return None, None
    # Sane bounds — avoid overflows and jokes like "in 999999 minutes".
    if n <= 0 or n > 8760:
        return None, None
    td = _timedelta_from_in_unit(n, (m.group(2) or ""))
    if td is None or td.total_seconds() <= 0:
        return None, None

    tz_label_eff = (((tz_name or "") or "UTC").strip() or "UTC")
    local_tz = timezone.utc
    try:
        local_tz = ZoneInfo(tz_label_eff)
    except Exception:
        tz_label_eff = "UTC"
        local_tz = timezone.utc

    try:
        now_local = datetime.now(local_tz)
        fire_local = now_local + td
        fire_utc = fire_local.astimezone(timezone.utc).replace(tzinfo=None)
        city = (
            tz_label_eff.split("/")[-1].replace("_", " ") if "/" in tz_label_eff else tz_label_eff
        )
        when_face = f"{fire_local.strftime('%a %d %b %Y, %H:%M')} ({city} time)"
        return fire_utc, when_face
    except Exception as exc:
        logger.warning("Reminder relative delta parse failed (%s): %s", tz_name, exc)
        return None, None

# Openers longest-first — "remind me to" must beat bare "remind me".
# Optional "Steve," / "@Steve" — callers often strip leading @Steve, leaving "remind me…" only.
_RE_CREATE: Pattern[str] = re.compile(
    r"^\s*(?:(?:@\s*)?steve,?\s*)?"
    r"(?P<opener>"
    r"remind\s+me\s+to\s+|"
    r"remind\s+me\s+that\s+|"
    r"remind\s+me\s+call\s+|"
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


def parse_cancel_reminder_ids(line: str) -> Optional[List[int]]:
    """Parse one or more vault reminder ids from a cancel/delete/remove message.

    Handles **cancel reminder #1 and #2**, **cancel reminders #1, #2**, and the legacy
    single-line form **cancel reminder 5** (no hash).
    """
    s = (line or "").strip()
    if not s:
        return None
    # Must look like a cancel instruction (not just the word "cancel" elsewhere).
    if not (
        re.match(r"^\s*(cancel|delete|remove)\b", s, re.I)
        or re.search(r"\b(cancel|delete|remove)\s+reminders?\b", s, re.I)
    ):
        return None
    hash_ids = [int(x) for x in re.findall(r"#(\d+)", s)]
    if hash_ids:
        return sorted(set(hash_ids))
    m_one = RE_REMINDER_CANCEL.match(s)
    if m_one:
        return [int(m_one.group(2))]
    return None

_RE_STEVE_PREFIX = re.compile(r"^\s*steve\b", re.I)
_RE_AT_STEVE = re.compile(r"@\s*steve\b", re.I)

# Broad hint for hybrid path (avoid LLM on every DM line).
_REMINDER_PLAUSIBLE = re.compile(
    r"(^|\b)("
    r"remind|reminder|rappel|recordatorio|recuerda|lembr|"
    r"nudge|ping|schedule|program|programme|progamme|fixe|agenda|"
    r"don't\s+forget|dont\s+forget|remember\s+that|"
    r"need\s+(you\s+to\s+)?remind|want\s+(you\s+to\s+)?remind|"
    r"(can|could)\s+(you\s+)?(please\s+)?(remind|ping|nudge)|"
    r"would\s+you\s+remind|remind\s+to\b"
    r")\w*",
    re.I | re.X,
)

# Short follow-up lines that usually mean “the time only” during a vault draft (11am, 11:25, 14h30…).
_TIME_ONLY_LIKE = re.compile(
    r"^\s*("
    r"\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)\b|"
    r"\d{1,2}:\d{2}(?::\d{2})?\s*$|"
    r"\d{1,2}\s*h\s*\d{2}(?:\s*(am|pm|a\.m\.|p\.m\.))?\b|"
    r"(noon|midnight)\b|"
    r"in\s+\d+\s*(min|minute|minutes|hour|hours|hr|h)\b"
    r")\s*[.!?]?$",
    re.I | re.S,
)


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


def expand_colloquial_datetime_phrases(text: str) -> str:
    """Expand compact English relative/time shorthands so dateparser finds a fire time."""
    s = (text or "").strip()
    if not s:
        return s
    # "in 2h", "in 1h30" → hours language dateparser prefers
    s = re.sub(r"\bin\s+(\d+)\s*h\b", r"in \1 hours", s, flags=re.I)
    s = re.sub(r"\bin\s+(\d+)\s*m\b", r"in \1 minutes", s, flags=re.I)
    s = re.sub(r"\bin\s+(\d+)\s*min\b", r"in \1 minutes", s, flags=re.I)
    return s


def extract_subject(reminder_strip: str) -> str:
    """Heuristic subject before trailing time/date (`` at `` / `` on `` / `` in `` delta)."""
    t = reminder_strip.strip()
    low = t.lower()
    for marker in (" on ", " at ", " in "):
        idx = low.rfind(marker)
        if idx > 8:
            maybe = t[:idx].strip()
            if len(maybe) >= 4:
                return maybe
    return t


def try_parse_fire_datetime(text_after_trigger: str, tz_name: str) -> Tuple[Optional[datetime], Optional[str]]:
    """Parse a reminder fire time using dateparser (+ light fallbacks).

    Approximate weekday/tomorrow semantics use naive UTC noon math for the fallback lane only;
    dateparser is preferred when it finds explicit dates/times relative to user's timezone."""
    normalized = expand_colloquial_datetime_phrases(
        normalize_time_phrases_for_parse(text_after_trigger)
    )
    raw = normalized.strip()
    if not raw:
        return None, None
    try:
        from dateparser.search import search_dates

        tz = tz_name or "UTC"
        dp_out = search_dates(
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
            city = tz.split("/")[-1].replace("_", " ") if "/" in tz else tz
            when_face = f"{fmt} ({city} time)"
            return fire_utc, when_face
    except Exception as exc:
        logger.warning("Reminder dateparser failed (%s): %s", tz_name, exc)

    rel_dt, rel_face = _try_parse_relative_in_delta(raw, (tz_name or "UTC"))
    if rel_dt is not None:
        return rel_dt, rel_face

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


def draft_followup_composite_texts(draft_subject: str, user_line: str) -> List[str]:
    """Build strings to parse when the user replies with a time or date after saving a vault draft."""
    d = (draft_subject or "").strip()
    u = (user_line or "").strip()
    if not d or not u:
        return []
    return [
        f"{d}\n{u}",
        f"{d} at {u}",
        f"{d} {u}",
    ]


def looks_like_time_only_followup(message: str) -> bool:
    """True when the line is likely **only** a clock / relative delta (during draft completion)."""
    s = (message or "").strip()
    if not s or len(s) > 96:
        return False
    return bool(_TIME_ONLY_LIKE.match(s))


def try_parse_fire_datetime_first_candidate(
    texts: List[str],
    tz_name: str,
) -> Tuple[Optional[datetime], Optional[str]]:
    """Return the first successful parse among candidate strings (order preserved)."""
    for text in texts:
        if not (text or "").strip():
            continue
        dt, face = try_parse_fire_datetime(text, tz_name)
        if dt is not None:
            return dt, face
    return None, None
