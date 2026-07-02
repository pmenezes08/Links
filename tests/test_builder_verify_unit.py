"""Pure-unit tests (no DB/Docker) for the headless-verify pass's CPoint bridge
stub and the multiplayer-wiring repair guards.

Background: the real window.CPoint is injected by the client play surface at
play time, so the render worker never has it. Without a stub, a guide-compliant
multiplayer build renders blank in verification and the render-fix repair
"fixes" it by stripping the CPoint.turnBasedGame wiring — the artifact then
deploys and plays solo, but a challenge to another member never starts.
"""

from backend.services import builder

_MP_HTML = ("<!doctype html><html><head><title>Chess</title></head><body>"
            "<div id=\"app\"></div><script>"
            "if (window.CPoint && window.CPoint.hasTurnBasedGame) {"
            "  CPoint.turnBasedGame({root:'#app',render:function(){}});"
            "}</script></body></html>")


def test_with_render_stub_injects_bridge_before_artifact_scripts():
    out = builder._with_render_stub(_MP_HTML)
    assert "window.CPoint" in out and "turnBasedGame=function" in out
    # Stub lands at head start, before any artifact script runs.
    assert out.index("cpoint-render-stub") < out.index("hasTurnBasedGame) {")
    # No <head>: injected right after <html>; no <html> at all: prepended.
    assert "window.CPoint" in builder._with_render_stub("<html><body>x</body></html>")
    assert builder._with_render_stub("<body>x</body>").startswith("<script>")


def test_stub_advertises_the_full_bridge_contract():
    """The stub must mirror the client bridge's feature flags and APIs — a
    game feature-detecting any of these must take its real code path under
    verification (client source of truth: client/src/utils/creationHtml.ts)."""
    stub = builder._RENDER_CPOINT_STUB
    for anchor in (
        "hasTurnBasedGame=true", "hasMultiplayer=true", "hasMatchController=true",
        "hasPersistence=true", "hasData=true", "hasCreationData=true",
        "hostLobby=false", "startMatchId=null",
        "turnBasedGame=function", "matchController=function",
        "getLeaderboard", "sharedState", "collection", "gameOver",
    ):
        assert anchor in stub, f"stub missing bridge anchor: {anchor}"


def test_render_quality_pass_renders_with_cpoint_stub(monkeypatch):
    """The HTML actually posted to the render service carries the bridge stub;
    the artifact itself ships unstubbed."""
    from backend.services import render_service, vision_judge
    monkeypatch.setattr(render_service, "is_configured", lambda: True)
    seen = {}

    def fake_render(html, **k):
        seen["html"] = html
        return {"screenshot": "img", "console_errors": [], "blank": False,
                "overflow": False, "dimensions": {}}

    monkeypatch.setattr(render_service, "render", fake_render)
    monkeypatch.setattr(vision_judge, "judge", lambda *a, **k: {
        "render_ok": True, "design_score": 90, "data_verified": "na",
        "data_issues": [], "critique": []})
    out = builder._render_quality_pass(_MP_HTML, prompt="chess", facts="", sources=[],
                                       model=builder._MODEL_FAST, username="u", community_id=1)
    assert "cpoint-render-stub" in seen["html"]
    assert "cpoint-render-stub" not in out  # shipped artifact is the original


def test_repair_regen_discards_repair_that_strips_multiplayer_wiring(monkeypatch):
    """A 'fixed' artifact that no longer calls turnBasedGame deploys and plays
    solo but can never start a match — such a repair must be discarded."""
    prompts = {}

    def fake_gen(system, user, **k):
        prompts["user"] = user
        return "<!doctype html><html><body>solo chess, wiring stripped</body></html>"

    monkeypatch.setattr(builder.llm, "generate_text", fake_gen)
    out = builder._repair_regen(_MP_HTML, builder._MODEL_FAST, "fix the blank page")
    assert out is None
    # The repair prompt itself warns the model the platform provides CPoint.
    assert "NEVER the bug" in prompts["user"]


