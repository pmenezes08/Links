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


def test_decode_jws_payload_unverified():
    import base64
    import json

    payload = {"notificationType": "DID_RENEW", "foo": 1}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    signed = f"e30.{body}.sig"
    decoded = store_purchase_verify.decode_jws_payload_unverified(signed)
    assert decoded.get("notificationType") == "DID_RENEW"
