"""Mention hygiene for Steve networking replies (pure unit tests, no DB).

Covers ``backend.services.networking_mentions``: the duplicate-display-name
fix in ``inject_member_mentions`` (ambiguous names are never guessed), the
roster-handle sanitizer, and the log-only wrong-name detector that pairs a
member's full name against a different member's handle.
"""

from __future__ import annotations

from backend.services.networking_mentions import (
    extract_recommended_usernames,
    find_name_mismatches,
    inject_member_mentions,
    log_name_mismatches,
    sanitize_response_mentions,
)

ROSTER = [
    ("jh1987", "Jonas Hofmann"),
    ("mariq", "Maria Quartz"),
    ("mbravo", "Maria Quartz"),  # duplicate display name on purpose
    ("solo_x", "solo_x"),  # display name == username
]

IDENTITIES = [
    ("jh1987", "Jonas Hofmann", "Jonas Hofmann"),
    ("mariq", "Maria Quartz", "Maria Eduarda Quartz"),
    ("pdias", "Pedro Dias", "Pedro Dias"),
]


# ── inject_member_mentions ──────────────────────────────────────────────


def test_inject_maps_unique_display_name_to_handle():
    out = inject_member_mentions("Meet **Jonas Hofmann** today.", ROSTER)
    assert out == "Meet @jh1987 today."


def test_inject_maps_username_and_paren_patterns():
    assert inject_member_mentions("**@jh1987**", ROSTER) == "@jh1987"
    assert inject_member_mentions("**Jonas Hofmann (jh1987)**", ROSTER) == "@jh1987"
    assert inject_member_mentions("**@jh1987 (Jonas Hofmann)**", ROSTER) == "@jh1987"


def test_inject_never_guesses_on_duplicate_display_names():
    # Two members share "Maria Quartz" — the legacy last-write-wins map
    # attached the bold name to whichever member came last in the roster.
    out = inject_member_mentions("Talk to **Maria Quartz** about it.", ROSTER)
    assert out == "Talk to **Maria Quartz** about it."
    # Their unique usernames still map fine.
    assert inject_member_mentions("**mariq**", ROSTER) == "@mariq"
    assert inject_member_mentions("**mbravo**", ROSTER) == "@mbravo"


def test_inject_leaves_unknown_names_alone():
    text = "I recommend **Someone Else** here."
    assert inject_member_mentions(text, ROSTER) == text


# ── sanitize_response_mentions ──────────────────────────────────────────


def test_sanitize_strips_non_roster_handles_only():
    out = sanitize_response_mentions("Ping @jh1987 or @ghost_user.", ROSTER)
    assert out == "Ping @jh1987 or ghost_user."


def test_extract_returns_roster_usernames():
    found = extract_recommended_usernames("Try @jh1987 and @mariq, not @ghost.", ROSTER)
    assert sorted(found) == ["jh1987", "mariq"]


# ── name-mismatch detector (log-only) ───────────────────────────────────


def test_detects_foreign_name_next_to_wrong_handle():
    text = "You should meet @jh1987, Pedro Dias knows fintech inside out."
    hits = find_name_mismatches(text, IDENTITIES)
    assert len(hits) == 1
    assert hits[0]["name"] == "pedro dias"
    assert hits[0]["name_owner"] == "pdias"
    assert hits[0]["handles_in_sentence"] == ["jh1987"]


def test_no_hit_when_name_owner_handle_is_present():
    text = "Meet @pdias — Pedro Dias is great. Also @jh1987 fits."
    assert find_name_mismatches(text, IDENTITIES) == []


def test_no_hit_for_single_token_or_ambiguous_names():
    # Single-token names are skipped (too common in normal prose).
    assert find_name_mismatches("Ask @jh1987 about Pedro.", IDENTITIES) == []
    # A full name shared by two members maps to nobody.
    dup = IDENTITIES + [("pdias2", "Pedro Dias", "Pedro Dias")]
    assert find_name_mismatches("Meet @jh1987, Pedro Dias agrees.", dup) == []


def test_detector_uses_legal_names_too():
    text = "Talk to @jh1987; Maria Eduarda Quartz can help."
    hits = find_name_mismatches(text, IDENTITIES)
    assert len(hits) == 1
    assert hits[0]["name_owner"] == "mariq"


def test_log_name_mismatches_returns_hits_and_never_raises():
    text = "You should meet @jh1987, Pedro Dias knows fintech inside out."
    hits = log_name_mismatches(
        text, IDENTITIES, context="unit", username="tester", community_id=1
    )
    assert len(hits) == 1
    # Garbage input must not raise (the guardrail can never break the reply).
    assert log_name_mismatches(None, IDENTITIES) == []
    assert log_name_mismatches(text, []) == []