def test_repair_regen_accepts_repair_that_preserves_multiplayer_wiring(monkeypatch):
    fixed = _MP_HTML.replace("<title>Chess</title>", "<title>Chess Fixed</title>")
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: fixed)
    out = builder._repair_regen(_MP_HTML, builder._MODEL_FAST, "fix the layout")
    assert out == fixed


def test_repair_regen_leaves_non_multiplayer_repairs_alone(monkeypatch):
    """Solo artifacts keep the existing behaviour: no preserve clause, any
    valid document is accepted."""
    prompts = {}

    def fake_gen(system, user, **k):
        prompts["user"] = user
        return "<!doctype html><html><body>fixed solo app</body></html>"

    monkeypatch.setattr(builder.llm, "generate_text", fake_gen)
    out = builder._repair_regen("<!doctype html><html><body>broken</body></html>",
                                builder._MODEL_FAST, "fix it")
    assert out and "fixed solo app" in out
    assert "NEVER the bug" not in prompts["user"]


def test_clean_html_slices_prose_around_the_document():
    """Browsers paint text outside <html> as page content, so narration around
    the document used to ship as visible UI text inside the app."""
    doc = "<!doctype html><html><body>the game</body></html>"
    assert builder._clean_html("Sure — here's the updated game: " + doc) == doc
    assert builder._clean_html(doc + "\n\nI changed the collision logic and added a leaderboard.") == doc
    assert builder._clean_html("Here you go!\n```html\n" + doc + "\n```\nEnjoy!") == doc
    assert builder._clean_html(doc) == doc
    # <html> without a doctype still anchors the slice.
    bare = "<html><body>x</body></html>"
    assert builder._clean_html("note first " + bare) == bare
    # No document markers at all: pass through (downstream checks handle it).
    assert builder._clean_html("just some text") == "just some text"
    assert builder._clean_html("") == ""


def test_artifact_meta_lint_flags_commentary_not_product_copy():
    def wrap(body):
        return f"<!doctype html><html><body>{body}</body></html>"

    # Build commentary rendered as visible text -> flagged.
    assert builder._artifact_meta_lint(wrap("<p>I've updated the scoring logic as requested.</p>"))
    assert builder._artifact_meta_lint(wrap("<div>In this update: faster ball</div>"))
    assert builder._artifact_meta_lint(wrap("stray fence ``` in the body"))
    # Legitimate product copy -> clean.
    assert not builder._artifact_meta_lint(wrap("<h2>How to Play</h2><p>Tap a piece, then its destination.</p>"))
    assert not builder._artifact_meta_lint(wrap("<h1>TODO List</h1><p>Add your first task</p>"))
    # Markers inside script/style/comments are NOT visible text -> clean.
    assert not builder._artifact_meta_lint(wrap("<script>var s=\"I've updated\";</script>ok"))
    assert not builder._artifact_meta_lint(wrap("<!-- I've updated this file -->ok"))


def test_meta_text_leak_triggers_one_repair(monkeypatch):
    """A build whose visible UI contains commentary gets exactly one cleanup
    regen; a clean build generates once."""
    monkeypatch.setattr(builder.llm, "web_search_text", lambda *a, **k: "NONE")
    dirty = ("<!doctype html><html><body><p>I've updated the game as requested!</p>"
             "<div id=\"game\"></div></body></html>")
    clean = "<!doctype html><html><body><div id=\"game\">pong</div></body></html>"
    calls = {"n": 0}

    def fake_gen(*a, **k):
        calls["n"] += 1
        return dirty if calls["n"] == 1 else clean

    monkeypatch.setattr(builder.llm, "generate_text", fake_gen)
    out = builder.generate_artifact("a pong game")
    assert calls["n"] == 2
    assert out == clean

    calls["n"] = 0
    monkeypatch.setattr(builder.llm, "generate_text",
                        lambda *a, **k: calls.__setitem__("n", calls["n"] + 1) or clean)
    assert builder.generate_artifact("a pong game") == clean
    assert calls["n"] == 1


