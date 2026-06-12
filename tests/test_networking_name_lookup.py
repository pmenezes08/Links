"""Deterministic name-lookup fast path for Steve networking (pure unit tests).

The classifier must be ultra-conservative: a false positive silently skips
the semantic pipeline, so anything that is not unambiguously "just a name
lookup" must return None. Covers the three trigger shapes (bare handles,
who-is templates, first-turn bare name), the follow-up/ambiguity guards,
and the i18n templates the route renders.
"""

from __future__ import annotations

from backend.services.networking_name_lookup import try_name_lookup

# Row layout mirrors the steve_match roster SELECT: 0=username,
# 1=display_name, 11=first_name, 12=last_name.


def _row(username, display, first="", last=""):
    row = [""] * 13
    row[0] = username
    row[1] = display
    row[11] = first
    row[12] = last
    return row


def _get(r, i):
    return r[i]

ROSTER = [
    _row("maria_s", "Maria Silva", "Maria", "Silva"),
    _row("pdias", "Pedro Dias", "Pedro Eduardo", "Dias"),
    _row("jh1987", "Jonas Hofmann"),
]


def _lookup(message, *, rows=ROSTER, has_history=False):
    return try_name_lookup(message, rows, _get, has_history=has_history)


# ── trigger shapes ──────────────────────────────────────────────────────


def test_bare_handle_resolves():
    assert _lookup("@maria_s") == {"usernames": ["maria_s"]}
    assert _lookup("@maria_s?") == {"usernames": ["maria_s"]}


def test_multiple_handles_resolve_in_order():
    assert _lookup("@maria_s and @pdias") == {"usernames": ["maria_s", "pdias"]}
    assert _lookup("@maria_s, @jh1987") == {"usernames": ["maria_s", "jh1987"]}


def test_unknown_handle_falls_through():
    assert _lookup("@ghost_user") is None
    assert _lookup("@maria_s and @ghost_user") is None


def test_who_is_template_resolves_display_and_legal_names():
    assert _lookup("who is Maria Silva?") == {"usernames": ["maria_s"]}
    assert _lookup("quem é Maria Silva") == {"usernames": ["maria_s"]}
    assert _lookup("quien es Pedro Dias") == {"usernames": ["pdias"]}
    # Legal name ("Pedro Eduardo Dias") resolves too.
    assert _lookup("who is Pedro Eduardo Dias") == {"usernames": ["pdias"]}


def test_bare_name_resolves_only_on_first_turn():
    assert _lookup("Maria Silva") == {"usernames": ["maria_s"]}
    assert _lookup("Maria Silva", has_history=True) is None


# ── guards: anything not unambiguously a lookup falls through ───────────


def test_conceptual_queries_fall_through():
    assert _lookup("find people like Maria Silva") is None
    assert _lookup("find marketing people in Lisbon") is None
    assert _lookup("who should Maria Silva meet about funding?") is None


def test_followups_and_pronouns_fall_through():
    assert _lookup("tell me more about her", has_history=True) is None
    assert _lookup("tell me more about her") is None


def test_ambiguous_display_name_falls_through():
    rows = ROSTER + [_row("maria2", "Maria Silva")]
    assert _lookup("who is Maria Silva", rows=rows) is None
    assert _lookup("Maria Silva", rows=rows) is None
    # Unique members are unaffected by the duplicate.
    assert _lookup("@maria_s", rows=rows) == {"usernames": ["maria_s"]}


def test_long_messages_and_garbage_fall_through():
    assert _lookup("who is " + "x" * 100) is None
    assert _lookup("") is None
    assert _lookup(None) is None
    assert _lookup("Maria Silva", rows=[]) is None


# ── i18n templates used by the route ────────────────────────────────────


def test_templates_exist_and_format_in_both_locales():
    from backend.services.i18n import t

    for locale in ("en", "pt-PT"):
        one = t("networking.name_lookup_found_one", locale, username="maria_s")
        assert "@maria_s" in one
        many = t(
            "networking.name_lookup_found_many", locale, mentions="@maria_s @pdias"
        )
        assert "@maria_s @pdias" in many
