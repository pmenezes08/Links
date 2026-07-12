"""One-shot, idempotent backfill of Explore gallery metadata.

Existing gallery-approved creations predate the ``category`` column. This
script fills them so the sectioned gallery looks curated on day one:

1. Free pass (default): run the keyword classifier
   (``builder.infer_creation_category``) over each approved row's first prompt
   + title. Zero LLM cost. Rows that stay unmatched remain untagged (they
   still list under their section — never hidden).
2. ``--hooks``: additionally run the metered classify+hook pass
   (``builder_gallery_meta.ensure_gallery_meta``) for approved rows missing a
   card hook. One cheap LLM call per row, each logging one ai_usage row
   (surface=content_gen, request_type=builder_gallery_meta). Bounded by the
   number of approved listings — confirm the count before running with
   ``--dry-run`` first.

Usage (repo root):
    PYTHONPATH=. python scripts/backfill_gallery_categories.py --dry-run
    PYTHONPATH=. python scripts/backfill_gallery_categories.py
    PYTHONPATH=. python scripts/backfill_gallery_categories.py --hooks
"""

from __future__ import annotations

import argparse
import json
import sys


def _first_prompt(prompt_history) -> str:
    try:
        parsed = json.loads(prompt_history) if isinstance(prompt_history, str) else prompt_history
        if isinstance(parsed, list) and parsed:
            first = parsed[0]
            if isinstance(first, dict):
                return str(first.get("text") or first.get("prompt") or "")
            return str(first)
    except Exception:
        pass
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report what would change, write nothing")
    parser.add_argument("--hooks", action="store_true",
                        help="also run the metered LLM classify+hook pass for rows missing a hook")
    args = parser.parse_args()

    from backend.services import builder
    from backend.services.database import get_db_connection, get_sql_placeholder

    builder.ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """SELECT id, title, kind, public_kind, prompt_history, category, gallery_hook
               FROM creations WHERE gallery_status = 'approved'"""
        )
        rows = c.fetchall() or []

    tagged = skipped = unmatched = hooks_done = 0
    for r in rows:
        cid = int(builder._cell(r, 0))
        title = builder._cell(r, 1)
        kind = builder._cell(r, 3) or builder._cell(r, 2)
        prompt = _first_prompt(builder._cell(r, 4))
        category = builder._cell(r, 5)
        hook = builder._cell(r, 6)

        if not category:
            inferred = builder.infer_creation_category(prompt, title, kind=kind)
            if inferred:
                tagged += 1
                print(f"[{cid}] {title!r}: category -> {inferred}" + (" (dry-run)" if args.dry_run else ""))
                if not args.dry_run:
                    with get_db_connection() as conn:
                        c = conn.cursor()
                        c.execute(f"UPDATE creations SET category = {ph} WHERE id = {ph}", (inferred, cid))
                        conn.commit()
            else:
                unmatched += 1
                print(f"[{cid}] {title!r}: no keyword match (stays untagged)")
        else:
            skipped += 1

        if args.hooks and not hook:
            if args.dry_run:
                print(f"[{cid}] {title!r}: would run classify+hook LLM pass (dry-run)")
            else:
                from backend.services import builder_gallery_meta
                try:
                    result = builder_gallery_meta.ensure_gallery_meta(cid)
                    if result and result.get("hook"):
                        hooks_done += 1
                        print(f"[{cid}] {title!r}: hook -> {result['hook']!r}")
                except Exception as exc:
                    print(f"[{cid}] {title!r}: hook pass failed ({exc}) — skipping")

    print(f"\napproved={len(rows)} tagged={tagged} already-tagged={skipped} "
          f"unmatched={unmatched} hooks={hooks_done} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
