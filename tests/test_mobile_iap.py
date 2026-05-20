from backend.services import iap_links, mobile_iap


def test_iap_config_exposes_default_product_ids(monkeypatch):
    monkeypatch.setattr(mobile_iap, "_kb_field_map", lambda _slug: {})

    cfg = mobile_iap.config()

    assert cfg["iap_purchases_enabled"] is False
    assert cfg["web_app_billing_url"] == "https://app.c-point.co/subscription_plans"
    assert cfg["apple"]["premium_product_id"] == "cpoint_premium_monthly"
    assert cfg["apple"]["community_product_ids"]["paid_l1"] == "cpoint_community_l1_monthly"
    assert cfg["google"]["community_product_ids"]["paid_l3"] == "cpoint_community_l3_monthly"
    assert cfg["apple"]["steve_product_id"] == "cpoint_steve_community_monthly"
    assert cfg["google"]["steve_product_id"] == "cpoint_steve_community_monthly"


def test_confirm_apple_premium_grants_user_subscription(monkeypatch):
    saved = {}

    monkeypatch.setattr(mobile_iap, "_grants_allowed", lambda _environment: True)
    monkeypatch.setattr(iap_links, "find", lambda _provider, _purchase_key: None)
    monkeypatch.setattr(iap_links, "upsert_link", lambda **kwargs: saved.setdefault("link", kwargs) or True)
    monkeypatch.setattr(
        mobile_iap.user_billing,
        "mark_subscription",
        lambda username, **kwargs: saved.setdefault("user", {"username": username, **kwargs}) or True,
    )
    monkeypatch.setattr(mobile_iap.subscription_audit, "log", lambda **_kwargs: None)

    ok, reason, result = mobile_iap.confirm_purchase(
        provider="apple",
        username="paulo",
        product_id="cpoint_premium_monthly",
        purchase_key="tx_123",
        environment="Sandbox",
    )

    assert ok is True
    assert reason == "ok"
    assert result == {"subscription": "premium", "provider": "apple"}
    assert saved["link"]["sku"] == iap_links.SKU_PREMIUM
    assert saved["user"]["subscription"] == "premium"
    assert saved["user"]["provider"] == "apple"


def test_confirm_production_rejected_without_verification(monkeypatch):
    monkeypatch.setattr(mobile_iap, "_grants_allowed", lambda _environment: True)
    monkeypatch.setattr(
        mobile_iap.store_purchase_verify,
        "verify_confirm",
        lambda **_kwargs: (False, "apple_verification_unconfigured", {}),
    )

    ok, reason, result = mobile_iap.confirm_purchase(
        provider="apple",
        username="paulo",
        product_id="cpoint_premium_monthly",
        purchase_key="tx_prod",
        environment="Production",
    )

    assert ok is False
    assert reason == "apple_verification_unconfigured"
    assert result is None


def test_second_store_billed_community_is_rejected(monkeypatch):
    monkeypatch.setattr(mobile_iap, "_grants_allowed", lambda _environment: True)
    monkeypatch.setattr(iap_links, "find", lambda _provider, _purchase_key: None)
    monkeypatch.setattr(
        iap_links,
        "active_community_for_user",
        lambda _provider, _username: {"community_id": 10, "tier_code": "paid_l1"},
    )
    monkeypatch.setattr(mobile_iap.community_svc, "resolve_root_community_id", lambda community_id: (community_id, True))
    monkeypatch.setattr(mobile_iap.community_svc, "is_community_owner", lambda _username, _community_id: True)
    monkeypatch.setattr(mobile_iap.community_billing, "get_billing_state", lambda _community_id: {})
    monkeypatch.setattr(mobile_iap, "_tier_member_cap", lambda _tier_code: 75)
    monkeypatch.setattr(mobile_iap, "_count_members", lambda _community_id: 12)

    ok, reason, result = mobile_iap.confirm_purchase(
        provider="google",
        username="paulo",
        product_id="cpoint_community_l2_monthly",
        purchase_key="purchase_token_2",
        community_id=22,
        environment="license_test",
    )

    assert ok is False
    assert reason == "store_community_limit"
    assert result is None
