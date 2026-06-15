#!/usr/bin/env python3
"""Read-only Stripe catalog verifier for C-Point subscriptions.

Lists products + recurring prices for the account behind ``STRIPE_API_KEY``
and cross-checks them against the price IDs the Knowledge Base expects, so we
can confirm what's configured in **test** vs **live** mode and discover the
test-mode price IDs needed to populate the empty ``*_stripe_price_id_test``
KB fields (the cause of staging's "coming soon").

This script performs ONLY list/retrieve calls — it never creates, updates, or
deletes anything in Stripe.

Usage (run once per mode):

    # live
    $env:STRIPE_API_KEY = "sk_live_..."      # PowerShell
    python scripts/verify_stripe_catalog.py

    # test
    $env:STRIPE_API_KEY = "sk_test_..."
    python scripts/verify_stripe_catalog.py

    # bash
    STRIPE_API_KEY=sk_test_... python scripts/verify_stripe_catalog.py

Paste the output back. The key is read from env and never printed.
"""

from __future__ import annotations

import os
import sys

try:
    import stripe  # type: ignore
except ImportError:
    sys.exit("stripe SDK not installed — run: pip install stripe")

# Price IDs the KB seeds for LIVE mode (knowledge_base.py / docs/OPERATIONS.md).
# In test mode these are expected to be EMPTY in the KB — this script reports
# whichever recurring prices DO exist in test so they can be seeded.
EXPECTED_LIVE = {
    "premium_monthly":      ("price_1TYTiwDHGQ57hB639I1hXI9U", 799),
    "community_l1_monthly": ("price_1TYaE2DHGQ57hB63fjGqo2nZ", 4999),
    "community_l2_monthly": ("price_1TYaE2DHGQ57hB63Vr9ugl3Z", 9999),
    "community_l3_monthly": ("price_1TYaE2DHGQ57hB63cnv6WV3h", 18999),
    "steve_package_monthly":("price_1TZ7ubDHGQ57hB63F2iLp3sL", 4999),
    # networking: intentionally unconfigured (deferred)
}


def _mode(key: str) -> str:
    return "live" if key.startswith("sk_live_") else "test"


def main() -> int:
    key = (os.getenv("STRIPE_API_KEY") or "").strip()
    if not key or not key.startswith("sk_"):
        return _fail("STRIPE_API_KEY missing or not a secret key (sk_...).")
    stripe.api_key = key
    mode = _mode(key)

    try:
        acct = stripe.Account.retrieve()
    except Exception as exc:  # noqa: BLE001
        return _fail(f"Stripe auth failed: {exc}")

    print(f"\n=== Stripe catalog — mode={mode.upper()}  account={acct.get('id')} ===\n")

    # Enumerate active products + their recurring prices.
    products = list(stripe.Product.list(active=True, limit=100).auto_paging_iter())
    prices = list(stripe.Price.list(active=True, limit=100).auto_paging_iter())
    by_product: dict[str, list] = {}
    for p in prices:
        if p.get("type") != "recurring":
            continue
        by_product.setdefault(p.get("product"), []).append(p)

    for prod in sorted(products, key=lambda x: (x.get("name") or "").lower()):
        pid = prod.get("id")
        plist = by_product.get(pid, [])
        print(f"• {prod.get('name')}  ({pid})  active={prod.get('active')}")
        if not plist:
            print("    (no active recurring price)")
        for pr in plist:
            amt = pr.get("unit_amount")
            cur = (pr.get("currency") or "").upper()
            rec = pr.get("recurring") or {}
            interval = rec.get("interval")
            disp = f"{amt/100:.2f} {cur}" if amt is not None else "metered/none"
            print(f"    {pr.get('id')}  {disp} / {interval}  active={pr.get('active')}")
        print()

    # KB expectation cross-check.
    print(f"--- KB expectation check ({mode}) ---")
    all_price_ids = {pr.get("id") for pr in prices}
    if mode == "live":
        for label, (want_id, want_amt) in EXPECTED_LIVE.items():
            if want_id in all_price_ids:
                pr = next(p for p in prices if p.get("id") == want_id)
                ok = pr.get("unit_amount") == want_amt and pr.get("active")
                flag = "OK " if ok else "CHECK"
                print(f"  [{flag}] {label:24s} {want_id} "
                      f"(amount={pr.get('unit_amount')} active={pr.get('active')})")
            else:
                print(f"  [MISSING] {label:24s} {want_id} — NOT FOUND in this account/mode")
    else:
        print("  Test mode: KB *_stripe_price_id_test fields are expected EMPTY.")
        print("  Use the recurring price IDs listed above to populate them in admin-web,")
        print("  matching: premium / community L1-L3 / steve package.")
    print()
    return 0


def _fail(msg: str) -> int:
    print(f"ERROR: {msg}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
