"""Backfill Steve document memory for existing useful_docs rows.

Usage:
    python scripts/backfill_steve_document_memory.py --limit 100
    python scripts/backfill_steve_document_memory.py --force --no-embeddings
"""

from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from backend.services.steve_document_memory import backfill_existing_docs


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill Firestore Steve document memory from useful_docs.")
    parser.add_argument("--limit", type=int, default=100, help="Maximum useful_docs rows to scan.")
    parser.add_argument("--force", action="store_true", help="Re-index documents even if source hash matches.")
    parser.add_argument(
        "--no-embeddings",
        action="store_true",
        help="Skip embedding calls; retrieval falls back to lexical matching.",
    )
    args = parser.parse_args()

    result = backfill_existing_docs(
        limit=max(1, args.limit),
        force=args.force,
        compute_embeddings=not args.no_embeddings,
    )
    print(json.dumps(result, indent=2, sort_keys=True, default=str))
    return 0 if int(result.get("failed") or 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
