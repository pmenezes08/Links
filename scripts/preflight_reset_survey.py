"""Phase B2 — read-only pre-flight survey before the Users reset.

Safe to run any time — this script is read-only. Always re-run this
immediately before invoking ``scripts/execute_user_reset.py`` so the
planned write counts can be confirmed against the current DB state.

Runs four SELECTs against prod ``cpoint-db`` and prints a summary. No writes.

Credentials are read from env:
  * MYSQL_HOST, MYSQL_USER, MYSQL_DB (defaults for prod).
  * MYSQL_PASSWORD — must be set before invocation (we pull from GCP
    Secret Manager: ``gcloud secrets versions access latest --secret=mysql-password``).

Output is designed to be eyeballed: counts first, then per-row lists where
helpful. Intentionally does NOT print any user passwords, emails, or
PII beyond usernames.
"""

from __future__ import annotations

import os
import sys

import pymysql


HOST = os.environ.get("MYSQL_HOST", "34.78.168.84")
USER = os.environ.get("MYSQL_USER", "app_user")
DB = os.environ.get("MYSQL_DB", "cpoint")
PWD = os.environ.get("MYSQL_PASSWORD")

EXEMPT = ("paulo", "admin")

if not PWD:
    print("ERROR: MYSQL_PASSWORD not set in environment.")
    sys.exit(2)


def _connect():
    return pymysql.connect(
        host=HOST, user=USER, password=PWD, database=DB,
        charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
    )


def main() -> None:
    placeholders = ", ".join(["%s"] * len(EXEMPT))
    exempt_params = tuple(u.lower() for u in EXEMPT)

    with _connect() as conn:
        c = conn.cursor()

        # ── 1. Users who will be affected
        c.execute(
            f"""
            SELECT COUNT(*) AS n FROM users
             WHERE LOWER(username) NOT IN ({placeholders})
            """,
            exempt_params,
        )
        total_affected = c.fetchone()["n"]

        c.execute("SELECT COUNT(*) AS n FROM users")
        total_users = c.fetchone()["n"]

        # ── 2. Breakdown of affected users
        c.execute(
            f"""
            SELECT subscription, COUNT(*) AS n
              FROM users
             WHERE LOWER(username) NOT IN ({placeholders})
             GROUP BY subscription
             ORDER BY n DESC
            """,
            exempt_params,
        )
        sub_breakdown = c.fetchall()

        c.execute(
            f"""
            SELECT COUNT(*) AS n FROM users
             WHERE LOWER(username) NOT IN ({placeholders})
               AND is_special = 1
            """,
            exempt_params,
        )
        special_count = c.fetchone()["n"]

        # Malformed created_at: rows whose text form does not start with 20xx
        # (catches the "Invalid Date" and "4/25/201012/26/2001" kind of garbage).
        c.execute(
            f"""
            SELECT COUNT(*) AS n FROM users
             WHERE LOWER(username) NOT IN ({placeholders})
               AND (created_at IS NULL
                    OR CAST(created_at AS CHAR) NOT REGEXP '^20[0-9]{{2}}-[01][0-9]-[0-3][0-9]')
            """,
            exempt_params,
        )
        bad_date_count = c.fetchone()["n"]

        # Trial window (≤ 30 days old).
        c.execute(
            f"""
            SELECT COUNT(*) AS n FROM users
             WHERE LOWER(username) NOT IN ({placeholders})
               AND created_at IS NOT NULL
               AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            """,
            exempt_params,
        )
        currently_trial = c.fetchone()["n"]

        # ── 3. Active enterprise seats held by non-exempt users
        # We need to handle schema variations (column may or may not exist).
        try:
            c.execute(
                f"""
                SELECT s.id, s.username, s.community_slug, s.community_id,
                       s.started_at, s.ended_at, s.grace_until, s.had_personal_premium_at_join
                  FROM user_enterprise_seats s
                 WHERE s.ended_at IS NULL
                   AND LOWER(s.username) NOT IN ({placeholders})
                 ORDER BY s.started_at DESC
                """,
                exempt_params,
            )
            active_seats = c.fetchall()
        except Exception as e:
            active_seats = [{"error": str(e)}]

        # ── 4. Free parent communities already over 25 members
        c.execute(
            f"""
            SELECT c.id, c.name, c.creator_username, COUNT(uc.user_id) AS members
              FROM communities c
              JOIN users u ON u.username = c.creator_username
              LEFT JOIN user_communities uc ON uc.community_id = c.id
             WHERE (c.parent_community_id IS NULL OR c.parent_community_id = '')
               AND LOWER(u.username) NOT IN ({placeholders})
               AND (u.subscription = 'free' OR u.subscription IS NULL)
               AND (u.is_special = 0 OR u.is_special IS NULL)
             GROUP BY c.id, c.name, c.creator_username
            HAVING members > 25
             ORDER BY members DESC
             LIMIT 50
            """,
            exempt_params,
        )
        over_cap = c.fetchall()

        # Also: how many Free parent communities already over Paulo's KB cap=5 owned?
        c.execute(
            f"""
            SELECT u.username, COUNT(*) AS owned
              FROM communities c
              JOIN users u ON u.username = c.creator_username
             WHERE (c.parent_community_id IS NULL OR c.parent_community_id = '')
               AND LOWER(u.username) NOT IN ({placeholders})
             GROUP BY u.username
            HAVING owned > 5
             ORDER BY owned DESC
             LIMIT 50
            """,
            exempt_params,
        )
        over_count_owners = c.fetchall()

    # ── Report
    print("=" * 72)
    print("PHASE B2 — PRE-FLIGHT SURVEY (READ-ONLY)")
    print("=" * 72)
    print(f"Total users in DB             : {total_users}")
    print(f"Affected (non-Paulo/Admin)    : {total_affected}")
    print()
    print("Subscription breakdown for affected users:")
    for row in sub_breakdown:
        sub = row["subscription"] if row["subscription"] is not None else "(null)"
        print(f"  - {sub:20s} : {row['n']}")
    print()
    print(f"Affected users with is_special = 1   : {special_count}")
    print(f"Affected users with bad/invalid date : {bad_date_count}")
    print(f"Affected users currently in trial    : {currently_trial}")
    print()
    print("Active enterprise seats (non-exempt):")
    if not active_seats:
        print("  (none)")
    else:
        for s in active_seats:
            if "error" in s:
                print(f"  ERROR querying seats: {s['error']}")
            else:
                print(
                    f"  - id={s['id']} user={s['username']} "
                    f"slug={s['community_slug']} comm_id={s['community_id']} "
                    f"started={s['started_at']} had_personal_premium={s['had_personal_premium_at_join']}"
                )
    print()
    print("Free parent communities already over 25 members (cap=25):")
    if not over_cap:
        print("  (none)")
    else:
        for row in over_cap:
            print(
                f"  - id={row['id']:<5} '{row['name']}' "
                f"creator={row['creator_username']} members={row['members']}"
            )
    print()
    print("Non-exempt users owning > 5 parent communities (cap=5):")
    if not over_count_owners:
        print("  (none)")
    else:
        for row in over_count_owners:
            print(f"  - {row['username']} owns {row['owned']} parent communities")
    print("=" * 72)


if __name__ == "__main__":
    main()
