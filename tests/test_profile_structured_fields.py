"""Unit tests for ``backend.services.profile_structured_fields`` (pure, no DB)."""

from __future__ import annotations

import json

import pytest

from backend.services.profile_structured_fields import (
    MAX_EDUCATION_ENTRIES,
    MAX_WORK_ENTRIES,
    decode_personal_highlights_for_api,
    normalize_personal_highlights_payload,
    normalize_yyyy_mm,
    parse_education_for_storage,
    parse_work_history_for_storage,
)


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("2024-06", "2024-06"),
        ("2024-1", ""),
        ("2024-13", ""),
        ("", ""),
        (None, ""),
    ],
)
def test_normalize_yyyy_mm(raw, expected):
    assert normalize_yyyy_mm(raw) == expected


def test_parse_work_history_drops_end_before_start():
    blob, items = parse_work_history_for_storage(
        json.dumps([{"title": "T", "company": "C", "start": "2023-06", "end": "2022-01"}])
    )
    assert items[0]["start"] == "2023-06"
    assert items[0]["end"] == ""
    round_trip, _ = parse_work_history_for_storage(blob)
    assert round_trip == blob


def test_parse_work_history_caps():
    rows = [{"title": f"x{i}", "company": "c"} for i in range(MAX_WORK_ENTRIES + 5)]
    _, items = parse_work_history_for_storage(json.dumps(rows))
    assert len(items) == MAX_WORK_ENTRIES


def test_parse_work_history_invalid_json():
    blob, items = parse_work_history_for_storage("not json")
    assert items == []
    assert blob == "[]"


def test_parse_education_caps():
    rows = [{"school": f"s{i}"} for i in range(MAX_EDUCATION_ENTRIES + 3)]
    _, items = parse_education_for_storage(json.dumps(rows))
    assert len(items) == MAX_EDUCATION_ENTRIES


def test_normalize_personal_highlights_payload_roundtrip_keys():
    raw = normalize_personal_highlights_payload("a", "b", "c")
    data = json.loads(raw)
    assert set(data.keys()) == {"five_minutes", "outside_work", "cpoint_goals"}
    assert data["five_minutes"] == "a"


def test_decode_personal_highlights_stable_order_and_labels():
    raw = normalize_personal_highlights_payload("x", "", "y")
    api = decode_personal_highlights_for_api(raw)
    ids = [row["id"] for row in api]
    assert ids == ["five_minutes", "outside_work", "cpoint_goals"]
    assert api[0]["answer"] == "x"
    assert "five minutes" in api[0]["question"].lower()
    assert api[1]["answer"] == ""
    assert api[2]["answer"] == "y"


def test_decode_personal_highlights_empty_blob():
    api = decode_personal_highlights_for_api(None)
    assert len(api) == 3
    assert all(not row["answer"] for row in api)
