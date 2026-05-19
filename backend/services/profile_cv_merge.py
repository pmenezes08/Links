"""Merge parsed CV work history with existing DB state (promote old current role when it changes)."""

from __future__ import annotations

import json
from typing import Any

from backend.services.profile_structured_fields import (
    MAX_WORK_ENTRIES,
    normalize_yyyy_mm,
    parse_work_history_for_storage,
    _normalize_work_item,
)


def _role_company_key(title: str, company: str) -> tuple[str, str]:
    return (title.strip().lower(), company.strip().lower())


def month_before_yyyy_mm(ym: str) -> str:
    s = normalize_yyyy_mm(ym)
    if not s:
        return ""
    y_str, m_str = s.split("-", 1)
    y, m = int(y_str), int(m_str)
    if m <= 1:
        return f"{y - 1:04d}-12"
    return f"{y:04d}-{m - 1:02d}"


def merge_work_history_for_cv(
    *,
    db_role: str,
    db_company: str,
    db_start_ym: str,
    db_history_items: list[dict[str, str]],
    parsed_role: str,
    parsed_company: str,
    parsed_start_ym: str,
    parsed_cv_work_history: list[Any],
) -> tuple[str, list[dict[str, str]]]:
    """
    Build merged work history for ``mode=merge``:
    - If parsed (role, company) differs from DB current and DB had a current org/title, prepend a promoted row.
    - Then existing DB history, then CV prior roles.
    - Dedupe by (title_lower, company_lower), keep first occurrence.
    """
    dr = (db_role or "").strip()
    dc = (db_company or "").strip()
    pr = (parsed_role or "").strip()
    pc = (parsed_company or "").strip()
    cur_db = _role_company_key(dr, dc)
    cur_parsed = _role_company_key(pr, pc)

    promoted: dict[str, str] | None = None
    if cur_db != cur_parsed and (dr or dc):
        end_for_promoted = ""
        new_start = normalize_yyyy_mm(parsed_start_ym)
        if new_start:
            end_for_promoted = month_before_yyyy_mm(new_start)
        raw_promo = {
            "title": dr,
            "company": dc,
            "location": "",
            "start": normalize_yyyy_mm(db_start_ym),
            "end": end_for_promoted,
            "description": "",
        }
        norm_promo = _normalize_work_item(raw_promo)
        if norm_promo:
            promoted = norm_promo

    ordered: list[dict[str, str]] = []
    if promoted:
        ordered.append(promoted)

    for row in db_history_items:
        if isinstance(row, dict):
            norm = _normalize_work_item(row)
            if norm:
                ordered.append(norm)

    if isinstance(parsed_cv_work_history, list):
        for row in parsed_cv_work_history:
            norm = _normalize_work_item(row)
            if norm:
                ordered.append(norm)

    seen: set[tuple[str, str]] = set()
    deduped: list[dict[str, str]] = []
    for row in ordered:
        k = _role_company_key(row.get("title", ""), row.get("company", ""))
        if k in seen:
            continue
        if not k[0] and not k[1]:
            continue
        seen.add(k)
        deduped.append(row)
        if len(deduped) >= MAX_WORK_ENTRIES:
            break

    work_json, out_list = parse_work_history_for_storage(json.dumps(deduped, ensure_ascii=False))
    return work_json, out_list
