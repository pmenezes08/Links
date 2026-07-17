"""Landing pricing artifact must match the KB seeds — no silent price drift.

`landing/src/generated/pricing.json` is generated from the KB seed
definitions by `scripts/generate_landing_pricing.py` and committed so the
landing build needs no Python. This test is the CI tripwire: reprice in
`knowledge_base.py` without regenerating and the build goes red instead of
the public site advertising a stale price.

No DB needed — both sides read the seed definitions, not runtime state.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_generator():
    spec = importlib.util.spec_from_file_location(
        "generate_landing_pricing",
        REPO_ROOT / "scripts" / "generate_landing_pricing.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_artifact_exists_and_matches_kb_seeds():
    gen = _load_generator()
    artifact = REPO_ROOT / "landing" / "src" / "generated" / "pricing.json"
    assert artifact.exists(), (
        "landing/src/generated/pricing.json missing — "
        "run: python scripts/generate_landing_pricing.py"
    )
    assert artifact.read_text(encoding="utf-8") == gen.render(gen.build_pricing()), (
        "Landing pricing artifact is stale vs KB seeds — "
        "run: python scripts/generate_landing_pricing.py"
    )


def test_public_shape_is_complete():
    """The keys the landing pages rely on must exist and be sane."""
    gen = _load_generator()
    payload = gen.build_pricing()

    assert payload["currency"] == "EUR"
    assert payload["personal"]["premium_monthly_early_eur"] > 0
    assert payload["personal"]["premium_monthly_standard_eur"] > 0

    tiers = {t["code"]: t for t in payload["community_tiers"]}
    assert set(tiers) == {"free", "paid_l1", "paid_l2", "paid_l3", "enterprise"}
    assert tiers["free"]["price_eur_monthly"] == 0
    # Paid ladder is strictly increasing in both price and cap.
    ladder = [tiers["paid_l1"], tiers["paid_l2"], tiers["paid_l3"]]
    prices = [t["price_eur_monthly"] for t in ladder]
    caps = [t["max_members"] for t in ladder]
    assert prices == sorted(prices) and len(set(prices)) == 3
    assert caps == sorted(caps) and len(set(caps)) == 3

    assert payload["steve_package"]["price_eur_monthly"] > 0
    assert payload["steve_package"]["trial_days"] > 0
    assert payload["trials"]["paid_community_trial_days"] > 0


def test_artifact_is_valid_json_with_no_hand_edits_marker():
    artifact = REPO_ROOT / "landing" / "src" / "generated" / "pricing.json"
    data = json.loads(artifact.read_text(encoding="utf-8"))
    assert "do not edit by hand" in data["_generated_by"]
