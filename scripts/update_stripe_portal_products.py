#!/usr/bin/env python3
"""Add C-Point products/prices to the Stripe Customer Portal configuration.

Preserves existing portal products; merges Steve (and optional extras) by product ID.
Requires a Stripe secret key in ``STRIPE_API_KEY`` (use ``sk_live_*`` for production).

Example (live portal)::

    $env:STRIPE_API_KEY = "sk_live_..."
    python scripts/update_stripe_portal_products.py --dry-run
    python scripts/update_stripe_portal_products.py --apply
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict, List, Set, Tuple
from urllib.parse import urlencode

try:
    import requests
except ImportError:
    print("Install requests: pip install requests", file=sys.stderr)
    raise SystemExit(1)

STRIPE_API = "https://api.stripe.com/v1"

# Keep in sync with docs/OPERATIONS.md
LIVE_PRODUCT_PRICES: List[Tuple[str, str]] = [
    ("prod_UXYqkaOd6YATM6", "price_1TYaE2DHGQ57hB63fjGqo2nZ"),  # Community L1
    ("prod_UXYqHus7wwKLKZ", "price_1TYaE2DHGQ57hB63Vr9ugl3Z"),  # Community L2
    ("prod_UXYrJl0cGC6jsB", "price_1TYaE2DHGQ57hB63cnv6WV3h"),  # Community L3
    ("prod_UYEN3sAR4LrZpq", "price_1TZ7ubDHGQ57hB63F2iLp3sL"),  # Steve Community Package
]

TEST_PRODUCT_PRICES: List[Tuple[str, str]] = [
    ("prod_UOabbTE4ZPAruI", "price_1TPnQ2DHGQ57hB63BG4aiSeC"),  # Community L1 (test)
    ("prod_UOabVw6R3Be3ST", "price_1TPnQjDHGQ57hB63INsuMpzj"),  # Community L2 (test)
    ("prod_UOacqvieetwSZx", "price_1TPnRJDHGQ57hB63PwqpliTF"),  # Community L3 (test)
    ("prod_UUaAZq6nO2Jiu9", "price_1TVb03DHGQ57hB634kqTt5Gz"),  # Steve Community Package (test)
]

STEVE_PRODUCT_BY_MODE = {
    "live": "prod_UYEN3sAR4LrZpq",
    "test": "prod_UUaAZq6nO2Jiu9",
}


def _stripe_key() -> str:
    key = (os.environ.get("STRIPE_API_KEY") or "").strip()
    if not key:
        raise SystemExit("Set STRIPE_API_KEY (sk_live_* for production portal).")
    return key


def _request(method: str, path: str, *, params: Dict[str, Any] | None = None, data: Dict[str, Any] | None = None) -> Dict[str, Any]:
    url = f"{STRIPE_API}{path}"
    if params:
        url = f"{url}?{urlencode(params, doseq=True)}"
    resp = requests.request(
        method,
        url,
        auth=(_stripe_key(), ""),
        data=data,
        timeout=60,
    )
    try:
        body = resp.json()
    except Exception:
        body = {"error": {"message": resp.text[:500]}}
    if not resp.ok:
        msg = body.get("error", {}).get("message") or resp.text
        raise SystemExit(f"Stripe API {method} {path} failed ({resp.status_code}): {msg}")
    return body


def _list_default_portal_configuration() -> Dict[str, Any]:
    configs = _request("GET", "/billing_portal/configurations", params={"limit": 20, "active": "true"})
    data = configs.get("data") or []
    if not data:
        raise SystemExit("No active billing portal configuration found.")
    for cfg in data:
        if cfg.get("is_default"):
            return cfg
    return data[0]


def _get_configuration(config_id: str) -> Dict[str, Any]:
    return _request(
        "GET",
        f"/billing_portal/configurations/{config_id}",
        params={"expand[]": "features.subscription_update.products"},
    )


def _merge_products(
    existing: List[Dict[str, Any]],
    desired: List[Tuple[str, str]],
) -> List[Dict[str, str]]:
    by_product: Dict[str, Set[str]] = {}
    for row in existing or []:
        pid = row.get("product")
        if not pid:
            continue
        prices = set(row.get("prices") or [])
        by_product.setdefault(pid, set()).update(prices)
    for product_id, price_id in desired:
        by_product.setdefault(product_id, set()).add(price_id)
    return [
        {"product": pid, "prices": sorted(prices)}
        for pid, prices in sorted(by_product.items())
    ]


def _form_body(products: List[Dict[str, str]], *, subscription_update_enabled: bool) -> Dict[str, str]:
    body: Dict[str, str] = {
        "features[subscription_update][enabled]": "true" if subscription_update_enabled else "false",
    }
    for idx, row in enumerate(products):
        body[f"features[subscription_update][products][{idx}][product]"] = row["product"]
        for pidx, price_id in enumerate(row["prices"]):
            body[f"features[subscription_update][products][{idx}][prices][{pidx}]"] = price_id
    return body


def main() -> int:
    parser = argparse.ArgumentParser(description="Merge Steve + community prices into Stripe Customer Portal")
    parser.add_argument("--apply", action="store_true", help="POST update (default is dry-run)")
    parser.add_argument("--dry-run", action="store_true", help="Print planned merge only")
    parser.add_argument(
        "--config-id",
        default="",
        help="Portal configuration id (bpc_...). Default: active is_default config.",
    )
    args = parser.parse_args()
    dry_run = args.dry_run or not args.apply

    key = _stripe_key()
    mode = "live" if key.startswith("sk_live_") else "test"
    print(f"[portal] Stripe key mode: {mode}")

    cfg = _list_default_portal_configuration() if not args.config_id else {"id": args.config_id}
    config_id = cfg["id"]
    full = _get_configuration(config_id)
    print(f"[portal] Configuration {config_id} (livemode={full.get('livemode')}, default={full.get('is_default')})")

    sub_update = (full.get("features") or {}).get("subscription_update") or {}
    if not sub_update.get("enabled"):
        print("[portal] WARNING: subscription_update is disabled on this configuration.")

    desired = LIVE_PRODUCT_PRICES if mode == "live" else TEST_PRODUCT_PRICES
    existing_products = sub_update.get("products") or []
    merged = _merge_products(existing_products, desired)

    print("[portal] Current products:")
    for row in existing_products:
        print(f"  - {row.get('product')}: {row.get('prices')}")
    print("[portal] After merge:")
    for row in merged:
        print(f"  - {row['product']}: {row['prices']}")

    steve_pid = STEVE_PRODUCT_BY_MODE[mode]
    steve_present = any(r["product"] == steve_pid for r in merged)
    if not steve_present:
        raise SystemExit("Steve product missing after merge — aborting.")

    if dry_run:
        print("[portal] Dry-run only. Re-run with --apply to update Stripe.")
        return 0

    body = _form_body(merged, subscription_update_enabled=bool(sub_update.get("enabled", True)))
    updated = _request("POST", f"/billing_portal/configurations/{config_id}", data=body)
    print(f"[portal] Updated {updated.get('id')} at {updated.get('updated')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