def test_iteration_prompt_forbids_visible_change_notes(monkeypatch):
    monkeypatch.setattr(builder.llm, "web_search_text", lambda *a, **k: "NONE")
    seen = {}

    def fake_gen(system, user, **k):
        seen["user"] = user
        return "<!doctype html><html><body>v2</body></html>"

    monkeypatch.setattr(builder.llm, "generate_text", fake_gen)
    builder.generate_artifact("make the ball faster",
                              prior_html="<!doctype html><html><body>v1</body></html>")
    assert "never inside" in seen["user"]
    assert "told about changes in chat" in seen["user"]


_GOOD_SHOT = {"screenshot": "img", "console_errors": [], "blank": False,
              "overflow": False, "dimensions": {}}
_GOOD_VERDICT = {"render_ok": True, "design_score": 90, "data_verified": "na",
                 "data_issues": [], "critique": [], "responsive_ok": True}


def _quality_pass(monkeypatch, *, model, kind="", score=90, critique=None,
                  responsive_ok=True, repaired="", accept_shot=None):
    """Run _render_quality_pass with everything faked; returns (out, spies)."""
    from backend.services import render_service, vision_judge
    spies = {"renders": [], "judge_kind": None, "regens": 0}
    monkeypatch.setattr(render_service, "is_configured", lambda: True)

    # The pass injects the CPoint stub into what it renders, so match the
    # repaired artifact by its body content, not the whole string.
    marker = ""
    if repaired and "<body>" in repaired:
        marker = repaired.split("<body>", 1)[1].split("</body>", 1)[0]

    def fake_render(html, **k):
        spies["renders"].append({"width": k.get("width", 420), "html": html})
        if accept_shot is not None and marker and marker in html:
            return accept_shot
        return dict(_GOOD_SHOT)

    monkeypatch.setattr(render_service, "render", fake_render)

    def fake_judge(images, **k):
        spies["judge_kind"] = k.get("kind")
        return {**_GOOD_VERDICT, "design_score": score,
                "critique": list(critique or []), "responsive_ok": responsive_ok}

    monkeypatch.setattr(vision_judge, "judge", fake_judge)
    monkeypatch.setattr(builder, "_repair_regen", lambda h, m, i, timeout=None: (
        spies.__setitem__("regens", spies["regens"] + 1) or (repaired or None)))
    out = builder._render_quality_pass(
        "<!doctype html><html><body>original</body></html>",
        prompt="x", facts="", sources=[], model=model, username="u",
        community_id=1, kind=kind)
    return out, spies


def test_balanced_tier_refines_below_threshold(monkeypatch):
    fixed_html = "<!doctype html><html><body>refined</body></html>"
    out, spies = _quality_pass(monkeypatch, model=builder._MODEL_MID, kind="app",
                               score=60, critique=["tighten spacing"], repaired=fixed_html)
    assert spies["regens"] == 1
    assert out == fixed_html  # acceptance re-render was clean → accepted


def test_balanced_tier_does_not_refine_at_or_above_threshold(monkeypatch):
    out, spies = _quality_pass(monkeypatch, model=builder._MODEL_MID, kind="app",
                               score=builder._DESIGN_REFINE_THRESHOLD_BALANCED,
                               critique=["nit"], repaired="<html><body>r</body></html>")
    assert spies["regens"] == 0
    assert "original" in out


def test_fast_tier_never_refines(monkeypatch):
    out, spies = _quality_pass(monkeypatch, model=builder._MODEL_FAST, kind="app",
                               score=10, critique=["everything"], repaired="<html><body>r</body></html>")
    assert spies["regens"] == 0
    assert "original" in out


def test_refine_discarded_when_acceptance_render_breaks(monkeypatch):
    broken = "<!doctype html><html><body>refined-broken</body></html>"
    blank_shot = {"screenshot": "img", "console_errors": ["pageerror: boom"],
                  "blank": True, "overflow": False, "dimensions": {}}
    out, spies = _quality_pass(monkeypatch, model=builder._MODEL_BEST, kind="website",
                               score=50, critique=["fix hero"], repaired=broken,
                               accept_shot=blank_shot)
    assert spies["regens"] == 1
    assert "original" in out  # broken refine never ships


