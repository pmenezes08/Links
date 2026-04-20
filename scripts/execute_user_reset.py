"""Phase B3 — execute the non-exempt user reset.

==============================================================================
  DESTRUCTIVE — WRITES TO PRODUCTION cpoint-db.

  Before running:
    1. Take an on-demand Cloud SQL backup
       (`gcloud sql backups create --instance=cpoint-db --description=...`).
    2. Re-read EXEMPT below and confirm it still covers all service /
       admin / bot accounts. As of 2026-04-20 it is paulo, admin, steve.
    3. Run scripts/preflight_reset_survey.py first and sanity-check the
       counts (especially active enterprise seats and over-cap communities).
    4. Confirm with the stakeholder that ``created_at = NOW()`` (fresh
       30-day trial for all non-exempt users) is still the desired
       behaviour. If they want "truly free, no trial", change Step 4
       to ``DATE_SUB(NOW(), INTERVAL 31 DAY)``.

  Last intended run: 2026-04-20 (Phase B of the post-deploy reset).
==============================================================================

Exempts: paulo, admin, steve.

Performs four writes, each in its own transaction, with a SELECT COUNT(*)
pre-check printed before the UPDATE so row counts can be eyeballed:

  1. subscription -> 'free'
  2. clear is_special + related columns (defensive)
  3. close any active enterprise seats (defensive)
  4. created_at -> NOW()  (fresh 30-day trial for all non-exempt users)

Exits non-zero if any UPDATE affects a row count that disagrees with the
pre-count by more than 1 (concurrent signups during the run get a single-row
tolerance). Bails immediately on any exception — no partial commits.
"""

from __future__ import annotations

import os
import sys

import pymysql

HOST = os.environ.get("MYSQL_HOST", "34.78.168.84")
USER = os.environ.get("MYSQL_USER", "app_user")
DB = os.environ.get("MYSQL_DB", "cpoint")
PWD = os.environ.get("MYSQL_PASSWORD")

EXEMPT = ("paulo", "admin", "steve")

if not PWD:
    print("ERROR: MYSQL_PASSWORD not set.")
    sys.exit(2)

placeholders = ", ".join(["%s"] * len(EXEMPT))
exempt_params = tuple(u.lower() for u in EXEMPT)


def run_step(conn, label: str, pre_sql: str, upd_sql: str, params) -> None:
    c = conn.cursor()
    c.execute(pre_sql, params)
    pre = c.fetchone()[0]
    print(f"\n--- {label} ---")
    print(f"  pre-count (rows that will be touched): {pre}")
    if pre == 0:
        print("  nothing to do, skipping UPDATE")
        return
    try:
        conn.begin()
        c.execute(upd_sql, params)
        affected = c.rowcount
        print(f"  UPDATE affected: {affected}")
        if abs(affected - pre) > 1:
            conn.rollback()
            raise RuntimeError(
                f"row count mismatch (pre={pre}, updated={affected}); rolled back"
            )
        conn.commit()
        print("  committed")
    except Exception:
        conn.rollback()
        raise


def main() -> None:
    conn = pymysql.connect(
        host=HOST, user=USER, password=PWD, database=DB,
        charset="utf8mb4", autocommit=False, connect_timeout=10,
    )
    print("=" * 72)
    print("PHASE B3 — USER RESET (writing)")
    print(f"Exempt: {EXEMPT}")
    print("=" * 72)

    # 1. subscription -> 'free'
    run_step(
        conn,
        "Step 1: subscription -> 'free'",
        f"SELECT COUNT(*) FROM users "
        f"WHERE LOWER(username) NOT IN ({placeholders}) "
        f"AND (subscription IS NULL OR subscription <> 'free')",
        f"UPDATE users SET subscription = 'free' "
        f"WHERE LOWER(username) NOT IN ({placeholders}) "
        f"AND (subscription IS NULL OR subscription <> 'free')",
        exempt_params,
    )

    # 2. clear is_special (defensive — survey showed 0 rows)
    run_step(
        conn,
        "Step 2: clear is_special on non-exempt",
        f"SELECT COUNT(*) FROM users "
        f"WHERE LOWER(username) NOT IN ({placeholders}) AND is_special = 1",
        f"UPDATE users SET is_special = 0, special_granted_by = NULL, "
        f"special_granted_at = NULL, special_reason = NULL, special_expires_at = NULL "
        f"WHERE LOWER(username) NOT IN ({placeholders}) AND is_special = 1",
        exempt_params,
    )

    # 3. close active enterprise seats (defensive — survey showed 0 rows)
    run_step(
        conn,
        "Step 3: close active enterprise seats",
        f"SELECT COUNT(*) FROM user_enterprise_seats "
        f"WHERE ended_at IS NULL AND LOWER(username) NOT IN ({placeholders})",
        f"UPDATE user_enterprise_seats SET ended_at = NOW() "
        f"WHERE ended_at IS NULL AND LOWER(username) NOT IN ({placeholders})",
        exempt_params,
    )

    # 4. created_at -> NOW()
    run_step(
        conn,
        "Step 4: created_at -> NOW() (fresh 30-day trial)",
        f"SELECT COUNT(*) FROM users WHERE LOWER(username) NOT IN ({placeholders})",
        f"UPDATE users SET created_at = NOW() "
        f"WHERE LOWER(username) NOT IN ({placeholders})",
        exempt_params,
    )

    conn.close()
    print("\n" + "=" * 72)
    print("PHASE B3 COMPLETE")
    print("=" * 72)


if __name__ == "__main__":
    main()
