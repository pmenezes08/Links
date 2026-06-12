"""Spotlight ask lifecycle — eligibility, cadence, and the merge-write trap.

The merge-write tests are the load-bearing ones: the legacy
/update_personal_info endpoint rebuilds the whole answers blob, so a
single-answer save through the wrong path would silently wipe the other
two answers. resolve/merge here must only ever touch one key.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from backend.services import spotlight_asks
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.spotlight_asks import (
    merge_answer,
    pick_spotlight_ask,
    question_eligible,
)

from tests.fixtures import make_user

NOW = datetime(2026, 6, 12, 12, 0, tzinfo=timezone.utc)


# ── Pure eligibility/cadence rules ──────────────────────────────────────


class TestSpotlightRules:
    def test_first_unanswered_question_in_order(self):
        assert pick_spotlight_ask({}, {}, NOW) == "five_minutes"
        assert pick_spotlight_ask({"five_minutes": "ask me about olives"}, {}, NOW) == "outside_work"

    def test_all_answered_means_silence(self):
        answers = {"five_minutes": "a", "outside_work": "b", "cpoint_goals": "c"}
        assert pick_spotlight_ask(answers, {}, NOW) is None

    def test_daily_budget_and_weekly_cadence_block(self):
        recent_ask = {"last_profile_ask_at": (NOW - timedelta(hours=5)).isoformat()}
        assert pick_spotlight_ask({}, recent_ask, NOW) is None
        recent_resolve = {"last_spotlight_resolved_at": (NOW - timedelta(days=3)).isoformat()}
        assert pick_spotlight_ask({}, recent_resolve, NOW) is None
        stale = {
            "last_profile_ask_at": (NOW - timedelta(days=2)).isoformat(),
            "last_spotlight_resolved_at": (NOW - timedelta(days=8)).isoformat(),
        }
        assert pick_spotlight_ask({}, stale, NOW) == "five_minutes"

    def test_skip_lifecycle_reoffers_once_then_retires(self):
        fresh_skip = {"five_minutes": {"skip_count": 1, "skipped_at": (NOW - timedelta(days=5)).isoformat()}}
        assert question_eligible("five_minutes", {}, fresh_skip, NOW) is False
        due_reoffer = {"five_minutes": {"skip_count": 1, "skipped_at": (NOW - timedelta(days=31)).isoformat()}}
        assert question_eligible("five_minutes", {}, due_reoffer, NOW) is True
        retired = {"five_minutes": {"skip_count": 2, "skipped_at": (NOW - timedelta(days=90)).isoformat()}}
        assert question_eligible("five_minutes", {}, retired, NOW) is False
        # A skipped question is passed over in favor of the next one.
        doc = {"spotlight": fresh_skip}
        assert pick_spotlight_ask({}, doc, NOW) == "outside_work"


# ── Merge-write safety (MySQL) ──────────────────────────────────────────


def _ensure_column() -> None:
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute("ALTER TABLE users ADD COLUMN personal_highlight_answers TEXT NULL")
        except Exception:
            pass
        try:
            conn.commit()
        except Exception:
            pass


def _read_blob(username: str) -> dict:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"SELECT personal_highlight_answers FROM users WHERE username = {ph}",
            (username,),
        )
        row = c.fetchone()
    raw = (row["personal_highlight_answers"] if hasattr(row, "keys") else row[0]) if row else None
    return json.loads(raw) if raw else {}


class TestSpotlightMergeWrite:
    def test_single_answer_never_touches_siblings(self, mysql_dsn):
        _ensure_column()
        make_user("careful")
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"UPDATE users SET personal_highlight_answers = {ph} WHERE username = {ph}",
                (json.dumps({"five_minutes": "olives", "outside_work": "the coast"}), "careful"),
            )
            conn.commit()

        assert merge_answer("careful", "cpoint_goals", "finding a co-founder") is True

        blob = _read_blob("careful")
        assert blob == {
            "five_minutes": "olives",
            "outside_work": "the coast",
            "cpoint_goals": "finding a co-founder",
        }

    def test_resolve_answer_saves_and_marks(self, mysql_dsn, monkeypatch):
        _ensure_column()
        make_user("marker_writer")
        written = {}
        monkeypatch.setattr(spotlight_asks, "write_markers", lambda u, payload: written.update(payload))
        monkeypatch.setattr(spotlight_asks, "read_markers", lambda u: {})

        body, status = spotlight_asks.resolve_spotlight_ask(
            "marker_writer", "five_minutes", "answer", text="ask me about sailing"
        )

        assert status == 200 and body["saved"] is True
        assert _read_blob("marker_writer")["five_minutes"] == "ask me about sailing"
        assert "last_spotlight_resolved_at" in written
        assert "last_profile_ask_at" in written  # shared budget marker

    def test_resolve_skip_bumps_lifecycle_without_writing_answers(self, mysql_dsn, monkeypatch):
        _ensure_column()
        make_user("skipper")
        written = {}
        monkeypatch.setattr(spotlight_asks, "write_markers", lambda u, payload: written.update(payload))
        monkeypatch.setattr(spotlight_asks, "read_markers", lambda u: {})

        body, status = spotlight_asks.resolve_spotlight_ask("skipper", "five_minutes", "skip")

        assert status == 200 and body["saved"] is False
        assert _read_blob("skipper") == {}
        assert written["spotlight"]["five_minutes"]["skip_count"] == 1

    def test_unknown_question_and_empty_answer_rejected(self, mysql_dsn):
        _ensure_column()
        make_user("strict")
        assert spotlight_asks.resolve_spotlight_ask("strict", "nope", "answer", text="x")[1] == 400
        assert spotlight_asks.resolve_spotlight_ask("strict", "five_minutes", "answer", text="  ")[1] == 400
