"""Generate the landing site's pricing data from the in-app KB seeds.

The Knowledge Base (backend/services/knowledge_base.py) is the source of
truth for pricing, caps, and trial policy. The landing site is a separate
Vite app that can't query the KB at runtime — so this script extracts the
public, owner-funnel-relevant numbers from the KB **seed definitions** into
a committed JSON artifact the landing pages import instead of hard-coding
prices in copy.

Usage (repo root):

    python scripts/generate_landing_pricing.py            # write the file
    python scripts/generate_landing_pricing.py --check    # exit 1 on drift

Output: landing/src/generated/pricing.json (committed; the landing build
needs no Python). `tests/test_landing_pricing_parity.py` runs the --check
mode logic in CI so a KB repricing that forgets to regenerate fails the
build instead of shipping a stale price to the public site.

Note: this reads the SEEDS, not the live DB. Admin-edited KB values on a
deployed instance are runtime state; the landing site advertises the
default public pricing, which is exactly what the seeds define.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

OUTPUT_PATH = REPO_ROOT / "landing" / "src" / "generated" / "pricing.json"


def _seed_fields(slug: str) -> dict:
    """Return {field_name: field_dict} for one seed page."""
    from backend.services.knowledge_base import _seed_pages

    for page in _seed_pages():
        if page.get("slug") == slug:
            return {f["name"]: f for f in page.get("fields") or [] if f.get("name")}
    raise SystemExit(f"KB seed page not found: {slug}")


def _value(fields: dict, name: str):
    """Public value for a field — TBD fields export as None (render 'TBD',
    never a stale number)."""
    f = fields.get(name)
    if f is None:
        raise SystemExit(f"KB seed field not found: {name}")
    if f.get("tbd"):
        return None
    value = f.get("value")
    return None if value == "" else value


def build_pricing() -> dict:
    """Assemble the landing pricing payload from KB seeds."""
    user_tiers = _seed_fields("user-tiers")
    community_tiers = _seed_fields("community-tiers")

    return {
        "_generated_by": "scripts/generate_landing_pricing.py — do not edit by hand",
        "_source": "backend/services/knowledge_base.py seeds (KB is the source of truth)",
        "currency": "EUR",
        "personal": {
            "premium_monthly_early_eur": _value(user_tiers, "premium_price_early_eur"),
            "premium_monthly_standard_eur": _value(user_tiers, "premium_price_standard_eur"),
        },
        "community_tiers": [
            {
                "code": "free",
                "price_eur_monthly": 0,
                "max_members": _value(community_tiers, "free_community_max_members"),
            },
            {
                "code": "paid_l1",
                "price_eur_monthly": _value(community_tiers, "paid_l1_price_eur_monthly"),
                "max_members": _value(community_tiers, "paid_l1_max_members"),
            },
            {
                "code": "paid_l2",
                "price_eur_monthly": _value(community_tiers, "paid_l2_price_eur_monthly"),
                "max_members": _value(community_tiers, "paid_l2_max_members"),
            },
            {
                "code": "paid_l3",
                "price_eur_monthly": _value(community_tiers, "paid_l3_price_eur_monthly"),
                "max_members": _value(community_tiers, "paid_l3_max_members"),
            },
            {
                "code": "enterprise",
                "price_eur_monthly": _value(community_tiers, "enterprise_starting_price_eur"),
                "max_members": None,
            },
        ],
        "steve_package": {
            "price_eur_monthly": _value(community_tiers, "paid_steve_package_price_eur_monthly"),
            "monthly_credit_pool": _value(community_tiers, "paid_steve_package_monthly_credit_pool"),
            "trial_days": _value(community_tiers, "steve_package_trial_days"),
        },
        "trials": {
            "paid_community_trial_days": _value(community_tiers, "paid_trial_duration_days"),
        },
    }


def render(payload: dict) -> str:
    """Deterministic serialization so drift checks can compare exactly."""
    return json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="verify the committed artifact matches the KB seeds")
    args = parser.parse_args()

    expected = render(build_pricing())

    if args.check:
        if not OUTPUT_PATH.exists():
            print(f"MISSING: {OUTPUT_PATH} — run: python scripts/generate_landing_pricing.py")
            return 1
        actual = OUTPUT_PATH.read_text(encoding="utf-8")
        if actual != expected:
            print("DRIFT: landing pricing artifact is stale vs KB seeds.")
            print("Fix:   python scripts/generate_landing_pricing.py")
            return 1
        print("OK: landing pricing matches KB seeds.")
        return 0

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(expected, encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
