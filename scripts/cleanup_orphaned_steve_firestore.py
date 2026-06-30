"""One-time cleanup: purge orphaned Steve Firestore data left behind by account
deletions that ran BEFORE the username-keyed Firestore stores were cleaned up
(see backend/services/account_deletion.py). A deleted account whose username is
later re-registered would otherwise inherit this data and see old Steve history.

For every username that no longer exists in MySQL ``users`` it removes:
  - ``dm_conversations/{conv}`` docs (+ their ``messages`` subcollection) where
    any non-"steve" participant is gone — this covers the Steve DM thread
    (``steve_{username}``) and human-pair DMs where one side was deleted.
  - ``steve_chat_memory/dm:{conv}`` scopes (chunks / events / scope doc) whose
    conversation is orphaned OR whose ``dm_conversations`` doc no longer exists.
  - ``steve_user_profiles/{username}`` and ``steve_onboarding/{username}`` docs.

Group memory (``steve_chat_memory/group:*``, ``steve_doc_memory``) is SHARED by
all members and is never touched.

Dry-run by default — it only reports. Pass ``--apply`` to actually delete.

Usage:
    python scripts/cleanup_orphaned_steve_firestore.py             # dry run
    python scripts/cleanup_orphaned_steve_firestore.py --apply     # delete
    python scripts/cleanup_orphaned_steve_firestore.py --limit 500 # cap deletes/category
"""

from __future__ import annotations

import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

SERVICE_ACCOUNTS = {"steve"}  # never counted as an "orphan" participant


def _load_existing_usernames() -> set:
    """Return the set of lowercased usernames currently in MySQL ``users``."""
    from backend.services.database import get_db_connection

    names: set = set()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("SELECT username FROM users")
        for row in c.fetchall() or []:
            uname = row["username"] if hasattr(row, "keys") else row[0]
            if uname:
                names.add(str(uname).strip().lower())
    return names


def _participants_for_conv(doc) -> list:
    """Best-effort participant usernames for a dm_conversations doc.

    Prefers the stored ``participants`` array (set on every DM write); falls
    back to an UNAMBIGUOUS steve-prefix/suffix parse of the doc id only when the
    field is missing. Usernames may contain underscores, so a blind split on
    ``_`` is unsafe — return ``[]`` (skip) when we cannot be sure.
    """
    data = doc.to_dict() or {}
    parts = data.get("participants")
    if isinstance(parts, list) and parts:
        return [str(p) for p in parts if p]
    doc_id = doc.id or ""
    if doc_id.startswith("steve_"):
        return ["steve", doc_id[len("steve_"):]]
    if doc_id.endswith("_steve"):
        return [doc_id[: -len("_steve")], "steve"]
    return []


def _is_orphan(participants: list, existing: set) -> bool:
    """A conv is orphaned when any non-service participant is gone from MySQL."""
    humans = [p for p in participants if p.lower() not in SERVICE_ACCOUNTS]
    if not humans:
        return False
    return any(p.lower() not in existing for p in humans)


def _delete_conv(fs, conv_id: str) -> int:
    """Delete a dm_conversations doc and its messages subcollection. Returns msg count."""
    conv_ref = fs.collection("dm_conversations").document(conv_id)
    deleted = 0
    try:
        for msg in conv_ref.collection("messages").stream():
            msg.reference.delete()
            deleted += 1
    except Exception as e:
        print(f"  ! messages delete failed for {conv_id}: {e}")
    try:
        conv_ref.delete()
    except Exception as e:
        print(f"  ! conv doc delete failed for {conv_id}: {e}")
    return deleted


