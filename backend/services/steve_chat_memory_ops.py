"""Deletion, reset, and purge invalidation for Steve Phase 3 chat memory.

Provides ops-level Firestore mutations (soft invalidation, hard purge,
message-level staleness) and a health probe.  Every public function is
designed to be called **non-fatally** from request handlers — failures
are logged and never propagate to the HTTP response.

No vendor/LLM calls.  No ai_usage rows.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from backend.services.steve_chat_memory import (
    CHUNKS_SUBCOLLECTION,
    COLLECTION,
    EVENTS_SUBCOLLECTION,
    FIELD_INVALIDATED,
    FIELD_SOURCE_MESSAGE_IDS,
    FIELD_STALE,
    ThreadMemoryScope,
    chunks_collection_ref,
    events_collection_ref,
    memory_doc_ref,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Soft invalidation — marks docs, does NOT delete them
# ---------------------------------------------------------------------------


def invalidate_memory_for_scope(
    fs_client: Any,
    scope: ThreadMemoryScope,
    *,
    reason: str,
) -> dict:
    """Mark ALL chunks and events under *scope* as ``invalidated=True``.

    Records ``invalidated_at`` and ``invalidation_reason`` on each doc.
    Returns ``{chunks_invalidated, events_invalidated}``.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
    patch = {
        FIELD_INVALIDATED: True,
        "invalidated_at": now,
        "invalidation_reason": str(reason)[:200],
    }

    chunks_done = _batch_update_subcollection(fs_client, scope, CHUNKS_SUBCOLLECTION, patch)
    events_done = _batch_update_subcollection(fs_client, scope, EVENTS_SUBCOLLECTION, patch)

    logger.info(
        "invalidate_memory_for_scope %s: chunks=%d events=%d reason=%s",
        scope.scope_key, chunks_done, events_done, reason,
    )
    return {"chunks_invalidated": chunks_done, "events_invalidated": events_done}


def invalidate_chunks_containing_message(
    fs_client: Any,
    scope: ThreadMemoryScope,
    message_id: str,
) -> int:
    """Find chunks whose ``source_message_ids`` contains *message_id* and
    mark them ``stale=True`` with ``stale_reason="message_deleted"``.

    Returns count of chunks marked stale.
    """
    if not message_id:
        return 0

    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"
    marked = 0

    try:
        coll = chunks_collection_ref(fs_client, scope)
        for doc in coll.stream():
            data = doc.to_dict() or {}
            ids = data.get(FIELD_SOURCE_MESSAGE_IDS) or []
            if str(message_id) in [str(i) for i in ids]:
                try:
                    coll.document(doc.id).set(
                        {
                            FIELD_STALE: True,
                            "stale_reason": "message_deleted",
                            "stale_at": now,
                        },
                        merge=True,
                    )
                    marked += 1
                except Exception as exc:
                    logger.warning(
                        "invalidate_chunks_containing_message: update failed for chunk %s: %s",
                        doc.id, exc,
                    )
    except Exception as exc:
        logger.warning(
            "invalidate_chunks_containing_message: read failed for %s: %s",
            scope.scope_key, exc,
        )

    return marked


# ---------------------------------------------------------------------------
# Hard purge — permanently deletes docs (GDPR / right-to-erasure)
# ---------------------------------------------------------------------------


def purge_scope_memory(
    fs_client: Any,
    scope: ThreadMemoryScope,
) -> dict:
    """Hard-delete all chunk and event docs under *scope*.

    Also deletes the scope metadata document.
    Returns ``{chunks_deleted, events_deleted}``.
    """
    chunks_deleted = _batch_delete_subcollection(fs_client, scope, CHUNKS_SUBCOLLECTION)
    events_deleted = _batch_delete_subcollection(fs_client, scope, EVENTS_SUBCOLLECTION)

    try:
        memory_doc_ref(fs_client, scope).delete()
    except Exception as exc:
        logger.warning("purge_scope_memory: scope doc delete failed for %s: %s", scope.scope_key, exc)

    logger.info(
        "purge_scope_memory %s: chunks=%d events=%d",
        scope.scope_key, chunks_deleted, events_deleted,
    )
    return {"chunks_deleted": chunks_deleted, "events_deleted": events_deleted}


# ---------------------------------------------------------------------------
# Health / observability
# ---------------------------------------------------------------------------


