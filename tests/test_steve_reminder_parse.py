"""Pure tests for Reminder Vault deterministic parsing (:mod:`backend.services.steve_reminder_parse`)."""

from __future__ import annotations

import pytest

from backend.services.steve_reminder_parse import (
    draft_followup_composite_texts,
    expand_colloquial_datetime_phrases,
    extract_subject,
    looks_like_time_only_followup,
    match_create_opener,
    normalize_time_phrases_for_parse,
    reminder_intent_llm_plausible,
    try_parse_fire_datetime,
    try_parse_fire_datetime_first_candidate,
)


@pytest.mark.parametrize(
    "stripped,expected_tail",
    [
        (
            "remind me to call my mom at 3pm tomorrow",
            "call my mom at 3pm tomorrow",
        ),
        (
            "Remind me that the report is due Friday",
            "the report is due Friday",
        ),
        (
            "don't forget to water the plants at noon",
            "water the plants at noon",
        ),
        (
            "remember that I have a dentist next Tuesday",
            "I have a dentist next Tuesday",
        ),
    ],
)
def test_create_opener_tail_capture(stripped, expected_tail):
    m = match_create_opener(stripped)
    assert m is not None
    assert (m.group("tail") or "").strip() == expected_tail


def test_opener_longest_wins_remind_me_to():
    m = match_create_opener("remind me to call my mom at 2h14am")
    assert m is not None
    assert (m.group("tail") or "").strip() == "call my mom at 2h14am"


def test_normalize_french_hour_clock():
    assert "2:14 am" in normalize_time_phrases_for_parse("at 2h14am about X").lower()
    assert "14:30" in normalize_time_phrases_for_parse("demain 14h30")


def test_try_parse_handles_normalized_french_hour():
    raw = normalize_time_phrases_for_parse("call mom at 2h14 tomorrow")
    dt, face = try_parse_fire_datetime(raw, "Europe/Paris")
    assert dt is not None and face


def test_reminder_plausible_gates():
    assert reminder_intent_llm_plausible("Steve, dis-moi quelque chose", "@Steve hey") is True
    assert reminder_intent_llm_plausible("rappelle-moi demain", "rappelle-moi demain") is True
    assert reminder_intent_llm_plausible("how was your day?", "how was your day?") is False


def test_plausible_colloquial_need_you_to_remind():
    s = "Hm I need you to remind to call my mom in 1h"
    assert reminder_intent_llm_plausible(s, s) is True


def test_draft_followup_composite_texts_shape():
    parts = draft_followup_composite_texts("call my mom", "11am")
    assert len(parts) == 3
    assert "call my mom at 11am" in parts
    assert any("11am" in p for p in parts)


def test_opener_remind_me_call():
    m = match_create_opener("Steve, remind me call my mom at 11:30am")
    assert m is not None
    assert (m.group("tail") or "").strip() == "my mom at 11:30am"


def test_expand_in_hours_short():
    low = expand_colloquial_datetime_phrases("Call mom in 2h tonight").lower()
    assert "in 2 hours" in low


def test_extract_subject_splits_at_before_time():
    assert extract_subject("call my mom at 11:30am") == "call my mom"


@pytest.mark.parametrize(
    "line,expected",
    [
        ("11am", True),
        ("11:25", True),
        ("3:30 pm", True),
        ("14h30", True),
        ("in 2 hours", True),
        ("Could we talk about something else entirely?", False),
    ],
)
def test_looks_like_time_only_followup(line, expected):
    assert looks_like_time_only_followup(line) is expected


def test_try_parse_first_candidate_finds_time_in_composite():
    texts = draft_followup_composite_texts("call my mom", "tomorrow at 3pm")
    dt, face = try_parse_fire_datetime_first_candidate(texts, "UTC")
    assert dt is not None and face


def test_try_parse_when_face_uses_city_style_label():
    dt, face = try_parse_fire_datetime("in 5 minutes", "Europe/Dublin")
    assert dt is not None and face
    assert "(" in face and "time)" in face
    assert "Europe/Dublin" not in (face or "")


def test_format_reminder_wall_dublin_suffix():
    from datetime import datetime

    from backend.services.steve_reminder_vault import format_reminder_wall_time_naive_utc

    s = format_reminder_wall_time_naive_utc(datetime(2026, 6, 15, 14, 30, 0), "Europe/Dublin")
    assert "Dublin" in s and "time)" in s
