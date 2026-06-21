from __future__ import annotations

from backend.services import builder_feeds


class FakeFeedCache:
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


def test_unknown_connector_rejected():
    assert builder_feeds.fetch_feed("nope", {})["error"] == "unknown_connector"


def test_weather_normalizes_and_caches(monkeypatch):
    fake_cache = FakeFeedCache()
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
    assert len(calls) == 2


def test_budget_serves_stale(monkeypatch):
    fake_cache = FakeFeedCache()
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


def test_sports_normalizes_fixtures(monkeypatch):
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
