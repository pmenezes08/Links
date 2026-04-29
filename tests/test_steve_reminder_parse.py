"""Pure tests for Reminder Vault deterministic parsing (:mod:`backend.services.steve_reminder_parse`)."""

from __future__ import annotations

import pytest

from backend.services.steve_reminder_parse import (
    normalize_time_phrases_for_parse,
    match_create_opener,
    reminder_intent_llm_plausible,
    try_parse_fire_datetime,
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
