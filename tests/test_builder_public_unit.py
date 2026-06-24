from backend.services import builder


def test_public_kind_inference_blocks_games_and_allows_apps():
    assert builder.infer_creation_kind("build a chess game") == "game"
    assert builder.infer_creation_kind("make an RSVP tracker app") == "app"
    assert builder.infer_creation_kind("create a portfolio website") == "website"
    assert builder.public_publish_eligible("game") is False
    assert builder.public_publish_eligible("app") is True
    assert builder.public_publish_eligible("website") is True


def test_public_html_injects_bridge_branding_and_slug():
    html = "<!doctype html><html><head><title>X</title></head><body><main>Hi</main></body></html>"
    out = builder.prepare_public_creation_html(html, slug="demo-1", title="Demo")

    assert "Built with C-Point" in out
    assert "isPublicBuild:true" in out
    assert "public_build_no_private_persistence" in out
    assert "demo-1" in out
    assert "https://www.c-point.co" in out
    assert "https://c-point.co" not in out
    assert "CPoint.data" not in out  # exposed as a property on window.CPoint, not raw docs text
