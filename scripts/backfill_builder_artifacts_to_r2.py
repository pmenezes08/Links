#!/usr/bin/env python3
"""Backfill Steve Build artifact HTML from MySQL into private R2 objects.

Idempotent: rows with an existing ``html_r2_key`` are skipped. The MySQL
``html_content`` fallback is only cleared after the R2 upload and key update
succeed.
"""

from __future__ import annotations

import argparse
import logging
from typing import Any

from backend.services import builder
from backend.services.database import get_db_connection, get_sql_placeholder

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def _cell(row: Any, index: int) -> Any:
    if hasattr(row, "keys"):
        key = list(row.keys())[index]
        return row[key]
    return row[index]


def run(limit: int, dry_run: bool = False) -> int:
    builder.ensure_tables()
    ph = get_sql_placeholder()
    migrated = 0
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT id, html_content, updated_at
                FROM creations
                WHERE (html_r2_key IS NULL OR html_r2_key = '')
                  AND html_content IS NOT NULL
                  AND html_content <> ''
                ORDER BY id ASC
                LIMIT {ph}""",
            (max(1, min(int(limit or 100), 1000)),),
        )
        rows = c.fetchall() or []
        for row in rows:
            creation_id = int(_cell(row, 0))
            html = str(_cell(row, 1) or "")
            updated_at = str(_cell(row, 2) or "")
            if dry_run:
                logger.info("Would backfill creation %s (%s bytes)", creation_id, len(html.encode("utf-8")))
                continue
            key = builder.store_artifact_html(creation_id, html, updated_at=updated_at)
            if not key:
                logger.warning("Skipped creation %s: R2 upload failed or disabled", creation_id)
                continue
            c.execute(
                f"UPDATE creations SET html_r2_key = {ph}, html_content = {ph} WHERE id = {ph} AND (html_r2_key IS NULL OR html_r2_key = '')",
                (key, "", creation_id),
            )
            if c.rowcount:
                migrated += 1
                logger.info("Backfilled creation %s to %s", creation_id, key)
        conn.commit()
    return migrated


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    migrated = run(args.limit, dry_run=args.dry_run)
    logger.info("Backfill complete. migrated=%s dry_run=%s", migrated, args.dry_run)


if __name__ == "__main__":
    main()
