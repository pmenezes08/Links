"""Pure-unit tests (no DB/Docker) for the CPoint.images provider chain:
Pexels primary (curated, hero-resolution CDN) with keyless Openverse fallback."""

import requests

from backend.services import builder

_PEXELS_PAYLOAD = {
    "photos": [{
        "alt": "Warm bakery counter",
        "photographer": "Maria Silva",
        "src": {
            "original": "https://images.pexels.com/p/1.jpg",
            "large2x": "https://images.pexels.com/p/1.jpg?w=1880",
            "large": "https://images.pexels.com/p/1.jpg?w=940",
            "medium": "https://images.pexels.com/p/1.jpg?w=350",
        },
    }],
}

_OPENVERSE_PAYLOAD = {
    "results": [{
        "thumbnail": "https://api.openverse.org/t/2.jpg",
        "url": "https://origin.example.com/2.jpg",
        "title": "Bakery",
        "creator": "someone",
        "license": "by-sa",
    }],
}


class _Resp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload


def test_pexels_is_primary_when_key_configured(monkeypatch):
    monkeypatch.setenv("PEXELS_API_KEY", "test-key")
    seen = {}

    def fake_get(url, **k):
        seen["url"] = url
        seen["auth"] = (k.get("headers") or {}).get("Authorization")
        return _Resp(_PEXELS_PAYLOAD)

    monkeypatch.setattr(requests, "get", fake_get)
    out = builder.search_images("cozy bakery")
    assert seen["url"] == builder._PEXELS_URL
    assert seen["auth"] == "test-key"
    assert out and out[0]["provider"] == "pexels"
    assert out[0]["url"].endswith("w=940")          # cards default
    assert out[0]["hero"].endswith("w=1880")        # full-bleed size present
    assert out[0]["creator"] == "Maria Silva"
    assert builder.image_provider() == "pexels"


def test_falls_back_to_openverse_when_pexels_empty_or_down(monkeypatch):
    monkeypatch.setenv("PEXELS_API_KEY", "test-key")
    calls = []

    def fake_get(url, **k):
        calls.append(url)
        if url == builder._PEXELS_URL:
            return _Resp({}, status=500)
        return _Resp(_OPENVERSE_PAYLOAD)

    monkeypatch.setattr(requests, "get", fake_get)
    out = builder.search_images("bakery")
    assert calls == [builder._PEXELS_URL, builder._OPENVERSE_URL]
    assert out and out[0]["provider"] == "openverse"
    # Shape parity: fallback items carry the same keys builds rely on.
    assert out[0]["hero"] == "https://origin.example.com/2.jpg"


def test_openverse_only_without_key(monkeypatch):
    monkeypatch.delenv("PEXELS_API_KEY", raising=False)
    calls = []

    def fake_get(url, **k):
        calls.append(url)
        return _Resp(_OPENVERSE_PAYLOAD)

    monkeypatch.setattr(requests, "get", fake_get)
    out = builder.search_images("bakery")
    assert calls == [builder._OPENVERSE_URL]       # Pexels never attempted
    assert out and out[0]["provider"] == "openverse"
    assert builder.image_provider() == "openverse"


def test_guide_teaches_hero_image_usage():
    guide = builder._SYSTEM_PROMPT
    assert "hero" in guide
    assert "never stretch `url` across a hero" in guide.lower()