def test_desktop_render_only_for_websites_and_apps(monkeypatch):
    _, spies = _quality_pass(monkeypatch, model=builder._MODEL_FAST, kind="website")
    assert any(r["width"] == 1280 for r in spies["renders"])
    assert spies["judge_kind"] == "website"
    _, spies = _quality_pass(monkeypatch, model=builder._MODEL_FAST, kind="game")
    assert all(r["width"] != 1280 for r in spies["renders"])
    assert spies["judge_kind"] == "game"


def test_responsive_failure_feeds_desktop_fix_into_refine(monkeypatch):
    captured = {}

    def fake_regen(h, m, i, timeout=None):
        captured["instruction"] = i
        return None  # regen fails → original ships; we only inspect the prompt

    from backend.services import render_service, vision_judge
    monkeypatch.setattr(render_service, "is_configured", lambda: True)
    monkeypatch.setattr(render_service, "render", lambda html, **k: dict(_GOOD_SHOT))
    monkeypatch.setattr(vision_judge, "judge", lambda images, **k: {
        **_GOOD_VERDICT, "design_score": 55, "critique": ["weak hero"], "responsive_ok": False})
    monkeypatch.setattr(builder, "_repair_regen", fake_regen)
    builder._render_quality_pass("<!doctype html><html><body>o</body></html>",
                                 prompt="x", facts="", sources=[], model=builder._MODEL_MID,
                                 username="u", community_id=1, kind="website")
    assert "desktop (1280px) layout" in captured["instruction"]


def test_quality_pass_respects_job_deadline(monkeypatch):
    from backend.services import render_service
    import time as _time
    monkeypatch.setattr(render_service, "is_configured", lambda: True)
    calls = {"n": 0}
    monkeypatch.setattr(render_service, "render",
                        lambda html, **k: calls.__setitem__("n", calls["n"] + 1) or dict(_GOOD_SHOT))
    token = builder._job_deadline.set(_time.monotonic() - 1)  # already expired
    try:
        html = "<!doctype html><html><body>keep</body></html>"
        out = builder._render_quality_pass(html, prompt="x", facts="", sources=[],
                                           model=builder._MODEL_BEST, username="u",
                                           community_id=1, kind="website")
    finally:
        builder._job_deadline.reset(token)
    assert out == html
    assert calls["n"] == 0


def test_generate_artifact_overrides_kind_to_game_for_multiplayer(monkeypatch):
    monkeypatch.setattr(builder.llm, "web_search_text", lambda *a, **k: "NONE")
    monkeypatch.setattr(builder.llm, "generate_text", lambda *a, **k: _MP_HTML)
    seen = {}

    def fake_pass(html, **k):
        seen["kind"] = k.get("kind")
        return html

    monkeypatch.setattr(builder, "_render_quality_pass", fake_pass)
    builder.generate_artifact("a members directory website", verify=True, kind="website")
    assert seen["kind"] == "game"  # turnBasedGame in the artifact wins


def test_infer_kind_hints_cover_common_games():
    for prompt in ("a sudoku puzzle", "wordle clone", "tetris for the club", "2048 board"):
        assert builder.infer_creation_kind(prompt) == "game", prompt


def test_research_repair_never_strips_multiplayer_wiring(monkeypatch):
    """The research-grounding repair regenerates the whole document too — if its
    output drops the match wiring, ship the original best-effort instead."""
    mp_prompt_html = _MP_HTML.replace("</body>", "no real data</body>")
    monkeypatch.setattr(
        builder.llm, "web_search_text",
        lambda *a, **k: "World chess champion: Gukesh. Source: https://example.com/fide")
    calls = {"n": 0}

    def fake_gen(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            return mp_prompt_html  # omits the researched data -> repair fires
        # Repair grounds the data but strips turnBasedGame.
        return ('<!doctype html><html><body>Gukesh '
                '<a href="https://example.com/fide">source</a></body></html>')

    monkeypatch.setattr(builder.llm, "generate_text", fake_gen)
    html = builder.generate_artifact("a chess game showing the real world champion")
    assert calls["n"] == 2  # repair ran
    assert "turnBasedGame" in html  # ...but its wiring-stripping output was rejected
