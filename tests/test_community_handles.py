"""Community handles — normalization, uniqueness, and backfill invariants.

Handles are the unique findable address for root communities (display
names may collide; handles never do). These tests lock down:

  1. Slugify/validation rules — lowercase ascii, accents stripped,
     reserved words refused, length bounds.
  2. Unique generation — deterministic ``-2``/``-3`` dedupe, id-based
     fallback for unusable names.
  3. Backfill — root-only, idempotent, oldest community wins the clean
     slug, and discoverable stays OFF (the backfill must never make a
     pre-handle community findable).
"""

from __future__ import annotations

from backend.services.community_handles import (
    RESERVED_HANDLES,
    backfill_missing_handles,
    ensure_handle_columns,
    is_valid_handle,
    slugify_handle,
)
from backend.services.database import get_db_connection, get_sql_placeholder

from tests.fixtures import make_community


def _community_row(community_id: int) -> dict:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT handle, discoverable FROM communities WHERE id = {ph}",
            (community_id,),
        )
        row = c.fetchone()
    if hasattr(row, "keys"):
        return dict(row)
    return {"handle": row[0], "discoverable": row[1]}


# ── 1. Normalization + validation (pure, no DB) ─────────────────────────


class TestHandleRules:
    def test_slugify_lowercases_strips_accents_and_hyphenates(self):
        assert slugify_handle("Lisbon Angels") == "lisbon-angels"
        assert slugify_handle("Café São João!!") == "cafe-sao-joao"
        assert slugify_handle("  --Weird   Spacing--  ") == "weird-spacing"

    def test_slugify_respects_max_length(self):
        assert len(slugify_handle("x" * 100)) <= 32

    def test_validation_bounds_and_charset(self):
        assert is_valid_handle("lisbon-angels")
        assert is_valid_handle("kw28")
        assert not is_valid_handle("ab")  # too short
        assert not is_valid_handle("a" * 33)  # too long
        assert not is_valid_handle("-leading")
        assert not is_valid_handle("trailing-")
        assert not is_valid_handle("Has-Upper")
        assert not is_valid_handle("with space")

    def test_reserved_words_refused(self):
        for word in ("steve", "admin", "cpoint", "communities", "api"):
            assert word in RESERVED_HANDLES
            assert not is_valid_handle(word)


# ── 2 + 3. Generation + backfill (MySQL) ────────────────────────────────


class TestHandleBackfill:
    def test_backfill_assigns_root_handles_and_keeps_discoverable_off(self, mysql_dsn):
        ensure_handle_columns()
        cid = make_community("Founders Lisbon", creator_username="owner")
        backfill_missing_handles()

        row = _community_row(cid)
        assert row["handle"] == "founders-lisbon"
        assert not int(row["discoverable"] or 0)

    def test_colliding_names_dedupe_oldest_wins(self, mysql_dsn):
        ensure_handle_columns()
        first = make_community("Growth Club", creator_username="a")
        second = make_community("Growth  Club!", creator_username="b")
        backfill_missing_handles()

        assert _community_row(first)["handle"] == "growth-club"
        assert _community_row(second)["handle"] == "growth-club-2"

    def test_backfill_is_idempotent(self, mysql_dsn):
        ensure_handle_columns()
        cid = make_community("Stable Handle", creator_username="a")
        assert backfill_missing_handles() >= 1
        before = _community_row(cid)["handle"]
        assert backfill_missing_handles() == 0  # nothing left to fill
        assert _community_row(cid)["handle"] == before

    def test_sub_communities_get_no_handle(self, mysql_dsn):
        ensure_handle_columns()
        root = make_community("Root Net", creator_username="a")
        child = make_community("Child Hub", creator_username="a", parent_community_id=root)
        backfill_missing_handles()

        assert _community_row(root)["handle"] == "root-net"
        assert _community_row(child)["handle"] is None

    def test_reserved_or_unusable_names_fall_back_safely(self, mysql_dsn):
        ensure_handle_columns()
        reserved = make_community("Steve", creator_username="a")
        emoji = make_community("🔥🔥", creator_username="a")
        backfill_missing_handles()

        reserved_handle = _community_row(reserved)["handle"]
        emoji_handle = _community_row(emoji)["handle"]
        assert reserved_handle == f"community-{reserved}"
        assert emoji_handle == f"community-{emoji}"
        assert is_valid_handle(reserved_handle)
        assert is_valid_handle(emoji_handle)
