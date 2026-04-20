#!/usr/bin/env python3
"""Seed a deterministic set of test users on **staging**.

Why: the Matrix A/B unit tests prove the resolver and counters are
correct in isolation, but we still need a handful of known-state users
on staging to run the PowerShell smoke test and to click through the
admin-web by hand. This script creates them idempotently from known
credentials.

Users created (all prefixed ``test_`` so teardown is safe):

    test_free       — Free, created 60d ago, no seat                (control)
    test_trial      — Free, created 3d ago, no seat                 (in trial)
    test_premium    — subscription='premium', created 90d ago       (paying user)
    test_special    — subscription='free', is_special=1             (founder)
    test_enterprise — Free, created 90d ago, active seat in ACME    (seat flow)
    test_doublepay  — subscription='premium', active seat in ACME   (nag flow)

Plus a helper community ``test_acme_corp`` with tier='enterprise' that
owns the two seat rows.

**Credentials** come from Secret Manager, NOT hardcoded:

    gcloud secrets versions access latest --secret=mysql-password

so this script is safe to commit to the repo and re-run by any teammate
with ``roles/secretmanager.secretAccessor`` on the staging project.

**Network**: assumes the Cloud SQL Auth Proxy is running locally and
listening on ``127.0.0.1:3307``, OR that the ``MYSQL_HOST`` env var is
overridden to hit the Cloud SQL public IP directly (34.78.168.84).

Run::

    # Option A — via Cloud SQL proxy (recommended):
    cloud-sql-proxy --address 127.0.0.1 --port 3307 cpoint-127c2:europe-west1:<INSTANCE>
    python scripts/seed_staging_test_users.py

    # Option B — direct IP (requires your IP be on authorized networks):
    $env:MYSQL_HOST="34.78.168.84"
    python scripts/seed_staging_test_users.py
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional


_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _REPO)


# ── Configuration ───────────────────────────────────────────────────────


PROJECT = "cpoint-127c2"
# Default to the Cloud SQL proxy's local port. Override with MYSQL_HOST
# env var for a direct-IP connection.
DEFAULT_HOST = os.environ.get("MYSQL_HOST", "127.0.0.1")
DEFAULT_PORT = os.environ.get("MYSQL_PORT", "3307")
DEFAULT_USER = os.environ.get("MYSQL_USER", "app_user")
DEFAULT_DB = os.environ.get("MYSQL_DB", "cpoint")
PASSWORD_SECRET = "mysql-password"

TEST_USERNAME_PREFIX = "test_"
TEST_COMMUNITY_NAME = "test_acme_corp"


# ── Secret Manager helper ───────────────────────────────────────────────


def fetch_password_from_secrets() -> str:
    """Pull the staging DB password from Secret Manager via gcloud.

    We shell out rather than importing the Python client to keep the
    dependency footprint small — the operator already has ``gcloud``
    installed (deployments go through it) and is already authenticated
    via ``gcloud auth login``.
    """
    if os.environ.get("MYSQL_PASSWORD"):
        # Allow override for testing. Log a warning so it's obvious.
        print("[seed] Using MYSQL_PASSWORD from env (override)", file=sys.stderr)
        return os.environ["MYSQL_PASSWORD"]

    cmd = [
        "gcloud", "secrets", "versions", "access", "latest",
        f"--secret={PASSWORD_SECRET}",
        f"--project={PROJECT}",
    ]
    try:
        pw = subprocess.check_output(cmd, text=True, stderr=subprocess.PIPE).strip()
    except FileNotFoundError:
        raise SystemExit(
            "gcloud CLI not found. Install Google Cloud SDK and run `gcloud auth login`."
        )
    except subprocess.CalledProcessError as err:
        raise SystemExit(
            f"Failed to read secret '{PASSWORD_SECRET}' from project {PROJECT}:\n"
            f"{err.stderr}\n"
            f"Verify the secret exists and your account has "
            f"roles/secretmanager.secretAccessor."
        )
    if not pw:
        raise SystemExit(f"Secret '{PASSWORD_SECRET}' returned empty value.")
    return pw


# ── DB helpers ──────────────────────────────────────────────────────────


def get_connection():
    try:
        import pymysql  # type: ignore
        from pymysql.cursors import DictCursor  # type: ignore
    except ImportError:
        raise SystemExit("PyMySQL is required. pip install -r requirements-dev.txt")

    return pymysql.connect(
        host=DEFAULT_HOST,
        port=int(DEFAULT_PORT),
        user=DEFAULT_USER,
        password=fetch_password_from_secrets(),
        database=DEFAULT_DB,
        charset="utf8mb4",
        autocommit=True,
        cursorclass=DictCursor,
        connect_timeout=10,
    )


def _now_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _days_ago(n: int) -> str:
    return (datetime.utcnow() - timedelta(days=n)).strftime("%Y-%m-%d %H:%M:%S")


# ── Seeding ─────────────────────────────────────────────────────────────


TEST_USERS: List[Dict[str, Any]] = [
    {"username": "test_free", "subscription": "free", "is_special": 0,
     "created_days_ago": 60},
    {"username": "test_trial", "subscription": "free", "is_special": 0,
     "created_days_ago": 3},
    {"username": "test_premium", "subscription": "premium", "is_special": 0,
     "created_days_ago": 90},
    {"username": "test_special", "subscription": "free", "is_special": 1,
     "created_days_ago": 120},
    {"username": "test_enterprise", "subscription": "free", "is_special": 0,
     "created_days_ago": 90},
    {"username": "test_doublepay", "subscription": "premium", "is_special": 0,
     "created_days_ago": 90},
]

# Users who get a seat in the test ACME community.
SEAT_USERS = ("test_enterprise", "test_doublepay")


def _upsert_user(cursor, u: Dict[str, Any]) -> str:
    """Insert the user if missing; otherwise sync is_special / subscription."""
    cursor.execute(
        "SELECT username FROM users WHERE username = %s",
        (u["username"],),
    )
    if cursor.fetchone():
        cursor.execute(
            """
            UPDATE users SET subscription = %s, is_special = %s
            WHERE username = %s
            """,
            (u["subscription"], u["is_special"], u["username"]),
        )
        return "updated"

    cursor.execute(
        """
        INSERT INTO users (username, email, subscription, is_special,
                           is_active, created_at)
        VALUES (%s, %s, %s, %s, 1, %s)
        """,
        (
            u["username"],
            f"{u['username']}@staging.test.local",
            u["subscription"],
            u["is_special"],
            _days_ago(u["created_days_ago"]),
        ),
    )
    return "inserted"


def _upsert_community(cursor) -> int:
    cursor.execute(
        "SELECT id FROM communities WHERE name = %s",
        (TEST_COMMUNITY_NAME,),
    )
    row = cursor.fetchone()
    if row:
        cid = int(row["id"])
        cursor.execute("UPDATE communities SET tier = 'enterprise' WHERE id = %s", (cid,))
        return cid
    cursor.execute(
        "INSERT INTO communities (name, tier, created_at) VALUES (%s, %s, %s)",
        (TEST_COMMUNITY_NAME, "enterprise", _now_str()),
    )
    return int(cursor.lastrowid)


def _upsert_seat(cursor, username: str, community_id: int,
                 had_personal_premium: bool) -> str:
    cursor.execute(
        """
        SELECT id FROM user_enterprise_seats
        WHERE username = %s AND community_id = %s AND ended_at IS NULL
        """,
        (username, community_id),
    )
    if cursor.fetchone():
        return "existing"
    cursor.execute(
        """
        INSERT INTO user_enterprise_seats
            (username, community_id, community_slug, started_at,
             had_personal_premium_at_join, return_intent, created_at)
        VALUES (%s, %s, %s, %s, %s, 0, %s)
        """,
        (
            username,
            community_id,
            TEST_COMMUNITY_NAME,
            _days_ago(14),
            1 if had_personal_premium else 0,
            _now_str(),
        ),
    )
    return "inserted"


def main() -> None:
    print(f"[seed] Connecting to {DEFAULT_USER}@{DEFAULT_HOST}:{DEFAULT_PORT}/{DEFAULT_DB}")
    conn = get_connection()
    try:
        c = conn.cursor()

        # 1. Users.
        stats = {"inserted": 0, "updated": 0}
        for u in TEST_USERS:
            action = _upsert_user(c, u)
            stats[action] = stats.get(action, 0) + 1
            print(f"[seed] user {u['username']}: {action}")

        # 2. Community.
        cid = _upsert_community(c)
        print(f"[seed] community {TEST_COMMUNITY_NAME} (id={cid}): enterprise tier")

        # 3. Seats.
        for username in SEAT_USERS:
            had_premium = username == "test_doublepay"
            action = _upsert_seat(c, username, cid, had_premium)
            print(f"[seed] seat {username}@{cid}: {action}")

        print("\n[seed] done")
        print(f"[seed]   users: {stats}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
