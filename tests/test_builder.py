"""Tests for the Steve Builder surface.

Covers the AI-surface invariants for a new paid surface: the entitlements
gate (free quota vs paid uncap), creation persistence, and that publishing
creates a post linked to the creation. Runs against the MySQL testcontainer
(skips cleanly when Docker is unavailable).
"""

from __future__ import annotations

import pytest

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services import ai_usage, builder, builder_feeds, creation_runtime, r2_storage
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
    assert result["kind"] == "game"

    row = builder.get_creation(result["id"])
    assert row is not None
    assert row["created_by"] == "maker"
    assert row["status"] == "draft"
    assert row["kind"] == "game"
    assert int(row["community_id"]) == cid


def test_create_allows_independent_creation(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")

    result = builder.create_creation(username="maker", community_id=None, prompt="a personal website")
    row = builder.get_creation(result["id"])

    assert result["community_id"] is None
    assert row is not None
    assert row["community_id"] is None
    assert row["created_by"] == "maker"


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


def test_independent_creation_can_be_shared_to_multiple_communities(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    first = _make_community("First")
    second = _make_community("Second")
    created = builder.create_creation(username="maker", community_id=None, prompt="a reusable app")

    a = builder.publish_creation(creation_id=created["id"], username="maker", community_id=first)
    b = builder.publish_creation(creation_id=created["id"], username="maker", community_id=second)

    assert a["post_id"] != b["post_id"]
    assert builder.get_creation_share(creation_id=created["id"], community_id=first)["post_id"] == a["post_id"]
    assert builder.get_creation_share(creation_id=created["id"], community_id=second)["post_id"] == b["post_id"]
    mine = builder.list_creations("maker")
    listed = next(item for item in mine if int(item["id"]) == int(created["id"]))
    assert sorted(int(cid) for cid in listed["shared_community_ids"]) == sorted([first, second])




def test_publish_rejects_non_owner(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    _make_user("intruder")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a game")

    with pytest.raises(PermissionError):
        builder.publish_creation(creation_id=created["id"], username="intruder")


def test_publish_web_writes_public_artifact_and_manifest(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    uploads = {}

    def fake_upload(raw, key, content_type=None, cache_control=None):
        uploads[key] = {"raw": raw, "content_type": content_type, "cache_control": cache_control}
        return True

    monkeypatch.setattr(r2_storage, "upload_public_bytes_to_r2", fake_upload)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a public website")

    result = builder.publish_creation_to_web(creation_id=created["id"], username="maker")

    assert result["public_status"] == "published"
    assert result["public_url"].startswith(builder.PUBLIC_BUILDS_BASE_URL)
    assert result["public_kind"] == "website"
    assert builder.public_manifest_r2_key(result["public_slug"]) in uploads
    html_key = next(k for k in uploads if k.endswith(".html"))
    html = uploads[html_key]["raw"].decode("utf-8")
    assert "Built with C-Point" in html
    assert "isPublicBuild:true" in html
    assert builder.public_creation_for_slug(result["public_slug"])["id"] == created["id"]


def test_public_images_route_uses_published_slug(builder_client, monkeypatch):
    import backend.blueprints.builder as builder_bp_mod

    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    monkeypatch.setattr(r2_storage, "upload_public_bytes_to_r2", lambda *_a, **_k: True)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a public website")
    published = builder.publish_creation_to_web(creation_id=created["id"], username="maker")
    monkeypatch.setattr(builder_bp_mod, "_data_read_ok", lambda *_a, **_k: True)
    monkeypatch.setattr(builder_bp_mod.builder_svc, "search_images", lambda q, *, limit=8: [
        {"url": f"https://img.example/{q}.jpg", "title": "Lisbon"},
    ])

    resp = builder_client.get(f"/api/builder/public/{published['public_slug']}/data/images?q=lisbon&limit=4")
    body = resp.get_json()

    assert resp.status_code == 200
    assert body["success"] is True
    assert body["images"][0]["url"] == "https://img.example/lisbon.jpg"
    assert resp.headers["Access-Control-Allow-Origin"] == "*"


def test_publish_web_rejects_games(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a game")
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"UPDATE creations SET kind = {ph} WHERE id = {ph}", ("game", created["id"]))
        conn.commit()

    with pytest.raises(ValueError, match="public_publish_not_supported_for_games"):
        builder.publish_creation_to_web(creation_id=created["id"], username="maker")


def test_unpublish_web_removes_manifest_and_public_artifact(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    uploads = {}
    deleted = []
    monkeypatch.setattr(r2_storage, "upload_public_bytes_to_r2", lambda raw, key, **_k: uploads.setdefault(key, raw) is raw)
    monkeypatch.setattr(r2_storage, "delete_from_r2", lambda key: deleted.append(key) or True)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a website")
    result = builder.publish_creation_to_web(creation_id=created["id"], username="maker")

    unpub = builder.unpublish_creation_from_web(creation_id=created["id"], username="maker")

    assert unpub["public_status"] == "unpublished"
    assert builder.public_manifest_r2_key(result["public_slug"]) in deleted
    assert any(k.endswith(".html") for k in deleted)
    assert builder.public_creation_for_slug(result["public_slug"]) is None


def test_delete_creation_removes_public_artifacts(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    deleted = []
    monkeypatch.setattr(r2_storage, "upload_public_bytes_to_r2", lambda raw, key, **_k: True)
    monkeypatch.setattr(r2_storage, "delete_from_r2", lambda key: deleted.append(key) or True)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a website")
    result = builder.publish_creation_to_web(creation_id=created["id"], username="maker")

    body, status = builder.delete_creation("maker", created["id"])

    assert status == 200
    assert body["success"] is True
    assert builder.public_manifest_r2_key(result["public_slug"]) in deleted
    assert any(k.endswith(".html") for k in deleted)


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


def test_leaderboards_are_scoped_by_community(monkeypatch):
    _make_user("maker"); _make_user("p2")
    first = _make_community("First")
    second = _make_community("Second")
    crid = _make_creation(first, monkeypatch=monkeypatch)

    builder.submit_score(creation_id=crid, community_id=first, username="maker", value=100)
    builder.submit_score(creation_id=crid, community_id=second, username="p2", value=900)

    first_board = builder.get_leaderboard(crid, community_id=first, username="maker")
    second_board = builder.get_leaderboard(crid, community_id=second, username="p2")

    assert [int(e["value"]) for e in first_board["entries"]] == [100]
    assert [int(e["value"]) for e in second_board["entries"]] == [900]


def test_gallery_explore_lists_owner_approved_creations_anonymous(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: "<!doctype html><html><body>site</body></html>")
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a public website")

    assert builder.list_explore_creations() == []

    approved = builder.update_gallery_status(creation_id=created["id"], username="maker", action="request")
    assert approved["gallery_status"] == "approved"
    monkeypatch.setattr(builder, "ensure_tables", lambda *a, **k: pytest.fail("hot path schema setup should not run"))
    listed = builder.list_explore_creations()
    assert len(listed) == 1
    assert listed[0]["title"]
    assert listed[0]["play_url"] == f"/creation/{created['id']}"
    assert listed[0]["public_url"] is None
    assert "created_by" not in listed[0]
    assert "community_id" not in listed[0]
    assert "post_id" not in listed[0]


def test_submit_score_repeats_are_atomic_and_keep_max(monkeypatch):
    """Regression: repeated submits for the same (creation, key, user) must NOT
    raise an IntegrityError on the unique key and must keep the best — the old
    non-atomic SELECT-then-INSERT collided under rapid/concurrent submits."""
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation(cid, monkeypatch=monkeypatch)

    for v in (100, 50, 175, 175, 30):  # no exception; best wins; single row
        builder.submit_score(creation_id=crid, community_id=cid, username="maker", value=v)

    board = builder.get_leaderboard(crid, username="maker")
    assert len(board["entries"]) == 1
    assert int(board["mine"]["value"]) == 175


def test_save_record_repeats_are_atomic_latest_wins(monkeypatch):
    """Regression: repeated saves to the same slot must not collide on the unique
    key; latest value wins and stays a single row."""
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation(cid, monkeypatch=monkeypatch)

    for v in ("a", "bb", "ccc"):
        builder.save_record(creation_id=crid, community_id=cid, username="maker", key="slot1", value=v)
    assert builder.load_record(crid, username="maker", key="slot1")["value"] == "ccc"


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


def test_converse_proposes_in_agent_mode(monkeypatch):
    monkeypatch.setattr(
        builder.llm, "generate_text",
        lambda *a, **k: '{"reply":"I\'ll make a neon snake with a leaderboard. Build it?","ready":true,"brief":"Neon snake with on-screen controls, sound, and a community leaderboard."}',
    )
    out = builder.converse([], "make a snake game", mode="simple", agent_mode=True)
    assert out["ready"] is True
    assert out["brief"]
    assert "snake" in out["reply"].lower()


def test_converse_ask_mode_never_builds(monkeypatch):
    # Even if the model says it's ready, Ask mode must never trigger a build.
    monkeypatch.setattr(
        builder.llm, "generate_text",
        lambda *a, **k: '{"reply":"Here is an idea you could try.","ready":true,"brief":"a thing"}',
    )
    out = builder.converse([], "make a snake game", agent_mode=False)
    assert out["ready"] is False
    assert out["brief"] == ""
    assert out["reply"]


def test_converse_tolerates_non_json(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: "Sure! Tell me more about the vibe you want.")
    out = builder.converse([], "hi", agent_mode=True)
    assert out["ready"] is False
    assert "vibe" in out["reply"].lower()


def test_build_guide_loads_and_has_anchors():
    """The Steve Build Guide (builder_guide.md) is the codegen source of truth.
    Guard its key sections so a future edit can't silently drop them, and confirm
    chat shares the SAME capabilities block (one source of truth, no drift)."""
    assert builder._load_build_guide(), "builder_guide.md did not load"
    sp = builder._SYSTEM_PROMPT
    assert sp is not builder._SYSTEM_PROMPT_FALLBACK, "codegen is using the inline fallback, not the guide"
    for anchor in (
        "modern", "minimalist", "x.ai", "CPoint.match", "Websites", "Apps", "Games", "sandbox",
        "matchController", "controller.submitMove", "controller.cancel", "stale_version",
    ):
        assert anchor.lower() in sp.lower(), f"build-guide anchor missing: {anchor}"
    caps = builder._CAPS_BLOCK
    assert caps and "CAPS:START" not in caps, "capabilities block not extracted cleanly"
    assert "cannot" in caps.lower() and "login" in caps.lower(), "CAN/CANNOT missing from caps block"
    assert caps in builder._CONVERSE_BASE, "chat prompt does not share the guide's capabilities block"


def test_research_repairs_when_data_not_grounded(monkeypatch):
    """If the first artifact omits the researched data, generate_artifact runs
    exactly one repair pass and the final HTML cites the real source."""
    monkeypatch.setattr(
        builder.llm, "web_search_text",
        lambda *a, **k: "Pebble Beach front nine pars: 4-5-4-4-3-5-3-4-4. Source: https://example.com/pebble",
    )
    calls = {"n": 0}

    def fake_gen(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:  # first artifact ignores the data (no citation)
            return "<!doctype html><html><body>A scorecard, no real data.</body></html>"
        return ('<!doctype html><html><body>Pars 4-5-4 '
                '<a href="https://example.com/pebble">source</a></body></html>')

    monkeypatch.setattr(builder.llm, "generate_text", fake_gen)
    html = builder.generate_artifact("a Pebble Beach scorecard with the real par for each hole")
    assert calls["n"] == 2  # one repair pass fired
    assert "example.com/pebble" in html


def test_no_repair_when_no_research_needed(monkeypatch):
    """A creation needing no real-world data (research returns NONE) generates
    once — no verification overhead, no repair pass."""
    monkeypatch.setattr(builder.llm, "web_search_text", lambda *a, **k: "NONE")
    calls = {"n": 0}

    def fake_gen(*a, **k):
        calls["n"] += 1
        return _FAKE_HTML

    monkeypatch.setattr(builder.llm, "generate_text", fake_gen)
    html = builder.generate_artifact("a retro snake game")
    assert calls["n"] == 1  # generated once, no repair
    assert "<!doctype html>" in html.lower()


def test_render_quality_pass_noop_when_unconfigured(monkeypatch):
    """With no render service configured, the quality pass is a pure no-op."""
    from backend.services import render_service
    monkeypatch.setattr(render_service, "is_configured", lambda: False)
    calls = {"render": 0}
    monkeypatch.setattr(render_service, "render",
                        lambda *a, **k: calls.__setitem__("render", calls["render"] + 1))
    html = "<!doctype html><html><body>orig</body></html>"
    out = builder._render_quality_pass(html, prompt="x", facts="", sources=[],
                                       model=builder._MODEL_FAST, username="u", community_id=1)
    assert out == html
    assert calls["render"] == 0


def test_render_quality_pass_fixes_blank_render(monkeypatch):
    """A blank first render triggers exactly one render-fix regeneration."""
    from backend.services import render_service, vision_judge
    monkeypatch.setattr(render_service, "is_configured", lambda: True)
    renders = {"n": 0}

    def fake_render(html, **k):
        renders["n"] += 1
        return {"screenshot": "imgdata", "console_errors": [],
                "blank": renders["n"] == 1, "overflow": False, "dimensions": {}}

    monkeypatch.setattr(render_service, "render", fake_render)
    monkeypatch.setattr(vision_judge, "judge", lambda *a, **k: {
        "render_ok": True, "design_score": 90, "data_verified": "na",
        "data_issues": [], "critique": []})
    regen = {"n": 0}
    monkeypatch.setattr(builder, "_repair_regen", lambda h, m, i, timeout=None: (
        regen.__setitem__("n", regen["n"] + 1) or "<!doctype html><html><body>fixed</body></html>"))
    out = builder._render_quality_pass("<!doctype html><html><body></body></html>",
                                       prompt="x", facts="", sources=[],
                                       model=builder._MODEL_FAST, username="u", community_id=1)
    assert regen["n"] == 1
    assert "fixed" in out


def test_render_quality_pass_fixes_wrong_data(monkeypatch):
    """When the judge says on-screen data doesn't match, one data-fix regen runs."""
    from backend.services import render_service, vision_judge
    monkeypatch.setattr(render_service, "is_configured", lambda: True)
    monkeypatch.setattr(render_service, "render", lambda html, **k: {
        "screenshot": "img", "console_errors": [], "blank": False,
        "overflow": False, "dimensions": {}})
    monkeypatch.setattr(vision_judge, "judge", lambda *a, **k: {
        "render_ok": True, "design_score": 80, "data_verified": "no",
        "data_issues": ["par for hole 1 is wrong"], "critique": []})
    regen = {"n": 0}
    monkeypatch.setattr(builder, "_repair_regen", lambda h, m, i, timeout=None: (
        regen.__setitem__("n", regen["n"] + 1) or "<!doctype html><html><body>corrected</body></html>"))
    out = builder._render_quality_pass("<html></html>", prompt="scorecard",
                                       facts="hole 1 par 4 https://x.com",
                                       sources=["https://x.com"],
                                       model=builder._MODEL_FAST, username="u", community_id=1)
    assert regen["n"] == 1
    assert "corrected" in out


def test_render_quality_pass_respects_time_budget(monkeypatch):
    """With no wall-clock budget left, the pass skips everything and returns the
    artifact unchanged — the guard that stops a build overrunning its timeout."""
    from backend.services import render_service
    monkeypatch.setattr(render_service, "is_configured", lambda: True)
    rendered = {"n": 0}
    monkeypatch.setattr(render_service, "render",
                        lambda h, **k: rendered.__setitem__("n", rendered["n"] + 1))
    monkeypatch.setattr(builder, "_QUALITY_BUDGET_SECONDS", -1)  # already past deadline
    regen = {"n": 0}
    monkeypatch.setattr(builder, "_repair_regen",
                        lambda h, m, i, timeout=None: regen.__setitem__("n", regen["n"] + 1))
    html = "<!doctype html><html><body>keep</body></html>"
    out = builder._render_quality_pass(html, prompt="x", facts="", sources=[],
                                       model=builder._MODEL_BEST, username="u", community_id=1)
    assert out == html
    assert regen["n"] == 0 and rendered["n"] == 0


def test_vision_judge_coerce_verdict_clamps():
    from backend.services import vision_judge
    v = vision_judge._coerce_verdict({
        "render_ok": True, "design_score": 150, "data_verified": "MAYBE",
        "data_issues": ["a", "b", "c", "d", "e", "f"], "critique": ["x"]})
    assert v["design_score"] == 100
    assert v["data_verified"] == "na"
    assert len(v["data_issues"]) <= 5
    assert v["render_ok"] is True


def test_invalid_score_is_rejected(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation(cid, monkeypatch=monkeypatch)
    for bad in ("not-a-number", float("nan"), float("inf")):
        with pytest.raises(ValueError):
            builder.submit_score(creation_id=crid, community_id=cid, username="maker", value=bad)


# --- Async build jobs ---------------------------------------------------------
#
# The async builder is the durable, at-least-once-safe path: build/iterate
# enqueue a ``builder_jobs`` row and a worker runs generation later. These
# tests prove the reliability invariants that protect revenue + UX:
#   * exactly ONE ai_usage row per build turn (no double-charge on retries),
#   * an atomic claim so duplicate Cloud Tasks delivery cannot double-run,
#   * the completion notification fires exactly once,
#   * the entitlements gate / active-job / auth / ownership boundaries hold.

from flask import Flask  # noqa: E402

from backend.blueprints.builder import builder_bp  # noqa: E402
import backend.blueprints.builder as builder_bp_mod  # noqa: E402


def _count_usage_rows(username: str, *, surface: str = "builder", success=None) -> int:
    ph = get_sql_placeholder()
    where = [f"username = {ph}", f"surface = {ph}"]
    params = [username, surface]
    if success is not None:
        where.append(f"success = {ph}")
        params.append(1 if success else 0)
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT COUNT(*) AS n FROM ai_usage_log WHERE {' AND '.join(where)}", tuple(params))
        row = c.fetchone()
    if row is None:
        return 0
    return int(row["n"] if hasattr(row, "keys") else row[0])


def _set_job_raw(job_id: int, **cols) -> None:
    """Force builder_jobs columns directly so tests can fabricate states
    (e.g. an expired lease) that are tedious to reach through the worker."""
    ph = get_sql_placeholder()
    parts = ", ".join(f"{k} = {ph}" for k in cols)
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"UPDATE builder_jobs SET {parts} WHERE id = {ph}", (*cols.values(), job_id))
        conn.commit()


@pytest.fixture
def notify_recorder(monkeypatch):
    """Capture completion notifications without touching the notifications
    tables. Exercises the real ``_mark_notified`` gate (notify-once)."""
    calls = []
    monkeypatch.setattr(
        builder, "_notify_build_complete",
        lambda username, **kw: calls.append({"username": username, **kw}),
    )
    return calls


@pytest.fixture
def builder_client(monkeypatch):
    """Flask test client for the builder blueprint. Community access is
    stubbed (not under test here) and enqueue is a no-op recorder so the
    HTTP path never spawns a real generation thread."""
    monkeypatch.setattr(builder_bp_mod, "_can_access_community", lambda *_a, **_k: True)
    enqueued = []
    monkeypatch.setattr(builder, "enqueue_build_job", lambda jid: enqueued.append(jid) or False)
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(builder_bp)
    client = app.test_client()
    client._enqueued = enqueued  # type: ignore[attr-defined]
    return client


def _login(client, username: str) -> None:
    with client.session_transaction() as sess:
        sess["username"] = username


# ── P0: lifecycle, exactly-one usage, terminal failure, guards ──────────────

def test_create_job_persists_queued_row():
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    assert job["status"] == "queued"
    fetched = builder.get_build_job(int(job["id"]))
    assert fetched is not None
    assert fetched["username"] == "maker"
    assert int(fetched["community_id"]) == cid
    assert int(fetched["attempts"]) == 0
    assert fetched["kind"] == "create"


def test_run_build_job_create_success(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")

    out = builder.run_build_job(int(job["id"]))
    assert out["success"] is True

    fresh = builder.get_build_job(int(job["id"]))
    assert fresh["status"] == "succeeded"
    assert fresh["result_creation_id"]
    assert int(fresh["attempts"]) == 1
    assert fresh["started_at"] and fresh["finished_at"]
    # Lease released on terminal state.
    assert fresh["worker_token"] is None
    # Result points at a real creation owned by the maker.
    creation = builder.get_creation(int(fresh["result_creation_id"]))
    assert creation["created_by"] == "maker"


def test_run_build_job_iterate_success(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a quiz")

    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: "<!doctype html><html><body>v2</body></html>")
    job = builder.create_build_job(username="maker", community_id=cid, creation_id=int(created["id"]),
                                   prompt="make it neon", tier="balanced", kind="iterate")
    out = builder.run_build_job(int(job["id"]))
    assert out["success"] is True

    fresh = builder.get_build_job(int(job["id"]))
    assert fresh["status"] == "succeeded"
    assert int(fresh["result_creation_id"]) == int(created["id"])
    assert "v2" in builder.get_creation(int(created["id"]))["html_content"]


def test_run_build_job_logs_exactly_one_usage_row_on_success(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")

    builder.run_build_job(int(job["id"]))
    assert _count_usage_rows("maker", success=True) == 1
    assert _count_usage_rows("maker", success=False) == 0
    # Completion notification fired exactly once.
    assert len(notify_recorder) == 1
    assert notify_recorder[0].get("failed") in (None, False)


def test_run_build_job_terminal_failure_logs_one_block_row(monkeypatch, notify_recorder):
    def _boom(*a, **k):
        raise RuntimeError("model produced an invalid artifact")
    monkeypatch.setattr(builder.llm, "generate_text", _boom)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")

    out = builder.run_build_job(int(job["id"]))
    assert out["success"] is False
    assert out["transient"] is False  # terminal — Cloud Tasks should NOT retry

    fresh = builder.get_build_job(int(job["id"]))
    assert fresh["status"] == "failed"
    assert fresh["error"] == "build_failed"
    assert _count_usage_rows("maker", success=False) == 1
    assert _count_usage_rows("maker", success=True) == 0
    assert len(notify_recorder) == 1
    assert notify_recorder[0]["failed"] is True


def test_user_has_active_job_toggles(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    assert builder.user_has_active_job("maker") is True
    builder.run_build_job(int(job["id"]))
    assert builder.user_has_active_job("maker") is False


def test_blueprint_create_returns_409_when_active_job(builder_client):
    _make_user("maker")
    cid = _make_community()
    builder.create_build_job(username="maker", community_id=cid, prompt="first", tier="balanced")

    _login(builder_client, "maker")
    resp = builder_client.post("/api/builder/create", json={"community_id": cid, "prompt": "second"})
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "builder_job_active"


def test_internal_run_route_requires_secret(monkeypatch, builder_client, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    monkeypatch.setenv("BUILDER_JOB_SECRET", "s3cr3t")
    monkeypatch.delenv("CRON_SHARED_SECRET", raising=False)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    url = f"/api/internal/builder/jobs/{int(job['id'])}/run"

    assert builder_client.post(url).status_code == 403
    assert builder_client.post(url, headers={"X-Builder-Job-Secret": "wrong"}).status_code == 403
    ok = builder_client.post(url, headers={"X-Builder-Job-Secret": "s3cr3t"})
    assert ok.status_code == 200
    assert ok.get_json()["success"] is True


def test_job_get_returns_404_for_non_owner(builder_client):
    _make_user("maker")
    _make_user("intruder")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")

    _login(builder_client, "intruder")
    resp = builder_client.get(f"/api/builder/jobs/{int(job['id'])}")
    assert resp.status_code == 404


# ── P1: idempotency, notify-once, cap block, Cloud Tasks enqueue ────────────

def test_duplicate_worker_delivery_is_noop(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")

    first = builder.run_build_job(int(job["id"]))
    second = builder.run_build_job(int(job["id"]))  # Cloud Tasks redelivery

    assert first["success"] is True
    assert second.get("already_done") is True
    # No duplicate creation, no duplicate usage row, no duplicate notification.
    assert _count_usage_rows("maker", success=True) == 1
    assert len(notify_recorder) == 1


def test_concurrent_claim_returns_already_running(monkeypatch, notify_recorder):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    # Another worker already holds the job with a valid (future) lease.
    assert builder.claim_build_job(int(job["id"]), "other-worker", lease_seconds=600) is True

    out = builder.run_build_job(int(job["id"]))
    assert out.get("already_running") is True
    # The loser produced no side effects.
    assert _count_usage_rows("maker", success=True) == 0
    assert len(notify_recorder) == 0


def test_blueprint_create_logs_block_and_returns_402_when_gate_denies(monkeypatch, builder_client):
    # Force a denied gate (e.g. monthly cap reached) regardless of the
    # ENTITLEMENTS_ENFORCEMENT_ENABLED flag.
    monkeypatch.setattr(builder_bp_mod, "gate_builder_or_reason",
                        lambda *a, **k: (False, "builder_monthly_cap", {}))
    _make_user("capped")
    cid = _make_community()

    _login(builder_client, "capped")
    resp = builder_client.post("/api/builder/create", json={"community_id": cid, "prompt": "x"})
    assert resp.status_code == 402
    # One block row written via ai_usage.log_block (success=0).
    assert _count_usage_rows("capped", success=False) == 1
    # No job enqueued.
    assert builder_client._enqueued == []


def test_enqueue_build_job_cloud_tasks_path(monkeypatch):
    import sys
    import types

    monkeypatch.setenv("BUILDER_TASKS_QUEUE", "test-queue")
    monkeypatch.setenv("BUILDER_TASKS_LOCATION", "us-central1")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://test.example.com")
    monkeypatch.setenv("BUILDER_JOB_SECRET", "s3cr3t")

    created = []

    class FakeClient:
        def queue_path(self, project, location, queue):
            return f"projects/{project}/locations/{location}/queues/{queue}"

        def create_task(self, *, request):
            created.append(request)

    fake_tasks = types.ModuleType("google.cloud.tasks_v2")
    fake_tasks.CloudTasksClient = FakeClient
    fake_tasks.HttpMethod = types.SimpleNamespace(POST="POST")
    monkeypatch.setitem(sys.modules, "google.cloud.tasks_v2", fake_tasks)

    ok = builder.enqueue_build_job(4242)
    assert ok is True
    assert len(created) == 1
    task = created[0]["task"]["http_request"]
    assert task["url"].endswith("/api/internal/builder/jobs/4242/run")
    assert task["headers"]["X-Builder-Job-Secret"] == "s3cr3t"


# ── P2: reaper, retries, placeholder-bug regression ─────────────────────────

def test_sweep_requeues_stale_running_job(monkeypatch, notify_recorder):
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    jid = int(job["id"])
    # Simulate a crashed worker: running with an expired lease, attempts left.
    _set_job_raw(jid, status="running", attempts=1, max_attempts=3,
                 lease_expires_at="2000-01-01 00:00:00", worker_token="dead")
    requeued = []
    monkeypatch.setattr(builder, "enqueue_build_job", lambda j: requeued.append(j) or False)

    result = builder.sweep_build_jobs()
    assert result["requeued"] == 1 and result["failed"] == 0
    assert builder.get_build_job(jid)["status"] == "queued"
    assert requeued == [jid]


def test_sweep_fails_job_past_max_attempts(monkeypatch, notify_recorder):
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    jid = int(job["id"])
    _set_job_raw(jid, status="running", attempts=3, max_attempts=3,
                 lease_expires_at="2000-01-01 00:00:00", worker_token="dead")

    result = builder.sweep_build_jobs()
    assert result["failed"] == 1 and result["requeued"] == 0
    fresh = builder.get_build_job(jid)
    assert fresh["status"] == "failed"
    assert fresh["error"] == "build_timed_out"
    # One block row + one failure notification.
    assert _count_usage_rows("maker", success=False) == 1
    assert len(notify_recorder) == 1 and notify_recorder[0]["failed"] is True


def test_failed_job_can_be_retried(monkeypatch, notify_recorder):
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    jid = int(job["id"])

    def _boom(*a, **k):
        raise RuntimeError("transient-free terminal error")
    monkeypatch.setattr(builder.llm, "generate_text", _boom)
    builder.run_build_job(jid)
    assert builder.get_build_job(jid)["status"] == "failed"

    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    builder.run_build_job(jid)  # failed jobs are re-claimable
    fresh = builder.get_build_job(jid)
    assert fresh["status"] == "succeeded"
    assert int(fresh["attempts"]) == 2
    # One failure row + one success row.
    assert _count_usage_rows("maker", success=False) == 1
    assert _count_usage_rows("maker", success=True) == 1


def test_set_job_status_handles_question_mark_in_value():
    _make_user("maker")
    cid = _make_community()
    job = builder.create_build_job(username="maker", community_id=cid, prompt="a quiz", tier="balanced")
    jid = int(job["id"])
    # Regression: the old replace('?', ph) corrupted any value with a '?'.
    builder._set_job_status(jid, "failed", error="why? because the model said so?", finished=True)
    fresh = builder.get_build_job(jid)
    assert fresh["status"] == "failed"
    assert fresh["error"] == "why? because the model said so?"


# ── CPoint persistence: save slots (save_record / load_record) ──────────────
#
# Save slots are how generated games keep progress: localStorage is blocked in
# the sandbox, so CPoint.save/load is brokered to these service + route paths.
# These tests pin the key-normalization contract (so common slot names stay
# distinct) and the per-user scoping that keeps one player's save private.

def _make_creation(username: str, community_id: int, monkeypatch) -> int:
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    created = builder.create_creation(username=username, community_id=community_id, prompt="a game")
    return int(created["id"])


def test_save_then_load_roundtrip(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)

    builder.save_record(creation_id=crid, community_id=cid, username="maker",
                        key="slot-1", value={"level": 2, "hp": 80})
    loaded = builder.load_record(crid, username="maker", key="slot-1")
    assert loaded["success"] is True
    assert loaded["value"] == {"level": 2, "hp": 80}


def test_multiple_save_slots_do_not_overwrite(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)

    builder.save_record(creation_id=crid, community_id=cid, username="maker",
                        key="slot-1", value={"level": 1})
    builder.save_record(creation_id=crid, community_id=cid, username="maker",
                        key="slot-2", value={"level": 9})

    assert builder.load_record(crid, username="maker", key="slot-1")["value"] == {"level": 1}
    assert builder.load_record(crid, username="maker", key="slot-2")["value"] == {"level": 9}


def test_save_slots_are_user_scoped(monkeypatch):
    _make_user("alice")
    _make_user("bob")
    cid = _make_community()
    crid = _make_creation("alice", cid, monkeypatch)

    builder.save_record(creation_id=crid, community_id=cid, username="alice",
                        key="slot-1", value={"secret": "alice-only"})
    # Bob, even if he can see the creation, has his own (empty) save namespace.
    assert builder.load_record(crid, username="bob", key="slot-1")["value"] is None


def test_save_key_normalization_keeps_common_slots_distinct():
    # The contract: common generated slot names survive normalization instead
    # of collapsing to a single bucket (the old bug folded everything to
    # 'highscore'). Whitespace -> '_', lowercased, save fallback = 'save'.
    assert builder._safe_save_key("slot-1") == "slot-1"
    assert builder._safe_save_key("slot_1") == "slot_1"
    assert builder._safe_save_key("saveSlot1") == "saveslot1"
    assert builder._safe_save_key("save slot 1") == "save_slot_1"
    assert builder._safe_save_key("level:3") == "level:3"
    # Distinct slot names stay distinct.
    keys = {builder._safe_save_key(k) for k in ("slot-1", "slot-2", "settings")}
    assert keys == {"slot-1", "slot-2", "settings"}
    # Empty / junk falls back to 'save', never 'highscore'.
    assert builder._safe_save_key("") == "save"
    assert builder._safe_save_key("***") == "save"
    assert builder._safe_save_key(None) == "save"


def test_save_record_roundtrips_under_normalized_keys(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)

    # Saving under the raw name and loading under the same raw name resolves to
    # the same normalized row.
    builder.save_record(creation_id=crid, community_id=cid, username="maker",
                        key="save slot 1", value={"checkpoint": "A"})
    assert builder.load_record(crid, username="maker", key="save slot 1")["value"] == {"checkpoint": "A"}
    # A genuinely different slot does not collide.
    builder.save_record(creation_id=crid, community_id=cid, username="maker",
                        key="save slot 2", value={"checkpoint": "B"})
    assert builder.load_record(crid, username="maker", key="save slot 1")["value"] == {"checkpoint": "A"}
    assert builder.load_record(crid, username="maker", key="save slot 2")["value"] == {"checkpoint": "B"}


def test_save_too_large_is_rejected(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)

    huge = "x" * (builder._SAVE_MAX_BYTES + 1)
    with pytest.raises(ValueError, match="save_too_large"):
        builder.save_record(creation_id=crid, community_id=cid, username="maker",
                            key="slot-1", value=huge)


def test_too_many_save_slots_is_rejected(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)

    for i in range(builder._SAVE_MAX_KEYS):
        builder.save_record(creation_id=crid, community_id=cid, username="maker",
                            key=f"slot-{i}", value={"i": i})
    with pytest.raises(ValueError, match="too_many_saves"):
        builder.save_record(creation_id=crid, community_id=cid, username="maker",
                            key="slot-overflow", value={"i": 99})
    # Overwriting an existing slot still works at the cap (no new row).
    builder.save_record(creation_id=crid, community_id=cid, username="maker",
                        key="slot-0", value={"i": 0, "again": True})
    assert builder.load_record(crid, username="maker", key="slot-0")["value"] == {"i": 0, "again": True}


# ── CPoint persistence: HTTP routes (/data/save, /data/load) ────────────────

def test_route_save_and_load_roundtrip(builder_client, monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    _login(builder_client, "maker")

    resp = builder_client.post(f"/api/builder/{crid}/data/save",
                               json={"key": "slot-1", "value": {"level": 3}})
    assert resp.status_code == 200 and resp.get_json()["success"] is True

    resp = builder_client.get(f"/api/builder/{crid}/data/load?key=slot-1")
    body = resp.get_json()
    assert resp.status_code == 200 and body["success"] is True
    assert body["value"] == {"level": 3}


def test_route_load_defaults_to_save_key(builder_client, monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    _login(builder_client, "maker")

    builder_client.post(f"/api/builder/{crid}/data/save", json={"value": {"a": 1}})
    body = builder_client.get(f"/api/builder/{crid}/data/load").get_json()
    assert body["success"] is True and body["value"] == {"a": 1}


def test_route_save_requires_auth(builder_client, monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    # No _login → no session username.
    resp = builder_client.post(f"/api/builder/{crid}/data/save",
                               json={"key": "slot-1", "value": {"level": 3}})
    assert resp.status_code == 401
    assert resp.get_json()["error"] == "auth_required"


def test_route_save_denied_for_inaccessible_creation(builder_client, monkeypatch):
    _make_user("maker")
    _make_user("stranger")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    # Stranger is not the owner and cannot access the community.
    monkeypatch.setattr(builder_bp_mod, "_can_access_community", lambda *_a, **_k: False)
    _login(builder_client, "stranger")

    resp = builder_client.post(f"/api/builder/{crid}/data/save",
                               json={"key": "slot-1", "value": {"x": 1}})
    assert resp.status_code == 404
    assert resp.get_json()["error"] == "not_found"


def test_route_oversized_save_returns_save_too_large(builder_client, monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    _login(builder_client, "maker")

    huge = "x" * (builder._SAVE_MAX_BYTES + 1)
    resp = builder_client.post(f"/api/builder/{crid}/data/save",
                               json={"key": "slot-1", "value": huge})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "save_too_large"


# ── CPoint creation data runtime: shared state / collections / forms ─────────

def test_route_shared_state_roundtrip_and_version_conflict(builder_client, monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    _login(builder_client, "maker")

    resp = builder_client.post(f"/api/builder/{crid}/data/shared",
                               json={"key": "poll", "value": {"yes": 1}, "version": 0})
    body = resp.get_json()
    assert resp.status_code == 200 and body["value"] == {"yes": 1}
    assert body["version"] == 1

    loaded = builder_client.get(f"/api/builder/{crid}/data/shared?key=poll").get_json()
    assert loaded["success"] is True and loaded["value"] == {"yes": 1}

    conflict = builder_client.post(f"/api/builder/{crid}/data/shared",
                                   json={"key": "poll", "value": {"yes": 2}, "version": 0})
    assert conflict.status_code == 409
    assert conflict.get_json()["error"] == "version_conflict"


def test_route_collection_crud_and_form_submit(builder_client, monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    _login(builder_client, "maker")

    created = builder_client.post(f"/api/builder/{crid}/data/collection/tasks",
                                  json={"value": {"title": "Ship runtime", "done": False}})
    assert created.status_code == 200
    item = created.get_json()["item"]
    assert item["id"] and item["version"] == 1

    listed = builder_client.get(f"/api/builder/{crid}/data/collection/tasks").get_json()
    assert listed["success"] is True
    assert listed["items"][0]["value"]["title"] == "Ship runtime"

    updated = builder_client.patch(
        f"/api/builder/{crid}/data/collection/tasks/{item['id']}",
        json={"value": {"title": "Ship runtime", "done": True}, "version": 1},
    )
    assert updated.status_code == 200
    assert updated.get_json()["item"]["value"]["done"] is True

    submitted = builder_client.post(f"/api/builder/{crid}/data/forms/feedback/submit",
                                    json={"value": {"message": "Looks good"}})
    assert submitted.status_code == 200
    assert submitted.get_json()["submitted"] is True

    deleted = builder_client.delete(f"/api/builder/{crid}/data/collection/tasks/{item['id']}")
    assert deleted.status_code == 200
    assert deleted.get_json()["deleted"] is True


def test_creation_runtime_service_rejects_stale_shared_version(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    creation_runtime.update_shared_state(
        creation_id=crid, community_id=cid, username="maker",
        key="main", value={"count": 1}, expected_version=0,
    )
    with pytest.raises(ValueError, match="version_conflict"):
        creation_runtime.update_shared_state(
            creation_id=crid, community_id=cid, username="maker",
            key="main", value={"count": 2}, expected_version=0,
        )


# ── CPoint persistence: delete builds ────────────────────────────────────────

def _count_rows(table: str, where: str, params: tuple) -> int:
    ph = get_sql_placeholder()
    assert ph in where
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}", params)
        row = c.fetchone()
    return int(builder._cell(row, 0) or 0)


def test_delete_creation_removes_artifact_data_post_and_jobs(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    builder.save_record(creation_id=crid, community_id=cid, username="maker",
                        key="slot-1", value={"level": 1})
    builder.save_record(creation_id=crid, community_id=cid, username="maker",
                        key="slot-2", value={"level": 2})
    builder.create_build_job(username="maker", community_id=cid, prompt="make it harder",
                             tier="balanced", kind="iterate", creation_id=crid)
    published = builder.publish_creation(creation_id=crid, username="maker", caption="play this")
    post_id = int(published["post_id"])

    result, status = builder.delete_creation("maker", crid)
    assert status == 200
    assert result["success"] is True
    assert builder.get_creation(crid) is None

    ph = get_sql_placeholder()
    assert _count_rows("creation_data", f"creation_id = {ph}", (crid,)) == 0
    assert _count_rows("builder_jobs", f"creation_id = {ph}", (crid,)) == 0
    assert _count_rows("posts", f"id = {ph}", (post_id,)) == 0


def test_delete_creation_non_owner_is_non_enumerating(monkeypatch):
    _make_user("maker")
    _make_user("stranger")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)

    result, status = builder.delete_creation("stranger", crid)
    assert status == 404
    assert result["error"] == "not_found"
    assert builder.get_creation(crid) is not None


def test_route_delete_creation_requires_auth(builder_client, monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)

    resp = builder_client.delete(f"/api/builder/{crid}")
    assert resp.status_code == 401
    assert resp.get_json()["error"] == "auth_required"


def test_route_delete_creation_owner_success(builder_client, monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    builder.save_record(creation_id=crid, community_id=cid, username="maker",
                        key="slot-1", value={"level": 4})
    _login(builder_client, "maker")

    resp = builder_client.delete(f"/api/builder/{crid}")
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True
    assert builder.get_creation(crid) is None


# ── CPoint public feeds: brokered, cached, defensive connectors ──────────────

class _FakeFeedCache:
    def __init__(self):
        self.values = {}

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value, ttl=60):
        self.values[key] = value
        return True

    def delete(self, key):
        self.values.pop(key, None)
        return True

    def incr(self, key, ttl=60):
        self.values[key] = int(self.values.get(key) or 0) + 1
        return self.values[key]


def test_feed_unknown_connector_rejected():
    assert builder_feeds.fetch_feed("not-real", {})["error"] == "unknown_connector"


def test_feed_weather_normalizes_and_caches(monkeypatch):
    fake_cache = _FakeFeedCache()
    monkeypatch.setattr(builder_feeds, "_cache", lambda: fake_cache)
    calls = []

    def fake_json(url, *, params=None):
        calls.append((url, params))
        if "geocoding" in url:
            return {"results": [{"name": "Lisbon", "country": "Portugal", "latitude": 38.72, "longitude": -9.14}]}
        return {
            "current_weather": {"temperature": 22, "weathercode": 1},
            "daily": {
                "time": ["2026-06-21"],
                "weather_code": [1],
                "temperature_2m_max": [26],
                "temperature_2m_min": [18],
                "precipitation_probability_max": [10],
            },
        }

    monkeypatch.setattr(builder_feeds, "_http_get_json", fake_json)

    first = builder_feeds.fetch_feed("weather", {"place": "Lisbon"})
    second = builder_feeds.fetch_feed("weather", {"place": "Lisbon"})

    assert first["success"] is True
    assert first["data"]["location"]["name"] == "Lisbon, Portugal"
    assert first["data"]["daily"][0]["tempMaxC"] == 26
    assert second["cached"] is True
    assert len(calls) == 2  # geocode + forecast once; second result came from cache


def test_feed_budget_serves_stale(monkeypatch):
    fake_cache = _FakeFeedCache()
    stale = {"success": True, "connector": "sports", "data": {"events": []}, "attribution": "Data by TheSportsDB"}
    fake_cache.set(builder_feeds._stale_key("sports", {"day": "2026-06-21"}), stale)
    monkeypatch.setattr(builder_feeds, "_cache", lambda: fake_cache)
    spec = builder_feeds.CONNECTORS["sports"]
    monkeypatch.setitem(builder_feeds.CONNECTORS, "sports", builder_feeds.Connector(
        ttl=spec.ttl, stale_ttl=spec.stale_ttl, budget_limit=0,
        attribution=spec.attribution, fetch=spec.fetch,
    ))

    out = builder_feeds.fetch_feed("sports", {"day": "2026-06-21"})
    assert out["success"] is True
    assert out["stale"] is True
    assert out["degraded"] == "budget_exceeded"
    monkeypatch.setitem(builder_feeds.CONNECTORS, "sports", spec)


def test_feed_sports_normalizes_fixtures(monkeypatch):
    monkeypatch.setattr(builder_feeds, "_cache", lambda: None)
    monkeypatch.setattr(builder_feeds, "_http_get_json", lambda *_a, **_k: {
        "events": [{
            "idEvent": "1", "dateEvent": "2026-06-21", "strLeague": "World Cup",
            "strHomeTeam": "Portugal", "strAwayTeam": "Germany",
            "intHomeScore": "2", "intAwayScore": "1", "strStatus": "Match Finished",
        }]
    })

    out = builder_feeds.fetch_feed("sports", {"day": "2026-06-21"})
    assert out["success"] is True
    assert out["data"]["events"][0]["homeTeam"] == "Portugal"
    assert out["data"]["events"][0]["homeScore"] == "2"


def test_feed_route_requires_auth(builder_client, monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)

    resp = builder_client.get(f"/api/builder/{crid}/data/feed?connector=weather&params=%7B%7D")
    assert resp.status_code == 401


def test_feed_route_owner_success(builder_client, monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    monkeypatch.setattr(builder_bp_mod, "_data_read_ok", lambda *_a, **_k: True)
    monkeypatch.setattr(builder_bp_mod.builder_feeds, "fetch_feed", lambda connector, params, *, refresh=False: {
        "success": True, "connector": connector, "data": {**params, "refresh": refresh}, "attribution": "Test",
    })
    _login(builder_client, "maker")

    resp = builder_client.get(f"/api/builder/{crid}/data/feed?connector=weather&params=%7B%22place%22%3A%22Lisbon%22%7D")
    body = resp.get_json()
    assert resp.status_code == 200
    assert body["success"] is True
    assert body["connector"] == "weather"
    assert body["data"]["place"] == "Lisbon"
    assert body["data"]["refresh"] is False


def test_feed_route_personal_creation_supports_refresh(builder_client, monkeypatch):
    _make_user("maker")
    crid = _make_creation("maker", None, monkeypatch)
    monkeypatch.setattr(builder_bp_mod, "_data_read_ok", lambda *_a, **_k: True)
    seen = {}

    def fake_fetch(connector, params, *, refresh=False):
        seen["connector"] = connector
        seen["params"] = params
        seen["refresh"] = refresh
        return {"success": True, "connector": connector, "data": params, "attribution": "Test", "refreshed": refresh}

    monkeypatch.setattr(builder_bp_mod.builder_feeds, "fetch_feed", fake_fetch)
    _login(builder_client, "maker")

    resp = builder_client.get(
        f"/api/builder/{crid}/data/feed?connector=sports&refresh=1&params=%7B%22day%22%3A%222026-06-21%22%7D"
    )
    body = resp.get_json()

    assert resp.status_code == 200
    assert body["success"] is True
    assert body["refreshed"] is True
    assert seen == {"connector": "sports", "params": {"day": "2026-06-21"}, "refresh": True}


def test_capsule_route_owner_executes_stored_recipe_with_refresh(builder_client, monkeypatch):
    html = """<!doctype html><html><body>
    <script type="application/json" id="cpoint-capsule-recipes">
      [{"name":"worldcup-fixtures","engine":"feed","connector":"sports","params":{"day":"2026-06-21","sport":"Soccer"},"public":true}]
    </script>
    </body></html>"""
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: html)
    _make_user("maker")
    created = builder.create_creation(username="maker", community_id=None, prompt="a personal world cup app")
    crid = int(created["id"])
    monkeypatch.setattr(builder_bp_mod, "_data_read_ok", lambda *_a, **_k: True)
    seen = {}

    def fake_fetch(connector, params, *, refresh=False):
        seen["connector"] = connector
        seen["params"] = params
        seen["refresh"] = refresh
        return {"success": True, "connector": connector, "data": {"events": []}, "attribution": "Test sports"}

    monkeypatch.setattr(builder_bp_mod.builder_capsules.builder_feeds, "fetch_feed", fake_fetch)
    _login(builder_client, "maker")

    resp = builder_client.get(f"/api/builder/{crid}/capsules/worldcup-fixtures?refresh=1")
    body = resp.get_json()

    assert resp.status_code == 200
    assert body["success"] is True
    assert body["capsule"] == "worldcup-fixtures"
    assert body["refreshApplied"] is True
    assert body["source"] == "sports"
    assert "lastUpdated" in body
    assert seen == {"connector": "sports", "params": {"day": "2026-06-21", "sport": "Soccer"}, "refresh": True}


def test_public_capsule_route_requires_public_recipe_and_strips_refresh(builder_client, monkeypatch):
    html = """<!doctype html><html><body>
    <script type="application/json" id="cpoint-capsule-recipes">
      [
        {"name":"public-scores","engine":"feed","connector":"sports","params":{"day":"2026-06-21"},"public":true},
        {"name":"private-scores","engine":"feed","connector":"sports","params":{"day":"2026-06-22"},"public":false}
      ]
    </script>
    </body></html>"""
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: html)
    monkeypatch.setattr(r2_storage, "upload_public_bytes_to_r2", lambda *_a, **_k: True)
    monkeypatch.setattr(builder_bp_mod, "_public_data_read_ok", lambda *_a, **_k: True)
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a public world cup app")
    published = builder.publish_creation_to_web(creation_id=created["id"], username="maker")
    seen = {}

    def fake_fetch(connector, params, *, refresh=False):
        seen["refresh"] = refresh
        return {"success": True, "connector": connector, "data": params, "attribution": "Test sports"}

    monkeypatch.setattr(builder_bp_mod.builder_capsules.builder_feeds, "fetch_feed", fake_fetch)

    public_resp = builder_client.get(f"/api/builder/public/{published['public_slug']}/capsules/public-scores?refresh=1")
    private_resp = builder_client.get(f"/api/builder/public/{published['public_slug']}/capsules/private-scores")

    assert public_resp.status_code == 200
    assert public_resp.get_json()["refreshApplied"] is False
    assert seen["refresh"] is False
    assert private_resp.status_code == 404


def test_feed_route_read_rate_limited(builder_client, monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    monkeypatch.setattr(builder_bp_mod, "_data_read_ok", lambda *_a, **_k: False)
    _login(builder_client, "maker")

    resp = builder_client.get(f"/api/builder/{crid}/data/feed?connector=weather&params=%7B%7D")
    assert resp.status_code == 429
    assert resp.get_json()["error"] == "rate_limited"


# ── R2 artifact storage: dual-read, delete cleanup, backfill ─────────────────

def test_create_creation_uses_r2_key_when_upload_succeeds(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    monkeypatch.setattr(builder, "store_artifact_html", lambda creation_id, html, *, updated_at=None: f"private/creations/{creation_id}/x.html")
    monkeypatch.setattr(builder, "load_artifact_html", lambda creation_id, key, *, updated_at=None: _FAKE_HTML)
    _make_user("maker")
    cid = _make_community()

    created = builder.create_creation(username="maker", community_id=cid, prompt="a game")
    row = builder.get_creation(int(created["id"]))

    assert row["html_r2_key"].endswith("/x.html")
    assert row["html_content"] == _FAKE_HTML


def test_iterate_creation_clears_old_r2_key_when_upload_fails(monkeypatch):
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _FAKE_HTML)
    monkeypatch.setattr(builder, "store_artifact_html", lambda creation_id, html, *, updated_at=None: "private/old.html")
    monkeypatch.setattr(builder, "load_artifact_html", lambda creation_id, key, *, updated_at=None: _FAKE_HTML)
    deleted = []
    monkeypatch.setattr(builder, "delete_artifact_html", lambda key, **_k: deleted.append(key))
    _make_user("maker")
    cid = _make_community()
    created = builder.create_creation(username="maker", community_id=cid, prompt="a game")

    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: "<!doctype html><html><body>v2</body></html>")
    monkeypatch.setattr(builder, "store_artifact_html", lambda creation_id, html, *, updated_at=None: None)
    updated = builder.iterate_creation(creation_id=int(created["id"]), username="maker", message="v2")
    row = builder.get_creation(int(created["id"]))

    assert "v2" in updated["html"]
    assert row["html_r2_key"] is None
    assert "v2" in row["html_content"]
    assert deleted == ["private/old.html"]


def test_delete_creation_removes_r2_artifact(monkeypatch):
    _make_user("maker")
    cid = _make_community()
    crid = _make_creation("maker", cid, monkeypatch)
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"UPDATE creations SET html_r2_key = {ph} WHERE id = {ph}", ("private/creations/test.html", crid))
        conn.commit()
    deleted = []
    monkeypatch.setattr(builder, "delete_artifact_html", lambda key, **kw: deleted.append((key, kw)))

    result, status = builder.delete_creation("maker", crid)

    assert status == 200 and result["success"] is True
    assert deleted and deleted[0][0] == "private/creations/test.html"


def test_r2_backfill_is_idempotent(monkeypatch):
    from scripts import backfill_builder_artifacts_to_r2

    _make_user("maker")
    cid = _make_community()
    monkeypatch.setattr(builder, "store_artifact_html", lambda creation_id, html, *, updated_at=None: None)
    crid = _make_creation("maker", cid, monkeypatch)
    monkeypatch.setattr(builder, "store_artifact_html", lambda creation_id, html, *, updated_at=None: f"private/creations/{creation_id}/backfilled.html")

    migrated = backfill_builder_artifacts_to_r2.run(limit=10)
    migrated_again = backfill_builder_artifacts_to_r2.run(limit=10)
    row = builder.get_creation(crid)

    assert migrated == 1
    assert migrated_again == 0
    assert row["html_r2_key"].endswith("backfilled.html")
