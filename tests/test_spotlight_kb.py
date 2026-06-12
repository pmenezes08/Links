"""Spotlight answers must reach Steve's KB synthesis verbatim.

Before this wiring, answering the profile spotlight questions ("make your
profile richer") never reached Steve's knowledge: KB synthesis read only
the analysis output and onboardingIdentity. These tests lock down the
verbatim (question, answer) feed.
"""

from __future__ import annotations

import json

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.steve_knowledge_base import fetch_spotlight_answers_for_synthesis

from tests.fixtures import make_user


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


def _set_answers(username: str, payload) -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"UPDATE users SET personal_highlight_answers = {ph} WHERE username = {ph}",
            (json.dumps(payload) if payload is not None else None, username),
        )
        conn.commit()


class TestSpotlightSynthesisFeed:
    def test_answered_questions_pair_with_their_labels(self, mysql_dsn):
        _ensure_column()
        make_user("storyteller")
        _set_answers("storyteller", {
            "five_minutes": "Ask me about regenerative farming.",
            "outside_work": "",
            "cpoint_goals": "Finding a co-founder.",
        })

        pairs = fetch_spotlight_answers_for_synthesis("storyteller")

        assert pairs == [
            ("If we only had five minutes, what should I ask you about?", "Ask me about regenerative farming."),
            ("What are you hoping to get from C-Point?", "Finding a co-founder."),
        ]

    def test_empty_blob_and_missing_user_yield_nothing(self, mysql_dsn):
        _ensure_column()
        make_user("quiet_one")
        _set_answers("quiet_one", None)

        assert fetch_spotlight_answers_for_synthesis("quiet_one") == []
        assert fetch_spotlight_answers_for_synthesis("ghost_user") == []

    def test_malformed_blob_never_raises(self, mysql_dsn):
        _ensure_column()
        make_user("chaos")
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"UPDATE users SET personal_highlight_answers = {ph} WHERE username = {ph}",
                ("not-json-at-all", "chaos"),
            )
            conn.commit()

        assert fetch_spotlight_answers_for_synthesis("chaos") == []
