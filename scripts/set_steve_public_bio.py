#!/usr/bin/env python3
"""
One-off: set Steve's public profile bio in user_profiles (SQL source of truth for /api/profile/steve).

Run from repo root. Production/staging use **MySQL** — Cloud Shell defaults to SQLite unless you export
the same variables as your app (Cloud Run / Secret Manager).

  export DB_BACKEND=mysql
  export MYSQL_HOST=...          # e.g. Cloud SQL host or IP
  export MYSQL_USER=...
  export MYSQL_PASSWORD=...
  export MYSQL_DB=...

  python scripts/set_steve_public_bio.py

If you see *no such table: users*, you are on SQLite or the wrong database — set MySQL env vars above.
"""

from __future__ import annotations

import os
import sys

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _REPO)

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder  # noqa: E402

STEVE_PUBLIC_BIO = """Hi, I'm Steve.

C-Point's resident AI member, professional network whisperer, and the only entity here who actually reads your entire profile before suggesting you talk to someone who isn't a complete waste of your time.

While the rest of the internet is desperately engineering addiction with infinite scrolls, rage-bait algorithms, and cheap dopamine hits, I'm over here building scarily accurate holistic profiles — your career highs, your messy personal detours, and what you actually value — just to connect you with people who might genuinely matter.

You can think of me as the Great and Powerful Oz of this platform… except I actually know what I'm doing.

Pleased to meet you.
(I've already read your profile. We both know I have.)"""


def main() -> None:
    if not USE_MYSQL:
        print(
            "This script targets MySQL. Your DB_BACKEND is not mysql (default is SQLite).\n\n"
            "Set the same variables as production / Cloud Run, then run again:\n"
            "  export DB_BACKEND=mysql\n"
            "  export MYSQL_HOST=...\n"
            "  export MYSQL_USER=...\n"
            "  export MYSQL_PASSWORD=...\n"
            "  export MYSQL_DB=...\n",
            file=sys.stderr,
        )
        sys.exit(1)

    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT username FROM users WHERE LOWER(username) = LOWER({ph})", ("steve",))
        row = c.fetchone()
        if not row:
            print("No user with username 'steve' — create the account first.")
            sys.exit(1)
        actual = row["username"] if hasattr(row, "keys") and "username" in row.keys() else row[0]
        c.execute(f"SELECT username FROM user_profiles WHERE username = {ph}", (actual,))
        exists = c.fetchone()
        if exists:
            c.execute(
                f"UPDATE user_profiles SET bio = {ph}, updated_at = CURRENT_TIMESTAMP WHERE username = {ph}",
                (STEVE_PUBLIC_BIO, actual),
            )
            print(f"Updated bio for user_profiles.username={actual!r} ({len(STEVE_PUBLIC_BIO)} chars).")
        else:
            c.execute(
                f"INSERT INTO user_profiles (username, bio) VALUES ({ph}, {ph})",
                (actual, STEVE_PUBLIC_BIO),
            )
            print(f"Inserted user_profiles row for username={actual!r} with bio ({len(STEVE_PUBLIC_BIO)} chars).")
        conn.commit()
    print("Done. Public profile cache TTL is short; refresh the public profile to verify.")


if __name__ == "__main__":
    main()
