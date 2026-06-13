"""One-time: grant the 14-day Steve Package trial to existing root communities.

Run alongside the networking B2B-gate deploy. Without this, the 37 root
communities created before the trial feature have no package/trial and would
lose networking the moment the gate goes live. New communities already get the
trial automatically on creation (community_billing.grant_steve_package_trial);
this backfills the existing ones.

Safe / idempotent: grant_steve_package_trial refuses to overwrite a community
that already has a Steve Package record (paid OR a prior trial), so re-running
skips them. Only root communities with NO existing steve_package_* record get a
fresh 14-day trial.

Usage (dry run first):
    python scripts/grant_networking_trials_to_existing_communities.py --dry-run
    python scripts/grant_networking_trials_to_existing_communities.py --commit
"""

from __future__ import annotations

import argparse
import logging

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("grant_trials")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="Actually grant trials (default is dry-run).")
    ap.add_argument("--dry-run", action="store_true", help="List eligible communities without granting.")
    args = ap.parse_args()
    commit = args.commit and not args.dry_run

    from backend.services.database import get_db_connection, get_sql_placeholder
    from backend.services import community_billing

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        cur = conn.cursor()
        # Root communities (no parent) with no Steve Package record at all.
        cur.execute(
            "SELECT id, name FROM communities "
            "WHERE parent_community_id IS NULL "
            "AND (steve_package_stripe_subscription_id IS NULL "
            "     OR steve_package_stripe_subscription_id = '') "
            "ORDER BY id"
        )
        rows = cur.fetchall()

    eligible = [(r["id"], r.get("name")) if isinstance(r, dict) else (r[0], r[1]) for r in rows]
    log.info("Eligible root communities without a Steve Package: %d", len(eligible))
    for cid, name in eligible:
        log.info("  - %s (id=%s)", name, cid)

    if not commit:
        log.info("\nDRY RUN — no trials granted. Re-run with --commit to apply.")
        return 0

    granted = 0
    skipped = 0
    for cid, name in eligible:
        ok = community_billing.grant_steve_package_trial(cid)
        if ok:
            granted += 1
            log.info("granted trial: %s (id=%s)", name, cid)
        else:
            skipped += 1
            log.info("skipped (already had a package or not root): %s (id=%s)", name, cid)
    log.info("\nDone. granted=%d skipped=%d", granted, skipped)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
