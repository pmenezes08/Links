"""Apple In-App Purchase facade."""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

from backend.services import iap_links, mobile_iap


def config() -> Dict[str, Any]:
    return mobile_iap.config().get(iap_links.PROVIDER_APPLE, {})


def confirm_purchase(
    *,
    username: str,
    product_id: str,
    purchase_key: str,
    community_id: Optional[int] = None,
    signed_payload: Optional[str] = None,
    environment: Optional[str] = None,
    expires_at: Any = None,
) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    return mobile_iap.confirm_purchase(
        provider=iap_links.PROVIDER_APPLE,
        username=username,
        product_id=product_id,
        purchase_key=purchase_key,
        community_id=community_id,
        signed_payload=signed_payload,
        environment=environment,
        expires_at=expires_at,
    )
