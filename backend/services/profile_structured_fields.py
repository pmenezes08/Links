"""Validate and normalize structured profile fields (professional history, education, personal highlights)."""

from __future__ import annotations

import json
import re
from typing import Any

MAX_WORK_ENTRIES = 20
MAX_EDUCATION_ENTRIES = 10
MAX_ENTRY_DESCRIPTION_LEN = 4000
MAX_TITLE_LEN = 200
MAX_COMPANY_LEN = 200
MAX_SCHOOL_LEN = 200
MAX_DEGREE_LEN = 200
MAX_LOCATION_LEN = 200
MAX_PERSONAL_HIGHLIGHT_LEN = 5000

_YM = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

# Stable ids for the three personal questions (UI labels live on client / API assembly).
PERSONAL_HIGHLIGHT_FIVE_MINUTES = "five_minutes"
PERSONAL_HIGHLIGHT_OUTSIDE_WORK = "outside_work"
PERSONAL_HIGHLIGHT_CPOINT = "cpoint_goals"

PERSONAL_HIGHLIGHT_ORDER = (
    PERSONAL_HIGHLIGHT_FIVE_MINUTES,
    PERSONAL_HIGHLIGHT_OUTSIDE_WORK,
    PERSONAL_HIGHLIGHT_CPOINT,
)

PERSONAL_QUESTION_LABELS: dict[str, str] = {
    PERSONAL_HIGHLIGHT_FIVE_MINUTES: "If we only had five minutes, what should I ask you about?",
    PERSONAL_HIGHLIGHT_OUTSIDE_WORK: "Outside of work, where do we most likely find you?",
    PERSONAL_HIGHLIGHT_CPOINT: "What are you hoping to get from C-Point?",
}


def _clip(s: str, n: int) -> str:
    t = (s or "").strip()
    return t[:n] if len(t) > n else t


def normalize_yyyy_mm(raw: str | None) -> str:
    if not raw or not isinstance(raw, str):
        return ""
    s = raw.strip()
    return s if _YM.match(s) else ""


def _normalize_work_item(obj: Any) -> dict[str, str] | None:
    if not isinstance(obj, dict):
        return None
    title = _clip(str(obj.get("title") or ""), MAX_TITLE_LEN)
    company = _clip(str(obj.get("company") or ""), MAX_COMPANY_LEN)
    location = _clip(str(obj.get("location") or ""), MAX_LOCATION_LEN)
    desc = _clip(str(obj.get("description") or ""), MAX_ENTRY_DESCRIPTION_LEN)
    start = normalize_yyyy_mm(str(obj.get("start") or ""))
    end = normalize_yyyy_mm(str(obj.get("end") or ""))
    if not title and not company and not desc and not start and not end and not location:
        return None
    if end and start and end < start:
        end = ""
    return {
        "title": title,
        "company": company,
        "location": location,
        "start": start,
        "end": end,
        "description": desc,
    }


def _normalize_edu_item(obj: Any) -> dict[str, str] | None:
    if not isinstance(obj, dict):
        return None
    school = _clip(str(obj.get("school") or ""), MAX_SCHOOL_LEN)
    degree = _clip(str(obj.get("degree") or ""), MAX_DEGREE_LEN)
    desc = _clip(str(obj.get("description") or ""), MAX_ENTRY_DESCRIPTION_LEN)
    start = normalize_yyyy_mm(str(obj.get("start") or ""))
    end = normalize_yyyy_mm(str(obj.get("end") or ""))
    if not school and not degree and not desc and not start and not end:
        return None
    if end and start and end < start:
        end = ""
    return {
        "school": school,
        "degree": degree,
        "start": start,
        "end": end,
        "description": desc,
    }


def parse_work_history_for_storage(raw: str | None) -> tuple[str, list[dict[str, str]]]:
    if not raw or not str(raw).strip():
        return "[]", []
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return "[]", []
    if not isinstance(data, list):
        return "[]", []
    out: list[dict[str, str]] = []
    for item in data[:MAX_WORK_ENTRIES]:
        norm = _normalize_work_item(item)
        if norm:
            out.append(norm)
    return json.dumps(out, ensure_ascii=False), out


def parse_education_for_storage(raw: str | None) -> tuple[str, list[dict[str, str]]]:
    if not raw or not str(raw).strip():
        return "[]", []
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return "[]", []
    if not isinstance(data, list):
        return "[]", []
    out: list[dict[str, str]] = []
    for item in data[:MAX_EDUCATION_ENTRIES]:
        norm = _normalize_edu_item(item)
        if norm:
            out.append(norm)
    return json.dumps(out, ensure_ascii=False), out


def decode_work_history_db(raw: Any) -> list[dict[str, str]]:
    _, items = parse_work_history_for_storage(str(raw) if raw is not None else "")
    return items


def decode_education_db(raw: Any) -> list[dict[str, str]]:
    _, items = parse_education_for_storage(str(raw) if raw is not None else "")
    return items


def normalize_personal_highlights_payload(
    five_minutes: str | None,
    outside_work: str | None,
    cpoint_goals: str | None,
) -> str:
    obj = {
        PERSONAL_HIGHLIGHT_FIVE_MINUTES: _clip(str(five_minutes or ""), MAX_PERSONAL_HIGHLIGHT_LEN),
        PERSONAL_HIGHLIGHT_OUTSIDE_WORK: _clip(str(outside_work or ""), MAX_PERSONAL_HIGHLIGHT_LEN),
        PERSONAL_HIGHLIGHT_CPOINT: _clip(str(cpoint_goals or ""), MAX_PERSONAL_HIGHLIGHT_LEN),
    }
    return json.dumps(obj, ensure_ascii=False)


def decode_personal_highlights_for_api(raw: Any) -> list[dict[str, str]]:
    """Return [{id, question, answer}, ...] in stable order."""
    out: list[dict[str, str]] = []
    data: dict[str, Any] = {}
    if raw:
        try:
            parsed = json.loads(str(raw))
            if isinstance(parsed, dict):
                data = parsed
        except (json.JSONDecodeError, TypeError):
            data = {}
    for key in PERSONAL_HIGHLIGHT_ORDER:
        ans = data.get(key)
        text = _clip(str(ans) if ans is not None else "", MAX_PERSONAL_HIGHLIGHT_LEN)
        out.append(
            {
                "id": key,
                "question": PERSONAL_QUESTION_LABELS.get(key, key),
                "answer": text,
            }
        )
    return out