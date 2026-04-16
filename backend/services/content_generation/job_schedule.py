"""Schedule helpers for content generation jobs (timezone-aware first run, RRULE, end date)."""

from __future__ import annotations

import calendar
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore
    ZoneInfoNotFoundError = Exception  # type: ignore


UTC = timezone.utc

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$")

RRULE_WEEKDAY = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def utc_now_naive() -> datetime:
    return datetime.utcnow().replace(microsecond=0)


def format_utc_naive(dt: datetime) -> str:
    """Store as naive UTC string matching storage._utc_now_str()."""
    return dt.replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")


def parse_utc_naive(s: Optional[str]) -> Optional[datetime]:
    if not s or not str(s).strip():
        return None
    raw = str(s).strip()
    if raw.endswith("Z"):
        raw = raw[:-1]
    raw = raw.replace("T", " ")
    try:
        return datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def add_months_calendar(d: date, months: int) -> date:
    m0 = d.month - 1 + months
    y = d.year + m0 // 12
    m = m0 % 12 + 1
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, last))


def parse_local_date(s: Any) -> Optional[date]:
    if s is None:
        return None
    text = str(s).strip()
    if not text or not _DATE_RE.match(text):
        return None
    try:
        y, m, d = (int(x) for x in text.split("-"))
        return date(y, m, d)
    except ValueError:
        return None


def parse_time_of_day(s: Any) -> Tuple[int, int]:
    text = str(s or "09:00").strip()
    m = _TIME_RE.match(text)
    if not m:
        return 9, 0
    h = max(0, min(23, int(m.group(1))))
    minute = max(0, min(59, int(m.group(2))))
    return h, minute


def normalize_cadence(raw: Any) -> str:
    c = str(raw or "weekly").strip().lower().replace("-", "")
    if c == "biweekly":
        return "biweekly"
    if c == "beweekly":  # typo guard
        return "biweekly"
    if c == "monthly":
        return "monthly"
    return "weekly"


def normalize_schedule(schedule: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not schedule:
        return {}
    out = dict(schedule)
    out["cadence"] = normalize_cadence(out.get("cadence"))
    wd = str(out.get("weekday") or "FR").strip().upper()
    out["weekday"] = wd if wd in RRULE_WEEKDAY else "FR"
    out["week_of_month"] = str(out.get("week_of_month") or "1").strip() or "1"
    out["time_of_day"] = str(out.get("time_of_day") or "09:00").strip() or "09:00"
    if "starting_date" in out and out["starting_date"] is not None:
        sd = str(out["starting_date"]).strip()
        out["starting_date"] = sd if _DATE_RE.match(sd) else ""
    else:
        out["starting_date"] = ""
    if "end_date" in out and out["end_date"] is not None:
        ed = str(out["end_date"]).strip()
        out["end_date"] = ed if _DATE_RE.match(ed) else ""
    else:
        out["end_date"] = ""
    return out


def resolve_zone(tz_name: Optional[str]) -> ZoneInfo:
    if ZoneInfo is None:
        raise ValueError("zoneinfo is required")
    name = (tz_name or "UTC").strip() or "UTC"
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"Unknown timezone: {name}") from exc


def nth_weekday_of_month(year: int, month: int, weekday_mo: str, n: int) -> Optional[date]:
    w = RRULE_WEEKDAY.get(weekday_mo.upper(), 0)
    seen = 0
    for day in range(1, 32):
        try:
            d = date(year, month, day)
        except ValueError:
            break
        if d.weekday() == w:
            seen += 1
            if seen == n:
                return d
    return None


def monthly_local_datetime(
    year: int,
    month: int,
    weekday_mo: str,
    week_of_month: int,
    t: time,
    tz: ZoneInfo,
) -> Optional[datetime]:
    occ = nth_weekday_of_month(year, month, weekday_mo, week_of_month)
    if not occ:
        return None
    return datetime.combine(occ, t, tzinfo=tz)


def next_monthly_occurrence(
    start_local: datetime,
    weekday_mo: str,
    week_of_month: int,
    t: time,
    tz: ZoneInfo,
    now_local: datetime,
) -> datetime:
    y, m = start_local.year, start_local.month
    for _ in range(0, 48):
        cand = monthly_local_datetime(y, m, weekday_mo, week_of_month, t, tz)
        if cand and cand >= now_local:
            return cand
        if m == 12:
            y += 1
            m = 1
        else:
            m += 1
    return start_local + timedelta(days=30)


