#!/usr/bin/env python3
"""Read-only legacy chat encryption row-count inspection.

Run against staging before PR 2 removes message compatibility residue:

  DB_BACKEND=mysql MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DB=... \
    python scripts/inspect_legacy_encryption_counts.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

_REPO = Path(__file__).resolve().parents[1]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv(_REPO / ".env")
except Exception:
    pass

os.chdir(_REPO)

from backend.services.database import USE_MYSQL, get_db_connection  # noqa: E402

TABLE_COUNTS = (
    "message_ciphertexts",
    "encryption_keys",
    "encryption_prekeys",
    "encryption_backups",
    "user_devices",
    "device_prekeys",
)

MESSAGE_FIELD_COUNTS = (
    ("messages_is_encrypted_true", "is_encrypted", "is_encrypted = 1"),
    ("messages_encrypted_body_present", "encrypted_body", "encrypted_body IS NOT NULL"),
    (
        "messages_encrypted_body_for_sender_present",
        "encrypted_body_for_sender",
        "encrypted_body_for_sender IS NOT NULL",
    ),
)


def _first_value(row: Any) -> Any:
    if row is None:
        return None
    if isinstance(row, dict):
        return next(iter(row.values()), None)
    try:
        return row[0]
    except Exception:
        return None


def _table_exists(cur: Any, table_name: str) -> bool:
    if USE_MYSQL:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND table_name = %s
            """,
            (table_name,),
        )
    else:
        cur.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table_name,),
        )
    return int(_first_value(cur.fetchone()) or 0) > 0


def _column_exists(cur: Any, table_name: str, column_name: str) -> bool:
    if USE_MYSQL:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = %s
              AND column_name = %s
            """,
            (table_name, column_name),
        )
        return int(_first_value(cur.fetchone()) or 0) > 0

    cur.execute(f"PRAGMA table_info({table_name})")
    return any((row["name"] if hasattr(row, "keys") else row[1]) == column_name for row in cur.fetchall())


def _count(cur: Any, sql: str) -> int:
    cur.execute(sql)
    return int(_first_value(cur.fetchone()) or 0)


def collect_counts() -> dict[str, Any]:
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        results: dict[str, Any] = {
            "backend": "mysql" if USE_MYSQL else "sqlite",
            "message_fields": {},
            "tables": {},
        }

        messages_exists = _table_exists(cur, "messages")
        for label, column, predicate in MESSAGE_FIELD_COUNTS:
            if messages_exists and _column_exists(cur, "messages", column):
                results["message_fields"][label] = _count(cur, f"SELECT COUNT(*) FROM messages WHERE {predicate}")
            else:
                results["message_fields"][label] = None

        for table_name in TABLE_COUNTS:
            if _table_exists(cur, table_name):
                results["tables"][table_name] = _count(cur, f"SELECT COUNT(*) FROM {table_name}")
            else:
                results["tables"][table_name] = None

        return results
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _print_text(results: dict[str, Any]) -> None:
    print(f"backend: {results['backend']}")
    print("message_fields:")
    for key, value in results["message_fields"].items():
        rendered = "missing" if value is None else str(value)
        print(f"  {key}: {rendered}")
    print("tables:")
    for key, value in results["tables"].items():
        rendered = "missing" if value is None else str(value)
        print(f"  {key}: {rendered}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args()

    results = collect_counts()
    if args.json:
        print(json.dumps(results, indent=2, sort_keys=True))
    else:
        _print_text(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
