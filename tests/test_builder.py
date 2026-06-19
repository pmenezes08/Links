"""Tests for the Steve Builder surface.

Covers the AI-surface invariants for a new paid surface: the entitlements
gate (free quota vs paid uncap), creation persistence, and that publishing
creates a post linked to the creation. Runs against the MySQL testcontainer
(skips cleanly when Docker is unavailable).
"""

from __future__ import annotations

import pytest

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services import ai_usage, builder
from backend.services.entitlements_gate import gate_builder_or_reason

pytestmark = pytest.mark.usefixtures("mysql_dsn")

_FAKE_HTML = "<!doctype html><html><body><canvas></canvas></body></html>"


@pytest.fixture(autouse=True)
def _builder_tables():
    """Create the creations table + posts.creation_id for each test run."""
    builder.ensure_tables()


def _make_user(username: str, subscription: str = "free") -> None:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO users (username, subscription) VALUES ({ph}, {ph})",
            (username, subscription),
        )
        conn.commit()


def _make_community(name: str = "Builders") -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"INSERT INTO communities (name, creator_username) VALUES ({ph}, {ph})",
            (name, "owner"),
        )
        cid = c.lastrowid
        conn.commit()
    return cid


def test_create_stores_a_draft_creation(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()

    result = builder.create_creation(username="maker", community_id=cid, prompt="build a tetris game")
    assert result["id"]
    assert "<!doctype html>" in result["html"].lower()

    row = builder.get_creation(result["id"])
    assert row is not None
    assert row["created_by"] == "maker"
    assert row["status"] == "draft"
    assert int(row["community_id"]) == cid


def test_iterate_replaces_html(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a quiz")

    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: "<!doctype html><html><body>v2</body></html>")
    updated = builder.iterate_creation(creation_id=created["id"], username="maker", message="make it neon")
    assert "v2" in updated["html"]
    assert builder.get_creation(created["id"])["html_content"] == updated["html"]


def test_publish_creates_post_linked_to_creation(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a game")

    pub = builder.publish_creation(creation_id=created["id"], username="maker", caption="play this")
    assert pub["post_id"]
    assert pub["already_published"] is False

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT creation_id, username FROM posts WHERE id = {ph}", (pub["post_id"],))
        row = c.fetchone()
    assert row is not None
    creation_id = row["creation_id"] if hasattr(row, "keys") else row[0]
    assert int(creation_id) == int(created["id"])

    # Publishing again is idempotent — same post, no duplicate.
    again = builder.publish_creation(creation_id=created["id"], username="maker")
    assert again["post_id"] == pub["post_id"]
    assert again["already_published"] is True


def test_publish_rejects_non_owner(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    _make_user("intruder")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a game")

    with pytest.raises(PermissionError):
        builder.publish_creation(creation_id=created["id"], username="intruder")


def test_gate_allows_free_quota_then_blocks_at_cap():
    _make_user("capped")  # free tier → free builder quota
    allowed, reason, ent = gate_builder_or_reason("capped", enforce_override=True)
    assert allowed is True
    assert reason is None
    cap = ent.get("builder_turns_per_month")
    assert isinstance(cap, int) and cap > 0

    for _ in range(cap):
        ai_usage.log_usage("capped", surface=ai_usage.SURFACE_BUILDER,
                           request_type="builder_create", community_id=1)

    blocked, reason2, _ent = gate_builder_or_reason("capped", enforce_override=True)
    assert blocked is False
    assert reason2 == "builder_monthly_cap"


def test_paid_tier_is_uncapped():
    _make_user("pro", subscription="premium")
    allowed, _reason, ent = gate_builder_or_reason("pro", enforce_override=True)
    assert allowed is True
    assert ent.get("builder_turns_per_month") is None


# --- Community interaction data ------------------------------------------------

def _make_creation(cid: int, owner: str = "maker", monkeypatch=None) -> int:
    if monkeypatch is not None:
        monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    return builder.create_creation(username=owner, community_id=cid, prompt="a game")["id"]


def test_submit_score_keeps_best_and_ranks(monkeypatch):
    _make_user("maker"); _make_user("p2")
    cid = _make_community()
    crid = _make_creation(cid, monkeypatch=monkeypatch)

    builder.submit_score(creation_id=crid, community_id=cid, username="maker", value=100)
    builder.submit_score(creation_id=crid, community_id=cid, username="maker", value=50)  # lower → ignored
    r = builder.submit_score(creation_id=crid, community_id=cid, username="p2", value=200)

    board = builder.get_leaderboard(crid, username="maker")
    assert [int(e["value"]) for e in board["entries"]] == [200, 100]
    assert board["entries"][0]["rank"] == 1
    assert board["mine"] is not None and int(board["mine"]["value"]) == 100 and board["mine"]["rank"] == 2
    assert r["rank"] == 1 and int(r["best"]) == 200


def test_rate_creation_aggregates(monkeypatch):
    _make_user("maker"); _make_user("p2")
    cid = _make_community()
    crid = _make_creation(cid, monkeypatch=monkeypatch)

    builder.rate_creation(creation_id=crid, community_id=cid, username="maker", value=4)
    builder.rate_creation(creation_id=crid, community_id=cid, username="maker", value=5)  # replaces (latest wins)
    res = builder.rate_creation(creation_id=crid, community_id=cid, username="p2", value=1)
    assert res["count"] == 2
    assert res["average"] == 3.0  # (5 + 1) / 2
    assert int(res["mine"]) == 1


def test_play_count_and_summary(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation(cid, monkeypatch=monkeypatch)

    builder.record_play(crid)
    out = builder.record_play(crid)
    assert out["plays"] == 2

    builder.submit_score(creation_id=crid, community_id=cid, username="maker", value=500)
    builder.rate_creation(creation_id=crid, community_id=cid, username="maker", value=4)
    summary = builder.get_summary(crid)
    assert summary["plays"] == 2
    assert int(summary["top_score"]) == 500
    assert summary["rating_avg"] == 4.0 and summary["rating_count"] == 1


def test_invalid_score_is_rejected(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation(cid, monkeypatch=monkeypatch)
    for bad in ("not-a-number", float("nan"), float("inf")):
        with pytest.raises(ValueError):
            builder.submit_score(creation_id=crid, community_id=cid, username="maker", value=bad)
