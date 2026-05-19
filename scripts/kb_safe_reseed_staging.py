#!/usr/bin/env python3
"""Safe KB reseed on staging MySQL — merge new fields only, preserve admin edits.

Does **not** use force=True. For edited pages, ``seed_default_pages`` only
appends field definitions that are missing by name; existing values, labels,
help text, and ``body_markdown`` stay unchanged.

After merge, optionally bumps **policy** scalar fields from in-code seed when
the DB still holds a known pre-deploy default (so we ship 19.99 / 49.99 without
wiping custom ops values).

Run (Cloud SQL proxy on 127.0.0.1:3307 recommended)::

    python scripts/kb_safe_reseed_staging.py

    python scripts/kb_safe_reseed_staging.py --slug credits-entitlements
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _REPO)

PROJECT = "cpoint-127c2"
DEFAULT_HOST = os.environ.get("MYSQL_HOST", "127.0.0.1")
DEFAULT_PORT = os.environ.get("MYSQL_PORT", "3307")
DEFAULT_USER = os.environ.get("MYSQL_USER", "app_user")
DEFAULT_DB = os.environ.get("MYSQL_DB", "cpoint")
PASSWORD_SECRET = "mysql-password"

DEFAULT_SLUGS = ("credits-entitlements", "community-tiers")

# field_name -> list of legacy values that may be upgraded to seed value
POLICY_FIELD_STALE_VALUES: Dict[str, List[Any]] = {
    "paid_steve_package_monthly_provider_cost_ceiling_usd": [5, 5.0, "5", "5.00"],
    "paid_steve_package_price_eur_monthly": [49, 49.0, "49", "49.00"],
    "credit_tier_standard_max_tokens_in": [12000, "12000"],
    "credit_addon_web_search": [1, 1.0, "1", "1.00"],
}


def fetch_password_from_secrets() -> str:
    if os.environ.get("MYSQL_PASSWORD"):
        print("[kb-reseed] Using MYSQL_PASSWORD from env", file=sys.stderr)
        return os.environ["MYSQL_PASSWORD"]
    gcloud_bin = os.environ.get("GCLOUD_BIN", "gcloud")
    if os.name == "nt" and gcloud_bin == "gcloud":
        gcloud_bin = "gcloud.cmd"
    cmd = [
        gcloud_bin,
        "secrets",
        "versions",
        "access",
        "latest",
        f"--secret={PASSWORD_SECRET}",
        f"--project={PROJECT}",
    ]
    pw = subprocess.check_output(cmd, text=True, stderr=subprocess.PIPE, shell=(os.name == "nt")).strip()
    if not pw:
        raise SystemExit(f"Secret {PASSWORD_SECRET!r} returned empty.")
    return pw


def _configure_env() -> None:
    os.environ.setdefault("DB_BACKEND", "mysql")
    os.environ["MYSQL_HOST"] = DEFAULT_HOST
    os.environ["MYSQL_PORT"] = str(DEFAULT_PORT)
    os.environ["MYSQL_USER"] = DEFAULT_USER
    os.environ["MYSQL_DB"] = DEFAULT_DB
    os.environ["MYSQL_PASSWORD"] = fetch_password_from_secrets()


def _seed_field_map(slug: str) -> Dict[str, Dict[str, Any]]:
    from backend.services.knowledge_base import _seed_pages

    for page in _seed_pages():
        if page.get("slug") == slug:
            return {
                str(f.get("name")): f
                for f in (page.get("fields") or [])
                if f.get("name")
            }
    return {}


def _values_equal(a: Any, b: Any) -> bool:
    try:
        if a is None and b is None:
            return True
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            return float(a) == float(b)
        return str(a).strip() == str(b).strip()
    except Exception:
        return False


def _sync_stale_policy_fields(slug: str, dry_run: bool) -> Tuple[int, List[str]]:
    """Update field values only when DB still has a known legacy default."""
    from backend.services.database import get_db_connection, get_sql_placeholder
    from backend.services.knowledge_base import get_page

    seed_by_name = _seed_field_map(slug)
    if not seed_by_name:
        return 0, []

    page = get_page(slug)
    if not page:
        return 0, []

    fields: List[Dict[str, Any]] = list(page.get("fields") or [])
    changed: List[str] = []
    for field in fields:
        name = str(field.get("name") or "")
        if name not in POLICY_FIELD_STALE_VALUES or name not in seed_by_name:
            continue
        current = field.get("value")
        stale_list = POLICY_FIELD_STALE_VALUES[name]
        if not any(_values_equal(current, stale) for stale in stale_list):
            continue
        new_val = seed_by_name[name].get("value")
        if _values_equal(current, new_val):
            continue
        field["value"] = new_val
        changed.append(f"{name}: {current!r} -> {new_val!r}")

    if not changed or dry_run:
        return len(changed), changed

    ph = get_sql_placeholder()
    import json as _json
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    new_version = int(page.get("version") or 1) + 1
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            UPDATE kb_pages SET
                fields_json = {ph},
                version = {ph},
                updated_by = {ph},
                updated_at = {ph}
            WHERE slug = {ph}
            """,
            (_json.dumps(fields), new_version, "kb-safe-reseed-script", now, slug),
        )
        c.execute(
            f"""
            INSERT INTO kb_changelog
                (page_slug, version_from, version_to, changed_fields_json,
                 reason, actor_username, created_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (
                slug,
                page.get("version"),
                new_version,
                _json.dumps({"policy_field_sync": changed}),
                "Sync stale policy defaults after Steve weighting deploy",
                "kb-safe-reseed-script",
                now,
            ),
        )
        conn.commit()
    return len(changed), changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe KB merge reseed on staging MySQL")
    parser.add_argument(
        "--slug",
        action="append",
        dest="slugs",
        help="Page slug (repeatable). Default: credits-entitlements + community-tiers",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print actions only")
    args = parser.parse_args()
    slugs = args.slugs or list(DEFAULT_SLUGS)

    _configure_env()
    from backend.services.knowledge_base import seed_default_pages

    print("[kb-reseed] Safe merge (force=False) — existing field values and body preserved.")
    for slug in slugs:
        if args.dry_run:
            print(f"  would merge seed into {slug!r}")
            continue
        result = seed_default_pages(force=False, slug=slug, actor_username="kb-safe-reseed-script")
        print(f"[kb-reseed] {slug}: {json.dumps(result, indent=2)}")
        n, names = _sync_stale_policy_fields(slug, dry_run=False)
        if n:
            print(f"[kb-reseed] {slug}: synced {n} stale policy field(s): {', '.join(names)}")
        else:
            print(f"[kb-reseed] {slug}: no stale policy fields to sync (custom values kept)")

    print("[kb-reseed] Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
