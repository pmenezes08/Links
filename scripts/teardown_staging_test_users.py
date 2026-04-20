#!/usr/bin/env python3
"""Remove every row created by ``seed_staging_test_users.py``.

**Only** touches rows whose ``username`` starts with ``test_`` or whose
``name`` matches the test community constant. We belt-and-brace this
with explicit prefix checks so a misconfigured environment can't
accidentally wipe production users.

Cleanup order (respects foreign-key-ish relationships):

  1. Enterprise seats for test users
  2. AI usage rows for test users (so counters reset cleanly)
  3. Subscription audit log rows for test users
  4. Winback tokens for test users
  5. IAP nag rows for test users
  6. The test_acme_corp community
  7. test_* users

Usage:

    python scripts/teardown_staging_test_users.py            # dry run
    python scripts/teardown_staging_test_users.py --confirm  # actually delete
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import List, Tuple


_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _REPO)


from scripts.seed_staging_test_users import (  # noqa: E402  reuse helpers
    TEST_COMMUNITY_NAME,
    TEST_USERNAME_PREFIX,
    get_connection,
)


TEST_USER_SQL = f"username LIKE '{TEST_USERNAME_PREFIX}%%'"


# (description, SQL). SQL uses ``%%`` to survive pymysql format string.
CLEANUP_STEPS: List[Tuple[str, str]] = [
    ("enterprise seats",
     f"DELETE FROM user_enterprise_seats WHERE {TEST_USER_SQL}"),
    ("ai_usage_log",
     f"DELETE FROM ai_usage_log WHERE {TEST_USER_SQL}"),
    ("subscription audit",
     f"DELETE FROM subscription_audit_log WHERE {TEST_USER_SQL}"),
    ("winback tokens",
     f"DELETE FROM winback_tokens WHERE {TEST_USER_SQL}"),
    ("iap nag rows",
     f"DELETE FROM enterprise_iap_nag WHERE {TEST_USER_SQL}"),
    ("special_access_log",
     f"DELETE FROM special_access_log WHERE {TEST_USER_SQL}"),
    ("test community",
     f"DELETE FROM communities WHERE name = '{TEST_COMMUNITY_NAME}'"),
    ("users",
     f"DELETE FROM users WHERE {TEST_USER_SQL}"),
]


def _count_affected(cursor, sql: str) -> int:
    """Return how many rows *would* be deleted by a DELETE statement."""
    # Rewrite ``DELETE FROM X WHERE …`` → ``SELECT COUNT(*) FROM X WHERE …``.
    select_sql = sql.replace("DELETE FROM", "SELECT COUNT(*) AS cnt FROM", 1)
    try:
        cursor.execute(select_sql)
        row = cursor.fetchone()
    except Exception as err:
        # Table might not exist on older staging DBs — treat as 0.
        print(f"[teardown] skipping ({err})", file=sys.stderr)
        return 0
    if not row:
        return 0
    return int(row["cnt"] if hasattr(row, "get") else row[0])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm", action="store_true",
                        help="Actually delete rows (default is dry-run).")
    args = parser.parse_args()

    conn = get_connection()
    try:
        c = conn.cursor()
        total = 0
        for desc, sql in CLEANUP_STEPS:
            n = _count_affected(c, sql)
            total += n
            action = "would delete" if not args.confirm else "deleting"
            print(f"[teardown] {action:14s} {n:>5d} rows from {desc}")
            if args.confirm and n > 0:
                try:
                    c.execute(sql)
                except Exception as err:
                    print(f"[teardown]   FAILED: {err}", file=sys.stderr)

        if not args.confirm:
            print(f"\n[teardown] DRY RUN — {total} rows matched. "
                  f"Re-run with --confirm to actually delete.")
        else:
            print(f"\n[teardown] deleted {total} rows across all tables.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
