from backend.services import onboarding_tier_hints


def test_build_onboarding_tier_hints_includes_kb_community_tiers(monkeypatch):
    fields = {
        "free_community_media_gb": 1,
        "free_community_max_members": 25,
        "paid_l1_price_eur_monthly": 25,
        "paid_l1_max_members": 75,
        "paid_l2_price_eur_monthly": 50,
        "paid_l2_max_members": 150,
        "paid_l3_price_eur_monthly": 80,
        "paid_l3_max_members": 250,
    }

    def fake_get_page(slug):
        assert slug == "community-tiers"
        return {
            "fields": [
                {"name": name, "value": value}
                for name, value in fields.items()
            ]
        }

    monkeypatch.setattr(onboarding_tier_hints.kb, "get_page", fake_get_page)
    monkeypatch.setattr(
        onboarding_tier_hints,
        "resolve_entitlements",
        lambda _username: {"communities_max": 5, "members_per_owned_community": 25},
    )

    hints = onboarding_tier_hints.build_onboarding_tier_hints("owner")

    assert hints["community_tiers"]["free"]["max_members"] == 25
    assert hints["community_tiers"]["paid_l1"] == {
        "label": "Paid L1",
        "price_eur_monthly": 25,
        "max_members": 75,
        "min_members": 26,
    }
    assert hints["community_tiers"]["paid_l2"]["min_members"] == 76
    assert hints["community_tiers"]["paid_l3"]["min_members"] == 151
    assert hints["community_tiers"]["enterprise"]["min_members"] == 251
