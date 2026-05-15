"""Tests for onboarding CV normalization (no live LLM calls)."""

from __future__ import annotations

import json

from backend.services.onboarding_cv_import import normalize_llm_cv_payload


def test_normalize_llm_cv_payload_maps_current_and_prior():
    raw = {
        "current_role": "Staff Engineer",
        "current_company": "Acme Corp",
        "current_role_start_ym": "2022-03",
        "prior_roles": [
            {
                "title": "Engineer",
                "company": "Beta Ltd",
                "location": "Berlin",
                "start": "2019-01",
                "end": "2022-02",
                "description": "Backend systems",
            },
        ],
    }
    out = normalize_llm_cv_payload(raw)
    assert out["role"] == "Staff Engineer"
    assert out["company"] == "Acme Corp"
    assert out["current_role_start_ym"] == "2022-03"
    assert len(out["work_history"]) == 1
    assert out["work_history"][0]["company"] == "Beta Ltd"


def test_normalize_llm_cv_payload_dedupes_current_from_prior_list():
    raw = {
        "current_role": "PM",
        "current_company": "Mega",
        "current_role_start_ym": "bad-month",
        "prior_roles": [
            {"title": "PM", "company": "Mega", "start": "", "end": "", "location": "", "description": ""},
            {"title": "Analyst", "company": "OldCo", "start": "2018-06", "end": "2020-01", "location": "", "description": ""},
        ],
    }
    out = normalize_llm_cv_payload(raw)
    assert out["current_role_start_ym"] == ""
    assert len(out["work_history"]) == 1
    assert out["work_history"][0]["title"] == "Analyst"


def test_normalize_llm_cv_payload_prior_only():
    raw = {
        "current_role": "",
        "current_company": "",
        "current_role_start_ym": "",
        "prior_roles": [
            {
                "title": "Intern",
                "company": "Startup",
                "location": "",
                "start": "2021-06",
                "end": "2021-09",
                "description": "",
            },
        ],
    }
    out = normalize_llm_cv_payload(raw)
    assert out["role"] == ""
    assert out["company"] == ""
    assert len(out["work_history"]) == 1


def test_professional_work_history_json_is_valid_storage_blob():
    raw = {
        "current_role": "CFO",
        "current_company": "FinCo",
        "current_role_start_ym": "",
        "prior_roles": [],
    }
    out = normalize_llm_cv_payload(raw)
    blob = out["professional_work_history_json"]
    data = json.loads(blob)
    assert data == []


def test_normalize_llm_cv_payload_current_role_description():
    raw = {
        "current_role": "Analyst",
        "current_company": "Bank",
        "current_role_start_ym": "2024-01",
        "current_role_description": "Own credit risk models for SME lending across EU markets.",
        "prior_roles": [],
    }
    out = normalize_llm_cv_payload(raw)
    assert out["current_role_description"] == "Own credit risk models for SME lending across EU markets."


def test_normalize_import_alias_current_start():
    raw = {
        "current_role": "Designer",
        "current_company": "X",
        "current_start": "2020-11",
        "prior_roles": [],
    }
    out = normalize_llm_cv_payload(raw)
    assert out["current_role_start_ym"] == "2020-11"
