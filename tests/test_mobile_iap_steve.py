"""Mobile IAP — Steve Community Package confirm + lifecycle."""

from __future__ import annotations

from backend.services import iap_links, mobile_iap


def test_confirm_steve_package_grants_community(monkeypatch):
    saved: dict = {}

    monkeypatch.setattr(mobile_iap, "_grants_allowed", lambda _environment: True)
    monkeypatch.setattr(iap_links, "find", lambda _provider, _purchase_key: None)
    monkeypatch.setattr(iap_links, "upsert_link", lambda **kwargs: saved.setdefault("link", kwargs) or True)
    monkeypatch.setattr(mobile_iap.community_svc, "is_community_owner", lambda _u, _c: True)
    monkeypatch.setattr(
        mobile_iap.community_svc,
        "resolve_root_community_id",
        lambda community_id: (community_id, True),
    )
    monkeypatch.setattr(mobile_iap.community_billing, "has_active_steve_package", lambda _c: False)
    monkeypatch.setattr(mobile_iap.community_billing, "get_billing_state", lambda _c: {"tier": "paid_l1"})
    monkeypatch.setattr(
        mobile_iap.subscription_health,
        "derive_community_subscription_health",
        lambda *_a, **_k: {"steve_addon_eligible": True},
    )
    monkeypatch.setattr(
        mobile_iap.community_billing,
        "mark_steve_package_subscription",
        lambda community_id, **kwargs: saved.setdefault(
            "steve", {"community_id": community_id, **kwargs}
        )
        or True,
    )
    monkeypatch.setattr(mobile_iap.subscription_audit, "log", lambda **_kwargs: None)
    monkeypatch.setattr(
        mobile_iap.store_purchase_verify,
        "verify_confirm",
        lambda **_kwargs: (True, "ok", {}),
    )

    ok, reason, result = mobile_iap.confirm_purchase(
        provider="apple",
        username="owner1",
        product_id="cpoint_steve_community_monthly",
        purchase_key="steve_tx_1",
        community_id=42,
        environment="Sandbox",
    )

    assert ok is True
    assert reason == "ok"
    assert result == {"subscription": "steve_package", "provider": "apple", "community_id": 42}
    assert saved["link"]["sku"] == iap_links.SKU_STEVE_PACKAGE
    assert saved["link"]["community_id"] == 42
    assert saved["steve"]["status"] == "active"


def test_steve_already_active_rejected(monkeypatch):
    monkeypatch.setattr(mobile_iap, "_grants_allowed", lambda _environment: True)
    monkeypatch.setattr(iap_links, "find", lambda _provider, _purchase_key: None)
    monkeypatch.setattr(mobile_iap.community_svc, "is_community_owner", lambda _u, _c: True)
    monkeypatch.setattr(
        mobile_iap.community_svc,
        "resolve_root_community_id",
        lambda community_id: (community_id, True),
    )
    monkeypatch.setattr(mobile_iap.community_billing, "has_active_steve_package", lambda _c: True)
    monkeypatch.setattr(
        mobile_iap.store_purchase_verify,
        "verify_confirm",
        lambda **_kwargs: (True, "ok", {}),
    )

    ok, reason, result = mobile_iap.confirm_purchase(
        provider="apple",
        username="owner1",
        product_id="cpoint_steve_community_monthly",
        purchase_key="steve_tx_2",
        community_id=42,
        environment="Sandbox",
    )

    assert ok is False
    assert reason == "steve_package_already_active"
    assert result is None