def memory_health_for_scope(
    fs_client: Any,
    scope: ThreadMemoryScope,
) -> dict:
    """Read scope metadata + chunk/event counts + staleness ratio.

    Returns a dict suitable for admin dashboards or logging.
    """
    result: dict = {
        "scope_key": scope.scope_key,
        "chunk_count": 0,
        "event_count": 0,
        "stale_chunks": 0,
        "invalidated_chunks": 0,
        "last_indexed_at": None,
        "healthy": True,
    }

    try:
        meta_doc = memory_doc_ref(fs_client, scope).get()
        if hasattr(meta_doc, "exists") and meta_doc.exists:
            meta = meta_doc.to_dict() or {}
            result["last_indexed_at"] = meta.get("last_indexed_at")
    except Exception as exc:
        logger.warning("memory_health_for_scope: meta read failed for %s: %s", scope.scope_key, exc)

    try:
        for doc in chunks_collection_ref(fs_client, scope).stream():
            data = doc.to_dict() or {}
            result["chunk_count"] += 1
            if data.get(FIELD_STALE):
                result["stale_chunks"] += 1
            if data.get(FIELD_INVALIDATED):
                result["invalidated_chunks"] += 1
    except Exception as exc:
        logger.warning("memory_health_for_scope: chunk read failed for %s: %s", scope.scope_key, exc)

    try:
        for _ in events_collection_ref(fs_client, scope).stream():
            result["event_count"] += 1
    except Exception as exc:
        logger.warning("memory_health_for_scope: event read failed for %s: %s", scope.scope_key, exc)

    total = result["chunk_count"]
    bad = result["stale_chunks"] + result["invalidated_chunks"]
    result["healthy"] = bad == 0 or (total > 0 and bad / total < 0.5)

    return result


# ---------------------------------------------------------------------------
# Route-facing hooks (non-fatal wrappers)
# ---------------------------------------------------------------------------


def on_context_reset(
    fs_client: Any,
    scope: ThreadMemoryScope,
    reset_at: datetime,
) -> dict:
    """Called when a user resets Steve context.

    Invalidates all memory for *scope* and clears the thread summary.
    Returns combined stats.  Never raises.
    """
    stats: dict = {"chunks_invalidated": 0, "events_invalidated": 0, "summary_cleared": False}
    try:
        inv = invalidate_memory_for_scope(
            fs_client, scope, reason=f"context_reset at {reset_at.isoformat()}"
        )
        stats["chunks_invalidated"] = inv["chunks_invalidated"]
        stats["events_invalidated"] = inv["events_invalidated"]
    except Exception as exc:
        logger.warning("on_context_reset: invalidation failed for %s: %s", scope.scope_key, exc)

    try:
        from backend.services.steve_thread_memory import clear_thread_summary

        collection = "dm_conversations" if scope.surface == "dm" else "group_chats"
        clear_thread_summary(fs_client, collection=collection, doc_id=scope.thread_id)
        stats["summary_cleared"] = True
    except Exception as exc:
        logger.warning("on_context_reset: clear_thread_summary failed for %s: %s", scope.scope_key, exc)

    return stats


def on_message_deleted(
    fs_client: Any,
    scope: ThreadMemoryScope,
    message_id: str,
) -> int:
    """Called when a message is deleted.  Marks affected chunks stale.

    Never raises.
    """
    try:
        return invalidate_chunks_containing_message(fs_client, scope, message_id)
    except Exception as exc:
        logger.warning("on_message_deleted: failed for %s msg %s: %s", scope.scope_key, message_id, exc)
        return 0


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _batch_update_subcollection(
    fs_client: Any,
    scope: ThreadMemoryScope,
    subcollection: str,
    patch: dict,
) -> int:
    """Apply *patch* (merge) to every doc in the subcollection.  Returns count."""
    updated = 0
    try:
        parent = memory_doc_ref(fs_client, scope)
        coll = parent.collection(subcollection)
        for doc in coll.stream():
            try:
                coll.document(doc.id).set(patch, merge=True)
                updated += 1
            except Exception as exc:
                logger.warning(
                    "_batch_update_subcollection: update %s/%s failed: %s",
                    subcollection, doc.id, exc,
                )
    except Exception as exc:
        logger.warning(
            "_batch_update_subcollection: stream %s for %s failed: %s",
            subcollection, scope.scope_key, exc,
        )
    return updated


def _batch_delete_subcollection(
    fs_client: Any,
    scope: ThreadMemoryScope,
    subcollection: str,
) -> int:
    """Delete every doc in the subcollection.  Returns count."""
    deleted = 0
    try:
        parent = memory_doc_ref(fs_client, scope)
        coll = parent.collection(subcollection)
        for doc in coll.stream():
            try:
                coll.document(doc.id).delete()
                deleted += 1
            except Exception as exc:
                logger.warning(
                    "_batch_delete_subcollection: delete %s/%s failed: %s",
                    subcollection, doc.id, exc,
                )
    except Exception as exc:
        logger.warning(
            "_batch_delete_subcollection: stream %s for %s failed: %s",
            subcollection, scope.scope_key, exc,
        )
    return deleted
