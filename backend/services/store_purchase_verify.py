"""Apple App Store / Google Play purchase verification for IAP confirm + webhooks.

Credentials (Secret Manager on Cloud Run):
  Apple: ``APPLE_IAP_KEY_ID``, ``APPLE_IAP_ISSUER_ID``, ``APPLE_IAP_PRIVATE_KEY`` (PEM),
         optional ``APPLE_BUNDLE_ID`` (default ``co.cpoint.app``).
  Google: ``GOOGLE_PLAY_PACKAGE_NAME``, ``GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`` (full JSON).

When credentials are missing, production grants (``iap_purchases_enabled``) are rejected
unless the client environment is sandbox / license-test. Webhook lifecycle mutations
require verification when credentials are configured.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from typing import Any, Dict, Optional, Tuple

import requests

from backend.services import iap_links

logger = logging.getLogger(__name__)

APPLE_BUNDLE_ID = (os.environ.get("APPLE_BUNDLE_ID") or "co.cpoint.app").strip()
APPLE_IAP_KEY_ID = (os.environ.get("APPLE_IAP_KEY_ID") or "").strip()
APPLE_IAP_ISSUER_ID = (os.environ.get("APPLE_IAP_ISSUER_ID") or "").strip()
APPLE_IAP_PRIVATE_KEY = (os.environ.get("APPLE_IAP_PRIVATE_KEY") or "").strip()
GOOGLE_PLAY_PACKAGE = (
    os.environ.get("GOOGLE_PLAY_PACKAGE_NAME") or "co.cpoint.app"
).strip()
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = (
    os.environ.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON") or ""
).strip()

_APPLE_PROD = "https://api.storekit.itunes.apple.com"
_APPLE_SANDBOX = "https://api.storekit-sandbox.itunes.apple.com"
_APPLE_JWT_TTL_SEC = 1200


def apple_configured() -> bool:
    return bool(APPLE_IAP_KEY_ID and APPLE_IAP_ISSUER_ID and APPLE_IAP_PRIVATE_KEY)


def google_configured() -> bool:
    return bool(GOOGLE_PLAY_PACKAGE and GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)


def is_sandbox_environment(environment: Optional[str]) -> bool:
    env = (environment or "").strip().lower()
    return env in ("sandbox", "xcode", "test", "license_test")


def verify_confirm(
    *,
    provider: str,
    product_id: str,
    purchase_key: str,
    signed_payload: Optional[str] = None,
    environment: Optional[str] = None,
) -> Tuple[bool, str, Dict[str, Any]]:
    """Validate a client confirm payload before entitlements are granted."""
    if is_sandbox_environment(environment):
        return True, "", {}

    if provider == iap_links.PROVIDER_APPLE:
        if not apple_configured():
            return False, "apple_verification_unconfigured", {}
        ok, err, payload = _verify_apple_confirm(
            purchase_key=purchase_key,
            product_id=product_id,
            signed_payload=signed_payload,
            environment=environment,
        )
        return ok, err, payload

    if provider == iap_links.PROVIDER_GOOGLE:
        if not google_configured():
            return False, "google_verification_unconfigured", {}
        ok, err, payload = _verify_google_confirm(
            purchase_key=purchase_key,
            product_id=product_id,
        )
        return ok, err, payload

    return False, "invalid_provider", {}


def verify_apple_notification_jws(signed: str) -> Tuple[bool, Dict[str, Any]]:
    """Verify ASSN2 ``signedPayload`` when Apple credentials are configured."""
    if not signed:
        return False, {}
    if not apple_configured():
        return True, decode_jws_payload_unverified(signed)
    ok, payload = _verify_jws_signature(signed)
    if not ok:
        return False, {}
    return True, payload


def verify_google_rtdn(
    *,
    purchase_token: Optional[str],
    subscription_id: Optional[str] = None,
) -> Tuple[bool, str]:
    """Confirm RTDN purchase token with Play Developer API when configured."""
    if not purchase_token:
        return False, "missing_purchase_token"
    if not google_configured():
        return True, ""
    state = _google_subscription_state(
        purchase_token=purchase_token,
        subscription_id=subscription_id,
    )
    if not state:
        return False, "google_subscription_not_found"
    return True, ""


def decode_jws_payload_unverified(signed: str) -> Dict[str, Any]:
    try:
        parts = signed.split(".")
        if len(parts) < 2:
            return {}
        pad = "=" * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(parts[1] + pad).decode("utf-8"))
    except Exception:
        return {}


def _verify_apple_confirm(
    *,
    purchase_key: str,
    product_id: str,
    signed_payload: Optional[str],
    environment: Optional[str],
) -> Tuple[bool, str, Dict[str, Any]]:
    if signed_payload:
        ok, payload = _verify_jws_signature(signed_payload)
        if not ok:
            return False, "invalid_signed_payload", {}
        tx_product = str(payload.get("productId") or "").strip()
        if tx_product and tx_product != product_id:
            return False, "product_mismatch", {}
        tx_id = str(
            payload.get("originalTransactionId")
            or payload.get("transactionId")
            or ""
        ).strip()
        if tx_id and tx_id != purchase_key:
            return False, "transaction_mismatch", {}
        bundle = str(payload.get("bundleId") or "").strip()
        if bundle and bundle != APPLE_BUNDLE_ID:
            return False, "bundle_mismatch", {}
        return True, "", payload

    tx = _apple_get_transaction(purchase_key, environment=environment)
    if not tx:
        return False, "apple_transaction_not_found", {}
    tx_product = str(tx.get("productId") or "").strip()
    if tx_product and tx_product != product_id:
        return False, "product_mismatch", {}
    return True, "", tx


def _verify_google_confirm(
    *, purchase_key: str, product_id: str
) -> Tuple[bool, str, Dict[str, Any]]:
    state = _google_subscription_state(
        purchase_token=purchase_key,
        subscription_id=product_id,
    )
    if not state:
        return False, "google_subscription_not_found", {}
    line_items = state.get("lineItems") or []
    for item in line_items:
        pid = str((item or {}).get("productId") or "").strip()
        if pid and pid != product_id:
            continue
        return True, "", state
    if line_items:
        first_pid = str((line_items[0] or {}).get("productId") or "").strip()
        if first_pid and first_pid != product_id:
            return False, "product_mismatch", {}
    return True, "", state


def _apple_api_bases(environment: Optional[str]) -> list:
    """Ordered App Store Server API hosts to try for a transaction lookup.

    The capgo ``native-purchases`` client does not report the StoreKit
    environment, so a TestFlight / sandbox purchase reaches us with
    ``environment=None`` and 404s against the production host. Apple's
    guidance is to query production first and fall back to sandbox on a
    not-found, so a single code path verifies both live and sandbox
    transactions. When the environment is explicitly sandbox we try sandbox
    first to save a round trip.
    """
    if is_sandbox_environment(environment):
        return [_APPLE_SANDBOX, _APPLE_PROD]
    return [_APPLE_PROD, _APPLE_SANDBOX]


def _apple_bearer_token() -> Optional[str]:
    try:
        import jwt  # type: ignore
    except ImportError:
        logger.error("PyJWT required for Apple IAP verification")
        return None
    key = APPLE_IAP_PRIVATE_KEY.replace("\\n", "\n")
    now = int(time.time())
    headers = {"alg": "ES256", "kid": APPLE_IAP_KEY_ID, "typ": "JWT"}
    payload = {
        "iss": APPLE_IAP_ISSUER_ID,
        "iat": now,
        "exp": now + _APPLE_JWT_TTL_SEC,
        "aud": "appstoreconnect-v1",
        "bid": APPLE_BUNDLE_ID,
    }
    return jwt.encode(payload, key, algorithm="ES256", headers=headers)


def _apple_get_transaction(
    transaction_id: str, *, environment: Optional[str]
) -> Dict[str, Any]:
    token = _apple_bearer_token()
    if not token:
        return {}
    for base in _apple_api_bases(environment):
        url = f"{base}/inApps/v1/transactions/{transaction_id}"
        try:
            res = requests.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
                timeout=20,
            )
        except Exception:
            logger.exception("apple transaction lookup error (%s)", base)
            continue
        if res.status_code == 200:
            body = res.json()
            signed = body.get("signedTransactionInfo") or ""
            if signed:
                ok, payload = _verify_jws_signature(signed)
                if ok:
                    return payload
                return decode_jws_payload_unverified(signed)
            return body if isinstance(body, dict) else {}
        if res.status_code == 404:
            # The transaction lives in the other environment — fall back to the
            # next host before giving up. TestFlight / sandbox purchases land
            # here because the client never tells us the StoreKit environment.
            logger.info(
                "apple transaction %s not found in %s; trying next host",
                transaction_id,
                base,
            )
            continue
        # 400 (malformed id) / 401 (auth) won't be fixed by another host.
        logger.warning(
            "apple transaction lookup failed: %s %s",
            res.status_code,
            res.text[:200],
        )
        break
    return {}


def _google_access_token() -> Optional[str]:
    try:
        from google.oauth2 import service_account  # type: ignore
        import google.auth.transport.requests  # type: ignore
    except ImportError:
        logger.error("google-auth required for Play verification")
        return None
    try:
        info = json.loads(GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)
    except json.JSONDecodeError:
        logger.error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON")
        return None
    creds = service_account.Credentials.from_service_account_info(
        info,
        scopes=["https://www.googleapis.com/auth/androidpublisher"],
    )
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def _google_subscription_state(
    *, purchase_token: str, subscription_id: Optional[str] = None
) -> Dict[str, Any]:
    token = _google_access_token()
    if not token:
        return {}
    url = (
        f"https://androidpublisher.googleapis.com/androidpublisher/v3/"
        f"applications/{GOOGLE_PLAY_PACKAGE}/purchases/subscriptionsv2/tokens/"
        f"{purchase_token}"
    )
    try:
        res = requests.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=20,
        )
        if res.status_code != 200:
            logger.warning(
                "google subscription lookup failed: %s %s",
                res.status_code,
                res.text[:200],
            )
            return {}
        return res.json() if res.content else {}
    except Exception:
        logger.exception("google subscription lookup error")
        return {}


def _verify_jws_signature(signed: str) -> Tuple[bool, Dict[str, Any]]:
    try:
        from cryptography import x509  # type: ignore
        from cryptography.hazmat.primitives import hashes  # type: ignore
        from cryptography.hazmat.primitives.asymmetric import ec  # type: ignore
    except ImportError:
        logger.error("cryptography required for Apple JWS verification")
        return False, {}

    parts = signed.split(".")
    if len(parts) != 3:
        return False, {}
    header_b64, payload_b64, signature_b64 = parts
    try:
        header_pad = "=" * (-len(header_b64) % 4)
        header = json.loads(
            base64.urlsafe_b64decode(header_b64 + header_pad).decode("utf-8")
        )
        x5c = header.get("x5c") or []
        if not x5c:
            return False, {}
        cert_der = base64.b64decode(x5c[0])
        cert = x509.load_der_x509_certificate(cert_der)
        public_key = cert.public_key()
        sig_pad = "=" * (-len(signature_b64) % 4)
        signature = base64.urlsafe_b64decode(signature_b64 + sig_pad)
        signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
        public_key.verify(signature, signing_input, ec.ECDSA(hashes.SHA256()))
        payload_pad = "=" * (-len(payload_b64) % 4)
        payload = json.loads(
            base64.urlsafe_b64decode(payload_b64 + payload_pad).decode("utf-8")
        )
        return True, payload
    except Exception:
        logger.debug("Apple JWS signature verification failed", exc_info=True)
        return False, {}
