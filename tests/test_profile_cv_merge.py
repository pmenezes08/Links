"""Unit tests for CV merge helper (promote previous role, dedupe)."""

from __future__ import annotations

import json

from backend.services.profile_cv_merge import merge_work_history_for_cv, month_before_yyyy_mm
from backend.services.profile_structured_fields import parse_work_history_for_storage


def test_month_before_yyyy_mm() -> None:
    assert month_before_yyyy_mm("2024-03") == "2024-02"
    assert month_before_yyyy_mm("2024-01") == "2023-12"


def test_merge_empty_db_matches_replace_parse() -> None:
    raw = [
        {
            "title": "Engineer",
            "company": "OldCorp",
            "location": "",
            "start": "2020-01",
            "end": "2023-06",
            "description": "",
        }
    ]
    _, expected_list = parse_work_history_for_storage(json.dumps(raw))
    _, merged_list = merge_work_history_for_cv(
        db_role="",
        db_company="",
        db_start_ym="",
        db_history_items=[],
        parsed_role="Lead",
        parsed_company="NewCo",
        parsed_start_ym="2024-01",
        parsed_cv_work_history=raw,
    )
    assert merged_list == expected_list


def test_merge_promotes_when_current_role_changes() -> None:
    cv_prior = [
        {
            "title": "Intern",
            "company": "School",
            "location": "",
            "start": "2018-01",
            "end": "2019-05",
            "description": "",
        }
    ]
    _, rows = merge_work_history_for_cv(
        db_role="Product Manager",
        db_company="Acme Inc",
        db_start_ym="2020-03",
        db_history_items=[],
        parsed_role="Director",
        parsed_company="Globex",
        parsed_start_ym="2024-06",
        parsed_cv_work_history=cv_prior,
    )
    assert len(rows) >= 2
    assert rows[0]["title"] == "Product Manager"
    assert rows[0]["company"] == "Acme Inc"
    assert rows[0]["start"] == "2020-03"
    assert rows[0]["end"] == "2024-05"
    assert rows[-1]["title"] == "Intern"


def test_merge_no_promote_when_same_role_and_company() -> None:
    cv_prior = [
        {
            "title": "Prior",
            "company": "OldPlace",
            "location": "",
            "start": "2015-01",
            "end": "2019-12",
            "description": "",
        }
    ]
    _, rows = merge_work_history_for_cv(
        db_role="PM",
        db_company="Acme",
        db_start_ym="2020-01",
        db_history_items=[],
        parsed_role="PM",
        parsed_company="Acme",
        parsed_start_ym="2024-06",
        parsed_cv_work_history=cv_prior,
    )
    assert not any(r.get("title") == "PM" and r.get("company") == "Acme" and r.get("end") == "2024-05" for r in rows)
    titles = [r["title"] for r in rows]
    assert titles[0] == "Prior"


def test_merge_dedupes_by_title_and_company() -> None:
    db_hist = [
        {"title": "Engineer", "company": "DupCo", "start": "2019-01", "end": "2020-01", "location": "", "description": ""}
    ]
    cv_prior = [
        {"title": "Engineer", "company": "DupCo", "start": "2018-01", "end": "2019-01", "location": "", "description": ""},
        {"title": "Other", "company": "Else", "start": "2020-02", "end": "", "location": "", "description": ""},
    ]
    _, rows = merge_work_history_for_cv(
        db_role="PM",
        db_company="Acme",
        db_start_ym="2021-01",
        db_history_items=db_hist,
        parsed_role="PM",
        parsed_company="Acme",
        parsed_start_ym="2021-01",
        parsed_cv_work_history=cv_prior,
    )
    keys = [(r["title"].lower(), r["company"].lower()) for r in rows]
    assert len(keys) == len(set(keys))
    assert sum(1 for k in keys if k == ("engineer", "dupco")) == 1

