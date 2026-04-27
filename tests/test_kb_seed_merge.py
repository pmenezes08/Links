from __future__ import annotations

import pytest

from backend.services import knowledge_base as kb


def _field_by_name(fields, name: str):
    return next((field for field in fields if field.get("name") == name), None)


def test_merge_missing_seed_fields_preserves_existing_values():
    merged, missing = kb._merge_missing_seed_fields(
        [
            {"name": "premium_price_standard_eur", "value": 9.99},
            {"name": "premium_stripe_price_id_test", "value": "price_existing"},
        ],
        [
            {"name": "premium_price_standard_eur", "value": 7.99},
            {"name": "premium_stripe_price_id_test", "value": ""},
            {"name": "premium_stripe_price_id_live", "value": "", "tbd": True},
        ],
    )

    assert len(missing) == 1
    assert missing[0]["name"] == "premium_stripe_price_id_live"
    assert _field_by_name(merged, "premium_price_standard_eur")["value"] == 9.99
    assert _field_by_name(merged, "premium_stripe_price_id_test")["value"] == "price_existing"


@pytest.mark.usefixtures("mysql_dsn")
def test_seed_merges_missing_fields_into_edited_kb_page_without_overwriting_values():
    kb.seed_default_pages(force=True)
    page = kb.get_page("user-tiers") or {}
    fields = [
        field
        for field in (page.get("fields") or [])
        if field.get("name") not in {
            "premium_stripe_price_id_test",
            "premium_stripe_price_id_live",
        }
    ]
    existing_price = _field_by_name(fields, "premium_price_standard_eur")
    assert existing_price is not None
    existing_price["value"] = 9.99

    kb.save_page(
        "user-tiers",
        fields=fields,
        body_markdown="Admin edited copy that must remain untouched.",
        reason="simulate manually edited page before new seed fields existed",
        actor_username="admin",
    )

    result = kb.seed_default_pages()

    assert result["merged_pages"] >= 1
    assert result["merged_fields"] >= 2

    merged_page = kb.get_page("user-tiers") or {}
    merged_fields = merged_page.get("fields") or []
    assert _field_by_name(merged_fields, "premium_stripe_price_id_test") is not None
    assert _field_by_name(merged_fields, "premium_stripe_price_id_live") is not None
    assert _field_by_name(merged_fields, "premium_price_standard_eur")["value"] == 9.99
    assert merged_page["body_markdown"] == "Admin edited copy that must remain untouched."


@pytest.mark.usefixtures("mysql_dsn")
def test_seed_does_not_replace_existing_stripe_price_id_values_on_edited_page():
    kb.seed_default_pages(force=True)
    page = kb.get_page("user-tiers") or {}
    fields = list(page.get("fields") or [])
    _field_by_name(fields, "premium_stripe_price_id_test")["value"] = "price_existing"

    kb.save_page(
        "user-tiers",
        fields=fields,
        reason="admin configured premium test price id",
        actor_username="admin",
    )

    result = kb.seed_default_pages()

    assert result["merged_fields"] == 0
    merged_page = kb.get_page("user-tiers") or {}
    assert _field_by_name(merged_page.get("fields") or [], "premium_stripe_price_id_test")["value"] == "price_existing"
