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
