"""Pure-unit tests (no DB/Docker) for the vision judge's kind-aware,
multi-image grading (Build Quality v2)."""

from backend.services import vision_judge


def test_prompt_includes_kind_rubric_and_image_labels():
    p = vision_judge._build_user_prompt(
        "a bakery website", "", [],
        kind="website",
        image_labels=["mobile viewport, top fold (~420px)",
                      "full scrolled page (mobile, ~420px)",
                      "desktop viewport (1280px) — websites/apps must hold up at both widths"],
    )
    assert "KIND: website" in p
    assert "marketing page a business would" in p            # website rubric
    assert "IMAGE 1: mobile viewport" in p and "IMAGE 3: desktop viewport" in p
    assert '"responsive_ok"' in p                             # desktop attached → key requested


def test_prompt_without_desktop_or_kind_stays_generic():
    p = vision_judge._build_user_prompt("a snake game", "", [], kind="",
                                        image_labels=["mobile (~420px)"])
    assert "KIND:" not in p
    assert '"responsive_ok"' not in p                         # no desktop image → not requested
    p_game = vision_judge._build_user_prompt("chess", "", [], kind="game",
                                             image_labels=["mobile (~420px)"])
    assert "poster frame" in p_game                           # game rubric


def test_coerce_verdict_defaults_responsive_ok_safely():
    base = {"render_ok": True, "design_score": 80, "data_verified": "na",
            "data_issues": [], "critique": []}
    assert vision_judge._coerce_verdict(base)["responsive_ok"] is True
    assert vision_judge._coerce_verdict({**base, "responsive_ok": "garbage"})["responsive_ok"] is True
    assert vision_judge._coerce_verdict({**base, "responsive_ok": False})["responsive_ok"] is False


def test_judge_multi_image_is_one_call_and_one_usage_row(monkeypatch):
    """One paid call → one metered row.

    Success rows are now emitted by ``llm.usage_context`` around the real
    upstream call (real tokens + cost), so with ``vision_json`` mocked we
    assert the context is entered exactly once with the judge surface and
    that the legacy manual ``log_usage`` no longer fires on success.
    """
    calls = {"vision": 0, "usage": 0, "ctx": [], "images": None, "prompt": ""}

    def fake_vision(system, user, images, **k):
        calls["vision"] += 1
        calls["images"] = images
        calls["prompt"] = user
        return {"render_ok": True, "design_score": 72, "data_verified": "na",
                "data_issues": [], "critique": [], "responsive_ok": False}

    from contextlib import contextmanager

    @contextmanager
    def fake_ctx(**kwargs):
        calls["ctx"].append(kwargs)
        yield

    monkeypatch.setattr(vision_judge.llm, "vision_json", fake_vision)
    monkeypatch.setattr(vision_judge.llm, "usage_context", fake_ctx)
    monkeypatch.setattr(vision_judge.ai_usage, "log_usage",
                        lambda *a, **k: calls.__setitem__("usage", calls["usage"] + 1))
    verdict = vision_judge.judge(
        [{"label": "mobile fold", "b64": "AAA"},
         {"label": "full page", "b64": "BBB"},
         {"label": "desktop viewport (1280px)", "b64": "CCC"}],
        username="u", brief="a café website", kind="website",
    )
    assert calls["vision"] == 1                              # one paid call
    assert len(calls["ctx"]) == 1                            # one metered context
    assert calls["ctx"][0].get("surface") == vision_judge.ai_usage.SURFACE_BUILDER_JUDGE
    assert calls["usage"] == 0                               # no manual row on success
    assert calls["images"] == ["AAA", "BBB", "CCC"]
    assert "KIND: website" in calls["prompt"]
    assert verdict and verdict["responsive_ok"] is False


def test_judge_failure_logs_single_failure_row(monkeypatch):
    calls = {"usage": []}

    def boom(system, user, images, **k):
        raise RuntimeError("upstream down")

    monkeypatch.setattr(vision_judge.llm, "vision_json", boom)
    monkeypatch.setattr(vision_judge.ai_usage, "log_usage",
                        lambda *a, **k: calls["usage"].append(k))
    verdict = vision_judge.judge("ZZZ", username="u", brief="x")
    assert verdict is None
    assert len(calls["usage"]) == 1
    assert calls["usage"][0].get("success") is False
    assert calls["usage"][0].get("reason_blocked") == "judge_error"


def test_judge_single_string_back_compat(monkeypatch):
    seen = {}

    def fake_vision(system, user, images, **k):
        seen["images"] = images
        return {"render_ok": True, "design_score": 90, "data_verified": "na",
                "data_issues": [], "critique": []}

    monkeypatch.setattr(vision_judge.llm, "vision_json", fake_vision)
    monkeypatch.setattr(vision_judge.ai_usage, "log_usage", lambda *a, **k: None)
    verdict = vision_judge.judge("ZZZ", username="u", brief="x")
    assert seen["images"] == ["ZZZ"]
    assert verdict and verdict["design_score"] == 90