def next_matching_weekday_local(
    min_date: date,
    weekday_mo: str,
    t: time,
    tz: ZoneInfo,
    now_local: datetime,
) -> datetime:
    w_target = RRULE_WEEKDAY.get(weekday_mo.upper(), 0)
    start_scan = max(min_date, now_local.date())
    for add in range(0, 400):
        d = start_scan + timedelta(days=add)
        if d.weekday() != w_target:
            continue
        cand = datetime.combine(d, t, tzinfo=tz)
        if cand >= now_local:
            return cand
    return datetime.combine(start_scan, t, tzinfo=tz)


def first_run_local(schedule: Dict[str, Any], tz: ZoneInfo, now_local: datetime) -> datetime:
    sched = normalize_schedule(schedule)
    cadence = sched["cadence"]
    h, minute = parse_time_of_day(sched["time_of_day"])
    t = time(h, minute, 0)
    weekday = sched["weekday"]
    week_of_month = int(str(sched["week_of_month"] or "1") or "1")
    week_of_month = max(1, min(4, week_of_month))

    start_d = parse_local_date(sched.get("starting_date"))
    today = now_local.date()
    min_date = start_d or today

    if cadence == "monthly":
        y, m = min_date.year, min_date.month
        cand = monthly_local_datetime(y, m, weekday, week_of_month, t, tz)
        if cand is None:
            cand = next_monthly_occurrence(
                datetime.combine(min_date, t, tzinfo=tz),
                weekday,
                week_of_month,
                t,
                tz,
                now_local,
            )
        if cand < now_local:
            cand = next_monthly_occurrence(cand, weekday, week_of_month, t, tz, now_local)
        return cand

    return next_matching_weekday_local(min_date, weekday, t, tz, now_local)


def build_rrule(schedule: Optional[Dict[str, Any]]) -> Optional[str]:
    if not schedule:
        return None
    sched = normalize_schedule(schedule)
    cadence = sched["cadence"]
    weekday = sched["weekday"]
    week_of_month = str(sched["week_of_month"] or "").strip()
    if cadence == "weekly" and weekday:
        return f"FREQ=WEEKLY;BYDAY={weekday}"
    if cadence == "biweekly" and weekday:
        return f"FREQ=WEEKLY;INTERVAL=2;BYDAY={weekday}"
    if cadence == "monthly" and weekday and week_of_month:
        return f"FREQ=MONTHLY;BYDAY={weekday};BYSETPOS={week_of_month}"
    return None


def end_of_local_day_utc(d: date, tz: ZoneInfo) -> datetime:
    local_end = datetime.combine(d, time(23, 59, 59), tzinfo=tz)
    return local_end.astimezone(UTC).replace(tzinfo=None)


def compute_ends_at_utc(schedule: Dict[str, Any], tz: ZoneInfo, anchor_date: date) -> datetime:
    sched = normalize_schedule(schedule)
    end_d = parse_local_date(sched.get("end_date"))
    if end_d:
        return end_of_local_day_utc(end_d, tz)
    end_anchor = add_months_calendar(anchor_date, 6)
    return end_of_local_day_utc(end_anchor, tz)


def compute_schedule_timestamps(
    schedule: Optional[Dict[str, Any]],
    timezone_name: Optional[str],
    *,
    reference_utc: Optional[datetime] = None,
) -> Tuple[Dict[str, Any], Optional[str], str, Optional[str]]:
    """
    Returns (normalized_schedule, rrule, next_run_at_utc_str, ends_at_utc_str).
    """
    sched_in = normalize_schedule(schedule or {})
    tz = resolve_zone(timezone_name)
    now_local = datetime.now(tz)
    now_utc = utc_now_naive()
    ref = reference_utc or now_utc

    first_local = first_run_local(sched_in, tz, now_local)
    next_run_utc = first_local.astimezone(UTC).replace(tzinfo=None)

    start_anchor = parse_local_date(sched_in.get("starting_date")) or first_local.date()
    ends_at_utc = compute_ends_at_utc(sched_in, tz, start_anchor)

    if ends_at_utc < ref:
        raise ValueError("End date is in the past; choose a later end date or leave it empty for the default.")

    if next_run_utc > ends_at_utc:
        raise ValueError("Schedule end is before the first run; extend the end date or adjust the schedule.")

    rrule = build_rrule(sched_in)
    return sched_in, rrule, format_utc_naive(next_run_utc), format_utc_naive(ends_at_utc)


def next_run_after(
    previous_next_run_utc: Optional[str],
    cadence: str,
) -> datetime:
    base = parse_utc_naive(previous_next_run_utc) or utc_now_naive()
    c = normalize_cadence(cadence)
    if c == "weekly":
        return base + timedelta(days=7)
    if c == "biweekly":
        return base + timedelta(days=14)
    if c == "monthly":
        d = base.date()
        nd = add_months_calendar(d, 1)
        return datetime.combine(nd, base.time())
    if c == "daily":
        return base + timedelta(days=1)
    return base + timedelta(days=7)
