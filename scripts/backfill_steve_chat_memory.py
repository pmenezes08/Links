"""Backfill Steve chat-memory chunks for a single peer-DM or group conversation.

Defaults to dry-run (no writes). Pass --write to actually persist chunks.

Usage:
    python scripts/backfill_steve_chat_memory.py --conv-id CONV_ID
    python scripts/backfill_steve_chat_memory.py --conv-id CONV_ID --write --limit 2000
    python scripts/backfill_steve_chat_memory.py --conv-id CONV_ID --status
    python scripts/backfill_steve_chat_memory.py --group-id GROUP_ID
    python scripts/backfill_steve_chat_memory.py --group-id GROUP_ID --write --limit 2000
    python scripts/backfill_steve_chat_memory.py --group-id GROUP_ID --status
"""

from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


def _get_firestore_client():
    """Lazy import and initialize Firebase Admin if needed."""
    import firebase_admin
    from firebase_admin import credentials, firestore as _fs

    if not firebase_admin._apps:
        # Use Application Default Credentials (gcloud auth / service account)
        try:
            cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred, {
                'projectId': 'cpoint-127c2',
            })
            print("Firebase initialized with ApplicationDefault credentials")
        except Exception as init_err:
            print("Firebase init warning:", init_err)
            # Fallback to default
            firebase_admin.initialize_app()

    return _fs.client(database_id="cpoint")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill Steve chat-memory chunks for a peer-DM or group conversation.",
    )
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--conv-id", help="Firestore dm_conversations document id (peer DM).")
    target.add_argument("--group-id", help="Firestore group_chats document id (group chat).")
    parser.add_argument("--write", action="store_true", help="Actually write chunks to Firestore. Without this flag, runs in dry-run mode.")
    parser.add_argument("--limit", type=int, default=None, help="Max messages to read (default from KB config).")
    parser.add_argument("--status", action="store_true", help="Print backfill status and exit.")
    args = parser.parse_args()

    fs = _get_firestore_client()

    if args.group_id:
        from backend.services.steve_chat_memory_indexer import (
            backfill_group_chat,
            backfill_group_status,
        )

        if args.status:
            result = backfill_group_status(fs, args.group_id)
            print(json.dumps(result, indent=2, sort_keys=True, default=str))
            return 0

        stats = backfill_group_chat(
            fs,
            args.group_id,
            dry_run=not args.write,
            limit=args.limit,
            skip_membership_check=True,
        )

        output = {
            "group_id": stats.conv_id,
            "scope_key": stats.scope_key,
            "dry_run": stats.dry_run,
            "messages_read": stats.messages_read,
            "messages_included": stats.messages_included,
            "messages_skipped_unsafe": stats.messages_skipped_unsafe,
            "messages_skipped_before_reset": stats.messages_skipped_before_reset,
            "chunks_built": stats.chunks_built,
            "chunks_written": stats.chunks_written,
            "chunks_skipped_existing": stats.chunks_skipped_existing,
            "elapsed_ms": stats.elapsed_ms,
        }
        print(json.dumps(output, indent=2, sort_keys=True, default=str))
        return 0

    from backend.services.steve_chat_memory_indexer import (
        backfill_peer_dm,
        backfill_status,
    )

    if args.status:
        result = backfill_status(fs, args.conv_id)
        print(json.dumps(result, indent=2, sort_keys=True, default=str))
        return 0

    stats = backfill_peer_dm(
        fs,
        args.conv_id,
        dry_run=not args.write,
        limit=args.limit,
    )

    output = {
        "conv_id": stats.conv_id,
        "scope_key": stats.scope_key,
        "dry_run": stats.dry_run,
        "messages_read": stats.messages_read,
        "messages_included": stats.messages_included,
        "messages_skipped_unsafe": stats.messages_skipped_unsafe,
        "messages_skipped_before_reset": stats.messages_skipped_before_reset,
        "chunks_built": stats.chunks_built,
        "chunks_written": stats.chunks_written,
        "chunks_skipped_existing": stats.chunks_skipped_existing,
        "elapsed_ms": stats.elapsed_ms,
    }
    print(json.dumps(output, indent=2, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
