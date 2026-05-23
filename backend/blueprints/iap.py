"""Mobile in-app purchase endpoints."""

from __future__ import annotations

from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request, session

from backend.services import api_errors, auth_session, iap_links, mobile_iap, session_identity


iap_bp = Blueprint("iap", __name__)


@iap_bp.after_request
def _no_store(response):
    return auth_session.no_store(response)


def _session_username() -> Optional[str]:
    return session_identity.valid_session_username(session)


@iap_bp.route("/api/iap/config", methods=["GET"])
def api_iap_config():
    if not _session_username():
        return api_errors.auth_required()
    return jsonify({"success": True, **mobile_iap.config()})


@iap_bp.route("/api/iap/apple/confirm", methods=["POST"])
def api_iap_apple_confirm():
    return _confirm(iap_links.PROVIDER_APPLE)


@iap_bp.route("/api/iap/apple/restore", methods=["POST"])
def api_iap_apple_restore():
    return _restore(iap_links.PROVIDER_APPLE)


@iap_bp.route("/api/iap/google/confirm", methods=["POST"])
def api_iap_google_confirm():
    return _confirm(iap_links.PROVIDER_GOOGLE)


@iap_bp.route("/api/iap/google/restore", methods=["POST"])
def api_iap_google_restore():
    return _restore(iap_links.PROVIDER_GOOGLE)


def _confirm(provider: str):
    username = _session_username()
    if not username:
        return api_errors.auth_required()
    body = request.get_json(silent=True) or {}
    ok, reason, result = mobile_iap.confirm_purchase(
        provider=provider,
        username=username,
        product_id=_string(body, "product_id", "productId"),
        purchase_key=_string(
            body,
            "purchase_key",
            "purchaseToken",
            "original_transaction_id",
            "originalTransactionId",
            "transactionId",
        ),
        community_id=_int(body.get("community_id") or body.get("communityId")),
        signed_payload=_string(body, "signed_payload", "signedPayload", "signedTransactionInfo") or None,
        environment=_string(body, "environment") or None,
        expires_at=body.get("expires_at") or body.get("expiresAt"),
    )
    if ok:
        return jsonify({"success": True, "result": result})
    return jsonify({
        "success": False,
        "error": _error_message(reason, result),
        "reason": reason,
        "detail": result,
    }), _status(reason)


def _restore(provider: str):
    username = _session_username()
    if not username:
        return api_errors.auth_required()
    body = request.get_json(silent=True) or {}
    transactions = body.get("transactions") or []
    if not isinstance(transactions, list):
        transactions = []
    if not transactions:
        transactions = [body]

    restored = 0
    last_result: Optional[Dict[str, Any]] = None
    last_reason = "nothing_to_restore"
    for tx in transactions:
        if not isinstance(tx, dict):
            continue
        ok, reason, result = mobile_iap.confirm_purchase(
            provider=provider,
            username=username,
            product_id=_string(tx, "product_id", "productId"),
            purchase_key=_string(
                tx,
                "purchase_key",
                "purchaseToken",
                "original_transaction_id",
                "originalTransactionId",
                "transactionId",
            ),
            community_id=_int(tx.get("community_id") or tx.get("communityId")),
            signed_payload=_string(tx, "signed_payload", "signedPayload", "signedTransactionInfo") or None,
            environment=_string(tx, "environment") or None,
            expires_at=tx.get("expires_at") or tx.get("expiresAt"),
        )
        if ok:
            restored += 1
            last_result = result
        else:
            last_reason = reason
    if restored == 0:
        return jsonify({
            "success": False,
            "error": _error_message(last_reason, last_result),
            "reason": last_reason,
            "detail": last_result,
        }), _status(last_reason)
    return jsonify({
        "success": True,
        "restored_count": restored,
        "result": last_result,
        "links": iap_links.list_for_user(username, provider=provider),
    })


def _string(body: Dict[str, Any], *names: str) -> str:
    for name in names:
        value = body.get(name)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def _int(value: Any) -> Optional[int]:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else None
    except (TypeError, ValueError):
        return None


def _status(reason: str) -> int:
    if reason in ("not_owner", "iap_purchases_disabled"):
        return 403
    if reason in (
        "store_community_limit",
        "purchase_owned_by_other_user",
        "same_tier",
        "steve_package_already_active",
        "steve_package_redundant",
        "community_subscription_inactive",
        "not_root_community",
        "already_active_same_provider",
        "already_active_other_provider",
        "managed_by_other_provider",
        "mode_mismatch",
        "needs_reconciliation",
    ):
        return 409
    return 400


def _error_message(reason: str, detail: Optional[Dict[str, Any]]) -> str:
    provider = ""
    mode = ""
    if isinstance(detail, dict):
        provider = str(detail.get("current_provider") or detail.get("billing_provider") or "")
        mode = str(detail.get("current_mode") or "")
    label = _provider_label(provider)
    if reason in ("already_active_other_provider", "managed_by_other_provider"):
        return f"This subscription is managed through {label}. Use that provider to make changes."
    if reason == "already_active_same_provider":
        return f"This subscription is already active through {label}."
    if reason == "mode_mismatch":
        return f"This subscription belongs to Stripe {mode or 'another mode'} and cannot be changed here."
    if reason == "needs_reconciliation":
        return "This billing state needs reconciliation before another subscription can be applied."
    return reason


def _provider_label(provider: str) -> str:
    if provider == "apple":
        return "App Store"
    if provider == "google":
        return "Google Play"
    if provider == "stripe":
        return "web billing"
    return provider or "the original billing platform"
