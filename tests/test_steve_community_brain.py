"""Community Brain v1: synthesis parsing, freshness contract, recall gating."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from backend.services.steve_community_brain import (
    BrainConfig,
    build_synthesis_prompt,
    extract_recall_terms,
    get_brain_config,
    is_recall_question,
    list_refresh_candidates,
    parse_synthesis_json,
    try_recall_context,
)
from backend.services.steve_community_memory import is_memory_fresh


class _ScriptedCursor:
    """Cursor stub returning queued fetchall/fetchone results in order."""

    def __init__(self, fetchall_results=None, fetchone_results=None):
        self._fetchall = list(fetchall_results or [])
        self._fetchone = list(fetchone_results or [])
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchall(self):
        return self._fetchall.pop(0) if self._fetchall else []

    def fetchone(self):
        return self._fetchone.pop(0) if self._fetchone else None


# ── Recall gating ───────────────────────────────────────────────────────


def test_recall_gate_requires_explicit_backward_reference():
    assert is_recall_question("didn't we discussed this before?") or is_recall_question(
        "we discussed this before"
    )
    assert is_recall_question("@steve what did we decide about the tournament?")
    assert is_recall_question("remember the padel thread?")
    assert is_recall_question("@steve lembras-te do que decidimos sobre as quotas?")
    assert is_recall_question("já falámos disto há umas semanas")

    assert not is_recall_question("what do you think about this?")
    assert not is_recall_question("bom dia pessoal!")
    assert not is_recall_question("@steve any thoughts on the new gym schedule?")


def test_recall_terms_drop_invocation_stopwords_and_recall_verbs():
    terms = extract_recall_terms("@steve what did we decide about the padel tournament rules?")
    assert "padel" in terms
    assert "tournament" in terms
    assert "steve" not in terms
    assert "decide" not in terms  # recall-phrase word, not a content term
    assert "what" not in terms


def test_try_recall_context_skips_without_recall_phrasing(monkeypatch):
    cursor = _ScriptedCursor()
    block = try_recall_context(
        cursor, "%s", community_id=1, user_message="@steve thoughts on the schedule?"
    )
    assert block == ""
    assert cursor.executed == []  # gated before any SQL


def test_try_recall_context_renders_dated_snippets(monkeypatch):
    from backend.services import community as community_svc
    from backend.services import steve_community_brain as brain

    monkeypatch.setattr(community_svc, "resolve_root_community_id", lambda cid: (cid, True))
    monkeypatch.setattr(brain, "_tree_ids", lambda cursor, rid: [rid])

    cursor = _ScriptedCursor(
        fetchall_results=[
            [
                {"username": "mary", "content": "Padel tournament set for May 10", "timestamp": "2026-07-01 10:00:00"},
            ],
            [
                {"username": "paulo", "content": "I booked the padel courts", "timestamp": "2026-07-02 09:00:00"},
            ],
        ]
    )
    block = try_recall_context(
        cursor, "%s", community_id=7, user_message="@steve when did we decide the padel tournament date?"
    )
    assert "Community recall" in block
    assert "[2026-07-01] post by mary" in block
    assert "[2026-07-02] comment by paulo" in block
    assert "cite dates" in block


def test_try_recall_context_empty_results_return_empty(monkeypatch):
    from backend.services import community as community_svc
    from backend.services import steve_community_brain as brain

    monkeypatch.setattr(community_svc, "resolve_root_community_id", lambda cid: (cid, True))
    monkeypatch.setattr(brain, "_tree_ids", lambda cursor, rid: [rid])
    cursor = _ScriptedCursor(fetchall_results=[[], []])
    assert (
        try_recall_context(cursor, "%s", community_id=7, user_message="remember the padel plan?")
        == ""
    )


# ── Synthesis parsing ───────────────────────────────────────────────────


def test_parse_synthesis_json_happy_path_and_caps():
    raw = (
        "Here you go:\n"
        '{"currentSummary": "Focused on the spring tournament.",'
        f'"topics": {list(map(str, range(10)))!r},'.replace("'", '"')
        + '"activeDecisions": ["venue"], "recentSignals": ["50 members"],'
        '"upcomingEventsSummary": "Finals on May 10."}'
    )
    data = parse_synthesis_json(raw)
    assert data is not None
    assert data["currentSummary"] == "Focused on the spring tournament."
    assert len(data["topics"]) == 6  # capped
    assert data["upcomingEventsSummary"] == "Finals on May 10."


def test_parse_synthesis_json_rejects_garbage_and_empty():
    assert parse_synthesis_json("") is None
    assert parse_synthesis_json("no json here") is None
    assert parse_synthesis_json("{broken json") is None
    # Structurally valid but content-empty → treated as unusable (no write).
    assert (
        parse_synthesis_json(
            '{"currentSummary": "", "topics": [], "activeDecisions": [], '
            '"recentSignals": [], "upcomingEventsSummary": ""}'
        )
        is None
    )


def test_build_synthesis_prompt_includes_activity_and_json_contract():
    activity = {
        "root_id": 3,
        "community_name": "Padel Lisboa",
        "posts": [
            {"id": 1, "username": "mary", "content": "Tournament in May?", "timestamp": "2026-07-01"}
        ],
        "replies": [{"post_id": 1, "username": "paulo", "content": "yes!"}],
        "events": [{"title": "Finals", "date": "2026-08-02", "start_time": "10:00", "description": ""}],
        "polls": ["Best day for finals?"],
        "links": [],
        "latest_post_ts": "2026-07-01",
    }
    system, user = build_synthesis_prompt(activity, window_days=30)
    assert '"currentSummary"' in system
    assert "last 30 days" in system
    assert "Padel Lisboa" in user
    assert "mary: Tournament in May?" in user
    assert "· paulo: yes!" in user
    assert "Finals on 2026-08-02" in user
    assert "Best day for finals?" in user


# ── Freshness contract ──────────────────────────────────────────────────


def test_memory_freshness_contract():
    now = datetime(2026, 7, 27, tzinfo=timezone.utc)
    fresh = {"updatedAt": (now - timedelta(days=3)).isoformat()}
    stale = {"updatedAt": (now - timedelta(days=30)).isoformat()}
    assert is_memory_fresh(fresh, freshness_days=14, now=now)
    assert not is_memory_fresh(stale, freshness_days=14, now=now)
    assert not is_memory_fresh({}, freshness_days=14, now=now)  # legacy doc, no stamp
    assert not is_memory_fresh({"updatedAt": "not-a-date"}, freshness_days=14, now=now)


# ── Config + candidates ─────────────────────────────────────────────────


def test_brain_config_defaults_and_kb_overrides(monkeypatch):
    from backend.services import knowledge_base

    monkeypatch.setattr(knowledge_base, "get_page", lambda slug: {"fields": []})
    cfg = get_brain_config()
    assert cfg == BrainConfig()

    monkeypatch.setattr(
        knowledge_base,
        "get_page",
        lambda slug: {
            "fields": [
                {"name": "community_brain_enabled", "value": "false"},
                {"name": "community_brain_window_days", "value": "7"},
                {"name": "community_brain_max_communities_per_run", "value": "2"},
            ]
        },
    )
    cfg = get_brain_config()
    assert cfg.enabled is False
    assert cfg.window_days == 7
    assert cfg.max_communities_per_run == 2


def test_list_refresh_candidates_rolls_up_to_root_and_filters(monkeypatch):
    from backend.services import community as community_svc

    # Communities 11 and 12 are children of root 1; 20 is its own root.
    monkeypatch.setattr(
        community_svc,
        "resolve_root_community_id",
        lambda cid: (1, True) if cid in (11, 12) else (cid, True),
    )
    cursor = _ScriptedCursor(
        fetchall_results=[
            [
                {"community_id": 11, "n": 2},
                {"community_id": 12, "n": 3},
                {"community_id": 20, "n": 2},
            ]
        ]
    )
    out = list_refresh_candidates(cursor, "%s", window_days=30, min_new_posts=3, limit=10)
    assert out == [{"root_id": 1, "post_count": 5}]  # 20 filtered (2 < 3)
