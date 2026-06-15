"""Store purchase verification helpers."""

from __future__ import annotations

from backend.services import store_purchase_verify


def test_sandbox_skips_strict_verification(monkeypatch):
    monkeypatch.setattr(store_purchase_verify, "apple_configured", lambda: True)
    ok, reason, _payload = store_purchase_verify.verify_confirm(
        provider="apple",
        product_id="cpoint_premium_monthly",
        purchase_key="tx_sandbox",
        environment="Sandbox",
    )
    assert ok is True
    assert reason == ""


def test_production_requires_apple_credentials(monkeypatch):
    monkeypatch.setattr(store_purchase_verify, "apple_configured", lambda: False)
    ok, reason, _payload = store_purchase_verify.verify_confirm(
        provider="apple",
        product_id="cpoint_premium_monthly",
        purchase_key="tx_prod",
        environment="Production",
    )
    assert ok is False
    assert reason == "apple_verification_unconfigured"


class _FakeResp:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = ""
        self.content = b"{}"

    def json(self):
        return self._payload


def test_apple_transaction_falls_back_to_sandbox(monkeypatch):
    """A TestFlight/sandbox transaction (no environment) 404s on prod and is
    found on the sandbox host."""
    monkeypatch.setattr(store_purchase_verify, "_apple_bearer_token", lambda: "tok")
    calls = []

    def fake_get(url, headers=None, timeout=None):
        calls.append(url)
        if "storekit-sandbox" in url:
            return _FakeResp(200, {"productId": "cpoint_premium_monthly", "environment": "Sandbox"})
        return _FakeResp(404)

    monkeypatch.setattr(store_purchase_verify.requests, "get", fake_get)
    payload = store_purchase_verify._apple_get_transaction("123456789", environment=None)
    assert payload.get("productId") == "cpoint_premium_monthly"
    # Production is tried first, sandbox second.
    assert len(calls) == 2
    assert "storekit.itunes" in calls[0]
    assert "storekit-sandbox" in calls[1]


def test_apple_transaction_prod_hit_skips_sandbox(monkeypatch):
    """A live transaction resolves on the first (production) host with no
    second round trip."""
    monkeypatch.setattr(store_purchase_verify, "_apple_bearer_token", lambda: "tok")
    calls = []

    def fake_get(url, headers=None, timeout=None):
        calls.append(url)
        return _FakeResp(200, {"productId": "cpoint_premium_monthly", "environment": "Production"})

    monkeypatch.setattr(store_purchase_verify.requests, "get", fake_get)
    payload = store_purchase_verify._apple_get_transaction("123456789", environment=None)
    assert payload.get("productId") == "cpoint_premium_monthly"
    assert len(calls) == 1
    assert "storekit-sandbox" not in calls[0]


def test_apple_transaction_invalid_id_no_fallback(monkeypatch):
    """A malformed id (400) is not retried against the other host."""
    monkeypatch.setattr(store_purchase_verify, "_apple_bearer_token", lambda: "tok")
    calls = []

    def fake_get(url, headers=None, timeout=None):
        calls.append(url)
        return _FakeResp(400)

    monkeypatch.setattr(store_purchase_verify.requests, "get", fake_get)
    payload = store_purchase_verify._apple_get_transaction("not-a-tx-id", environment=None)
    assert payload == {}
    assert len(calls) == 1


def test_apple_api_bases_ordering():
    prod_first = store_purchase_verify._apple_api_bases(None)
    assert prod_first[0].endswith("storekit.itunes.apple.com")
    assert prod_first[1].endswith("storekit-sandbox.itunes.apple.com")
    sandbox_first = store_purchase_verify._apple_api_bases("Sandbox")
    assert sandbox_first[0].endswith("storekit-sandbox.itunes.apple.com")


def test_decode_jws_payload_unverified():
    import base64
    import json

    payload = {"notificationType": "DID_RENEW", "foo": 1}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    signed = f"e30.{body}.sig"
    decoded = store_purchase_verify.decode_jws_payload_unverified(signed)
    assert decoded.get("notificationType") == "DID_RENEW"
