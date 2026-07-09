from __future__ import annotations

import pytest

from backend.services import builder_capsules


def test_normalizes_feed_capsule_recipe():
    recipes = builder_capsules.normalize_recipes([{
        "name": "World Cup Fixtures",
        "engine": "feed",
        "connector": "sports",
        "params": {"day": "2026-06-21", "sport": "Soccer", "limit": 200},
        "public": True,
        "refresh_policy": {"allow_manual": True, "min_interval_seconds": 120},
    }])

    assert recipes[0]["name"] == "world-cup-fixtures"
    assert recipes[0]["engine"] == "feed"
    assert recipes[0]["connector"] == "sports"
    assert recipes[0]["public"] is True
    assert recipes[0]["params"]["limit"] == 20
    assert recipes[0]["refresh_policy"]["min_interval_seconds"] == 120


def test_rejects_unknown_engine_and_raw_urls():
    with pytest.raises(builder_capsules.CapsuleValidationError, match="unknown_capsule_engine"):
        builder_capsules.normalize_recipes({"name": "bad", "engine": "browser", "params": {}})

    with pytest.raises(builder_capsules.CapsuleValidationError, match="raw_urls_not_allowed"):
        builder_capsules.normalize_recipes({
            "name": "rss",
            "engine": "feed",
            "connector": "technews",
            "params": {"url": "https://example.com/feed.xml"},
        })


def test_extracts_json_sidecar_from_html():
    html = """<!doctype html><html><body>
    <script type="application/json" id="cpoint-capsule-recipes">
      [{"name":"lisbon-images","engine":"images","query":"Lisbon city lights","limit":4,"public":true}]
    </script>
    </body></html>"""

    recipes = builder_capsules.extract_recipes_from_html(html)

    assert recipes[0]["name"] == "lisbon-images"
    assert recipes[0]["engine"] == "images"
    assert recipes[0]["query"] == "Lisbon city lights"
    assert recipes[0]["limit"] == 4