def _purge_memory_scope(fs, conv_id: str) -> None:
    from backend.services.steve_chat_memory import scope_for_peer_dm
    from backend.services.steve_chat_memory_ops import purge_scope_memory

    try:
        purge_scope_memory(fs, scope_for_peer_dm(conv_id))
    except Exception as e:
        print(f"  ! memory purge failed for dm:{conv_id}: {e}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually delete. Without this, dry-run only.")
    parser.add_argument("--limit", type=int, default=0, help="Max deletions per category (0 = no cap).")
    args = parser.parse_args()

    from backend.services.firestore_reads import _get_client

    fs = _get_client()
    existing = _load_existing_usernames()
    print(f"Loaded {len(existing)} existing usernames from MySQL.")
    mode = "APPLY (deleting)" if args.apply else "DRY-RUN (no writes)"
    cap = args.limit if args.limit > 0 else None
    print(f"Mode: {mode}; per-category cap: {cap or 'none'}\n")

    orphan_convs: list = []   # (conv_id, reason)
    skipped_no_parts = 0

    # Pass 1 — dm_conversations.
    for doc in fs.collection("dm_conversations").stream():
        participants = _participants_for_conv(doc)
        if not participants:
            skipped_no_parts += 1
            continue
        if _is_orphan(participants, existing):
            gone = [p for p in participants if p.lower() not in SERVICE_ACCOUNTS and p.lower() not in existing]
            orphan_convs.append((doc.id, ",".join(gone)))

    print(f"== dm_conversations: {len(orphan_convs)} orphaned "
          f"({skipped_no_parts} skipped: no participants field) ==")
    deleted_convs = deleted_msgs = 0
    orphan_conv_ids = set()
    for conv_id, gone in orphan_convs:
        if cap and deleted_convs >= cap:
            print(f"  …cap reached ({cap}); stopping conv deletes.")
            break
        orphan_conv_ids.add(conv_id)
        print(f"  - {conv_id}  (deleted user: {gone})")
        if args.apply:
            deleted_msgs += _delete_conv(fs, conv_id)
            _purge_memory_scope(fs, conv_id)
        deleted_convs += 1

    # Pass 2 — steve_chat_memory dm scopes whose conversation is gone/orphaned.
    leftover_scopes: list = []
    for doc in fs.collection("steve_chat_memory").stream():
        if not doc.id.startswith("dm:"):
            continue  # group:* scopes are shared — never touched
        conv_id = doc.id[len("dm:"):]
        if conv_id in orphan_conv_ids:
            continue  # already purged alongside its conv in pass 1
        conv_exists = fs.collection("dm_conversations").document(conv_id).get().exists
        if not conv_exists:
            leftover_scopes.append(conv_id)

    print(f"\n== steve_chat_memory: {len(leftover_scopes)} leftover dm scopes "
          f"(conversation already gone) ==")
    purged_scopes = 0
    for conv_id in leftover_scopes:
        if cap and purged_scopes >= cap:
            print(f"  …cap reached ({cap}); stopping scope purges.")
            break
        print(f"  - dm:{conv_id}")
        if args.apply:
            _purge_memory_scope(fs, conv_id)
        purged_scopes += 1

    # Pass 3 — single-username state docs.
    deleted_state = {"steve_user_profiles": 0, "steve_onboarding": 0}
    for collection in ("steve_user_profiles", "steve_onboarding"):
        found = []
        for doc in fs.collection(collection).stream():
            if str(doc.id).strip().lower() not in existing:
                found.append(doc.id)
        print(f"\n== {collection}: {len(found)} orphaned docs ==")
        for doc_id in found:
            if cap and deleted_state[collection] >= cap:
                print(f"  …cap reached ({cap}); stopping {collection} deletes.")
                break
            print(f"  - {doc_id}")
            if args.apply:
                try:
                    fs.collection(collection).document(doc_id).delete()
                except Exception as e:
                    print(f"  ! delete failed for {collection}/{doc_id}: {e}")
            deleted_state[collection] += 1

    print("\n----- SUMMARY -----")
    print(f"dm_conversations orphaned:     {len(orphan_convs)}"
          f"{'  deleted ' + str(deleted_convs) if args.apply else ''}")
    if args.apply:
        print(f"  messages deleted:            {deleted_msgs}")
    print(f"steve_chat_memory leftover:    {len(leftover_scopes)}"
          f"{'  purged ' + str(purged_scopes) if args.apply else ''}")
    for collection in ("steve_user_profiles", "steve_onboarding"):
        print(f"{collection} orphaned: {deleted_state[collection] if args.apply else '(dry-run)'}")
    if not args.apply:
        print("\nDRY-RUN: nothing was deleted. Re-run with --apply to purge.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
