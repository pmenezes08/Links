"""Typed restore-outcome mapping for the IAP /restore endpoints."""

from __future__ import annotations

from backend.blueprints.iap import _restore_typed_reason


def test_restore_typed_reason_account_mismatch():
    assert _restore_typed_reason("purchase_owned_by_other_user") == "account_mismatch"
    assert _restore_typed_reason("managed_by_other_provider") == "account_mismatch"
    assert _restore_typed_reason("already_active_other_provider") == "account_mismatch"


def test_restore_typed_reason_no_purchase():
    assert _restore_typed_reason("nothing_to_restore") == "no_purchase"
    assert _restore_typed_reason("unknown_product") == "no_purchase"
    assert _restore_typed_reason("community_id_required") == "no_purchase"


def test_restore_typed_reason_transient_default():
    # Verification / network / config hiccups are retryable.
    assert _restore_typed_reason("apple_transaction_not_found") == "transient"
    assert _restore_typed_reason("invalid_signed_payload") == "transient"
    assert _restore_typed_reason("apple_verification_unconfigured") == "transient"
    assert _restore_typed_reason("something_unmapped") == "transient"
