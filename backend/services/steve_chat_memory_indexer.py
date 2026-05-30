"""Peer-DM chunk indexer for Steve Phase 3 chat memory.

Builds deterministic, idempotent message chunks from Firestore DM
conversations and writes them to the ``steve_chat_memory`` sidecar
layout defined in ``steve_chat_memory.py``.

No embeddings, no vendor calls, no prompt injection.  This module only
reads messages and writes structured chunk documents.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence

from backend.services.steve_chat_memory import (
    CHUNKS_SUBCOLLECTION,
    COLLECTION,
    ChatMemoryConfig,
    ThreadMemoryScope,
    get_chat_memory_config,
    parse_memory_datetime,
    scope_for_group,
    scope_for_peer_dm,
)
from backend.services.steve_thread_memory import (
    is_unsafe_context_message,
    message_line_from_row,
)

logger = logging.getLogger(__name__)

TIME_GAP_HOURS_MIN = 12
TIME_GAP_HOURS_MAX = 24
TIME_GAP_DEFAULT = timedelta(hours=TIME_GAP_HOURS_MAX)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class ChunkRecord:
    """In-memory representation of a single indexed chunk."""

    scope_key: str
    chunk_id: str
    message_start_id: str
    message_end_id: str
    message_ts_start: Optional[datetime]
    message_ts_end: Optional[datetime]
    senders: Dict[str, int] = field(default_factory=dict)
    text: str = ""
    summary: str = ""
    source_hash: str = ""
    source_message_ids: List[str] = field(default_factory=list)
    stale: bool = False
    invalidated: bool = False
    is_deleted: bool = False
    deleted_at: Optional[datetime] = None
    encrypted: bool = False
    indexed_at: Optional[datetime] = None

    def to_firestore_dict(self) -> Dict[str, Any]:
        return {
            "scope_key": self.scope_key,
            "chunk_id": self.chunk_id,
            "message_start_id": self.message_start_id,
            "message_end_id": self.message_end_id,
            "message_ts_start": self.message_ts_start.isoformat() + "Z"
            if self.message_ts_start else None,
            "message_ts_end": self.message_ts_end.isoformat() + "Z"
            if self.message_ts_end else None,
            "senders": self.senders,
            "text": self.text,
            "summary": self.summary,
            "source_hash": self.source_hash,
            "source_message_ids": self.source_message_ids,
            "stale": self.stale,
            "invalidated": self.invalidated,
            "is_deleted": self.is_deleted,
            "deleted_at": self.deleted_at.isoformat() + "Z"
            if self.deleted_at else None,
            "encrypted": self.encrypted,
            "indexed_at": self.indexed_at.isoformat() + "Z"
            if self.indexed_at else None,
        }


@dataclass
class BackfillStats:
    """Summary returned by a backfill run."""

    conv_id: str
    scope_key: str
    messages_read: int = 0
    messages_included: int = 0
    messages_skipped_unsafe: int = 0
    messages_skipped_before_reset: int = 0
    chunks_built: int = 0
    chunks_written: int = 0
    chunks_skipped_existing: int = 0
    events_written: int = 0
    dry_run: bool = True
    elapsed_ms: int = 0


# ---------------------------------------------------------------------------
# Chunk building
# ---------------------------------------------------------------------------

def _compute_source_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _make_chunk_id() -> str:
    return uuid.uuid4().hex[:20]


def _parse_row_ts(row: Mapping[str, Any]) -> Optional[datetime]:
    return parse_memory_datetime(row.get("created_at") or row.get("timestamp"))


def _should_split_on_time_gap(
    prev_ts: Optional[datetime],
    curr_ts: Optional[datetime],
    gap: timedelta = TIME_GAP_DEFAULT,
) -> bool:
    if prev_ts is None or curr_ts is None:
        return False
    return (curr_ts - prev_ts) >= gap


def build_chunks_from_rows(
    rows: Sequence[Mapping[str, Any]],
    *,
    scope_key: str,
    chunk_size: int = 60,
    time_gap: timedelta = TIME_GAP_DEFAULT,
    reset_at: Optional[datetime] = None,
) -> List[ChunkRecord]:
    """Group message rows into deterministic chunks.

    ``rows`` must be sorted by ``created_at`` ascending.  Deleted,
    encrypted, and pre-reset rows are excluded from chunks.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    pending_rows: List[Dict[str, Any]] = []
    pending_ids: List[str] = []
    pending_lines: List[str] = []
    pending_senders: Dict[str, int] = {}
    prev_ts: Optional[datetime] = None
    chunks: List[ChunkRecord] = []

    reset_dt = parse_memory_datetime(reset_at)

    def _flush() -> None:
        if not pending_lines:
            pending_rows.clear()
            pending_ids.clear()
            pending_senders.clear()
            return
        text = "\n".join(pending_lines)
        first_ts = _parse_row_ts(pending_rows[0]) if pending_rows else None
        last_ts = _parse_row_ts(pending_rows[-1]) if pending_rows else None
        chunks.append(
            ChunkRecord(
                scope_key=scope_key,
                chunk_id=_make_chunk_id(),
                message_start_id=pending_ids[0],
                message_end_id=pending_ids[-1],
                message_ts_start=first_ts,
                message_ts_end=last_ts,
                senders=dict(pending_senders),
                text=text,
                summary="",
                source_hash=_compute_source_hash(text),
                source_message_ids=list(pending_ids),
                stale=False,
                invalidated=False,
                is_deleted=False,
                deleted_at=None,
                encrypted=False,
                indexed_at=now,
            )
        )
        pending_rows.clear()
        pending_ids.clear()
        pending_lines.clear()
        pending_senders.clear()

    for row in rows:
        d = dict(row) if not isinstance(row, dict) else row

        if is_unsafe_context_message(d):
            continue

        row_ts = _parse_row_ts(d)
        if reset_dt and row_ts and row_ts < reset_dt:
            continue

        msg_id = str(d.get("id") or d.get("doc_id") or d.get("message_id") or "")

        if _should_split_on_time_gap(prev_ts, row_ts, time_gap):
            _flush()

        if len(pending_ids) >= chunk_size:
            _flush()

        sender = str(d.get("sender") or d.get("username") or "").strip()
        line = message_line_from_row(
            sender,
            d.get("text"),
            has_media=bool(d.get("image_path") or d.get("media_paths")),
            ts=d.get("created_at"),
        )
        if line:
            pending_rows.append(d)
            pending_ids.append(msg_id)
            pending_lines.append(line)
            pending_senders[sender] = pending_senders.get(sender, 0) + 1
            prev_ts = row_ts

    _flush()
    return chunks


# ---------------------------------------------------------------------------
# Firestore helpers
# ---------------------------------------------------------------------------

def _existing_hashes(fs_client: Any, scope: ThreadMemoryScope) -> set[str]:
    """Read all source_hash values from existing chunks for dedup."""
    try:
        chunks_ref = (
            fs_client.collection(COLLECTION)
            .document(scope.scope_key)
            .collection(CHUNKS_SUBCOLLECTION)
        )
        hashes: set[str] = set()
        for doc in chunks_ref.stream():
            data = doc.to_dict() or {}
            h = data.get("source_hash")
            if h:
                hashes.add(str(h))
        return hashes
    except Exception as exc:
        logger.warning("Failed to read existing chunk hashes for %s: %s", scope.scope_key, exc)
        return set()


def _write_chunk(fs_client: Any, scope: ThreadMemoryScope, chunk: ChunkRecord) -> None:
    """Write one chunk document to Firestore."""
    (
        fs_client.collection(COLLECTION)
        .document(scope.scope_key)
        .collection(CHUNKS_SUBCOLLECTION)
        .document(chunk.chunk_id)
        .set(chunk.to_firestore_dict())
    )


def _update_memory_doc_metadata(
    fs_client: Any,
    scope: ThreadMemoryScope,
    *,
    last_indexed_message_id: str,
    last_indexed_at: datetime,
    chunk_count: int,
) -> None:
    fs_client.collection(COLLECTION).document(scope.scope_key).set(
        {
            "scope_key": scope.scope_key,
            "surface": scope.surface,
            "thread_id": scope.thread_id,
            "last_indexed_message_id": last_indexed_message_id,
            "last_indexed_at": last_indexed_at.isoformat() + "Z",
            "chunk_count": chunk_count,
        },
        merge=True,
    )


# ---------------------------------------------------------------------------
# Backfill
# ---------------------------------------------------------------------------

def backfill_peer_dm(
    fs_client: Any,
    conv_id: str,
    *,
    dry_run: bool = True,
    limit: Optional[int] = None,
    entitlements: Optional[Mapping[str, Any]] = None,
) -> BackfillStats:
    """Index messages from one peer-DM conversation into chat-memory chunks.

    Parameters
    ----------
    fs_client
        Firestore client instance (passed, never created here).
    conv_id
        Firestore ``dm_conversations`` document id.
    dry_run
        When True (default), compute chunks but write nothing.
    limit
        Max messages to read.  Falls back to
        ``ChatMemoryConfig.backfill_max_messages``.
    entitlements
        Optional entitlements dict for config resolution.
    """
    import time as _time

    t0 = _time.monotonic()

    config = get_chat_memory_config(entitlements)
    effective_limit = limit if limit is not None else config.backfill_max_messages
    scope = scope_for_peer_dm(conv_id)

    stats = BackfillStats(
        conv_id=conv_id,
        scope_key=scope.scope_key,
        dry_run=dry_run,
    )

    # Read conversation doc for reset timestamp
    reset_at: Optional[datetime] = None
    try:
        conv_doc = fs_client.collection("dm_conversations").document(conv_id).get()
        if conv_doc.exists:
            conv_data = conv_doc.to_dict() or {}
            reset_at = parse_memory_datetime(
                conv_data.get("steve_context_reset_at")
            )
    except Exception as exc:
        logger.warning("backfill_peer_dm: cannot read conv doc %s: %s", conv_id, exc)

    reset_dt = parse_memory_datetime(reset_at)

    # Read messages ordered by created_at ASC
    try:
        msgs_ref = (
            fs_client.collection("dm_conversations")
            .document(conv_id)
            .collection("messages")
        )
        query = msgs_ref.order_by("created_at").limit(effective_limit)
        docs = list(query.stream())
    except Exception as exc:
        logger.error("backfill_peer_dm: failed to read messages for %s: %s", conv_id, exc)
        stats.elapsed_ms = int((_time.monotonic() - t0) * 1000)
        return stats

    raw_rows: List[Dict[str, Any]] = []
    for doc in docs:
        d = doc.to_dict() or {}
        d["doc_id"] = doc.id
        stats.messages_read += 1

        if is_unsafe_context_message(d):
            stats.messages_skipped_unsafe += 1
            continue

        row_ts = _parse_row_ts(d)
        if reset_dt and row_ts and row_ts < reset_dt:
            stats.messages_skipped_before_reset += 1
            continue

        stats.messages_included += 1
        raw_rows.append(d)

    # Build chunks
    chunks = build_chunks_from_rows(
        raw_rows,
        scope_key=scope.scope_key,
        chunk_size=config.chunk_messages,
        time_gap=TIME_GAP_DEFAULT,
        reset_at=None,  # already filtered above
    )
    stats.chunks_built = len(chunks)

    if dry_run:
        stats.elapsed_ms = int((_time.monotonic() - t0) * 1000)
        return stats

    # Idempotency: read existing hashes
    existing = _existing_hashes(fs_client, scope)

    written = 0
    last_msg_id = ""
    for chunk in chunks:
        if chunk.source_hash in existing:
            stats.chunks_skipped_existing += 1
            continue
        _write_chunk(fs_client, scope, chunk)
        existing.add(chunk.source_hash)
        written += 1
        last_msg_id = chunk.message_end_id

        if config.event_ledger_enabled:
            try:
                from backend.services.steve_chat_memory_events import (
                    index_events_from_chunk,
                    write_events,
                )

                chunk_events = index_events_from_chunk(scope, chunk)
                if chunk_events:
                    stats.events_written += write_events(
                        fs_client, scope, chunk_events,
                    )
            except Exception as evt_err:
                logger.warning(
                    "backfill event extraction failed for chunk %s (non-fatal): %s",
                    chunk.chunk_id, evt_err,
                )

    stats.chunks_written = written

    if written > 0 and last_msg_id:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        total_chunks = len(existing)
        _update_memory_doc_metadata(
            fs_client,
            scope,
            last_indexed_message_id=last_msg_id,
            last_indexed_at=now,
            chunk_count=total_chunks,
        )

    stats.elapsed_ms = int((_time.monotonic() - t0) * 1000)
    return stats


# ---------------------------------------------------------------------------
# Status query
# ---------------------------------------------------------------------------

def backfill_status(
    fs_client: Any,
    conv_id: str,
) -> Dict[str, Any]:
    """Read memory doc metadata for a peer-DM scope."""
    scope = scope_for_peer_dm(conv_id)
    try:
        doc = fs_client.collection(COLLECTION).document(scope.scope_key).get()
        if not doc.exists:
            return {
                "scope_key": scope.scope_key,
                "indexed": False,
                "last_indexed_message_id": None,
                "last_indexed_at": None,
                "chunk_count": 0,
            }
        data = doc.to_dict() or {}
        return {
            "scope_key": scope.scope_key,
            "indexed": True,
            "last_indexed_message_id": data.get("last_indexed_message_id"),
            "last_indexed_at": data.get("last_indexed_at"),
            "chunk_count": data.get("chunk_count", 0),
        }
    except Exception as exc:
        logger.error("backfill_status failed for %s: %s", conv_id, exc)
        return {
            "scope_key": scope.scope_key,
            "indexed": False,
            "last_indexed_message_id": None,
            "last_indexed_at": None,
            "chunk_count": 0,
            "error": str(exc),
        }


# ---------------------------------------------------------------------------
# Group chat backfill
# ---------------------------------------------------------------------------

def backfill_group_chat(
    fs_client: Any,
    group_id: str,
    *,
    dry_run: bool = True,
    limit: Optional[int] = None,
    entitlements: Optional[Mapping[str, Any]] = None,
    member_usernames: Optional[List[str]] = None,
    requesting_username: Optional[str] = None,
    skip_membership_check: bool = False,
) -> BackfillStats:
    """Index messages from one group chat into chat-memory chunks.

    Parameters
    ----------
    fs_client
        Firestore client instance (passed, never created here).
    group_id
        Firestore ``group_chats`` document id (string form of the int pk).
    dry_run
        When True (default), compute chunks but write nothing.
    limit
        Max messages to read.  Falls back to
        ``ChatMemoryConfig.backfill_max_messages``.
    entitlements
        Optional entitlements dict for config resolution.
    member_usernames
        List of current group member usernames. Required for membership
        validation unless ``skip_membership_check=True``.
    requesting_username
        The user requesting the backfill. Must be a member unless skipped.
    skip_membership_check
        When True (admin/cron invocations), bypass membership validation.
    """
    import time as _time

    t0 = _time.monotonic()

    config = get_chat_memory_config(entitlements)
    effective_limit = limit if limit is not None else config.backfill_max_messages
    scope = scope_for_group(group_id)

    stats = BackfillStats(
        conv_id=group_id,
        scope_key=scope.scope_key,
        dry_run=dry_run,
    )

    if not config.group_enabled and not skip_membership_check:
        logger.info("backfill_group_chat: group memory disabled, skipping %s", group_id)
        stats.elapsed_ms = int((_time.monotonic() - t0) * 1000)
        return stats

    if not skip_membership_check:
        if not requesting_username:
            logger.warning("backfill_group_chat: no requesting_username provided for %s", group_id)
            stats.elapsed_ms = int((_time.monotonic() - t0) * 1000)
            return stats
        if member_usernames is None or requesting_username not in member_usernames:
            logger.warning(
                "backfill_group_chat: user %s is not a member of group %s",
                requesting_username, group_id,
            )
            stats.elapsed_ms = int((_time.monotonic() - t0) * 1000)
            return stats

    # Read group doc for reset timestamp
    reset_at: Optional[datetime] = None
    try:
        group_doc = fs_client.collection("group_chats").document(str(group_id)).get()
        if group_doc.exists:
            group_data = group_doc.to_dict() or {}
            reset_at = parse_memory_datetime(
                group_data.get("steve_context_reset_at")
            )
    except Exception as exc:
        logger.warning("backfill_group_chat: cannot read group doc %s: %s", group_id, exc)

    reset_dt = parse_memory_datetime(reset_at)

    # Read messages ordered by created_at ASC
    try:
        msgs_ref = (
            fs_client.collection("group_chats")
            .document(str(group_id))
            .collection("messages")
        )
        query = msgs_ref.order_by("created_at").limit(effective_limit)
        docs = list(query.stream())
    except Exception as exc:
        logger.error("backfill_group_chat: failed to read messages for %s: %s", group_id, exc)
        stats.elapsed_ms = int((_time.monotonic() - t0) * 1000)
        return stats

    raw_rows: List[Dict[str, Any]] = []
    for doc in docs:
        d = doc.to_dict() or {}
        d["doc_id"] = doc.id
        stats.messages_read += 1

        if is_unsafe_context_message(d):
            stats.messages_skipped_unsafe += 1
            continue

        row_ts = _parse_row_ts(d)
        if reset_dt and row_ts and row_ts < reset_dt:
            stats.messages_skipped_before_reset += 1
            continue

        stats.messages_included += 1
        raw_rows.append(d)

    # Build chunks
    chunks = build_chunks_from_rows(
        raw_rows,
        scope_key=scope.scope_key,
        chunk_size=config.chunk_messages,
        time_gap=TIME_GAP_DEFAULT,
        reset_at=None,
    )
    stats.chunks_built = len(chunks)

    if dry_run:
        stats.elapsed_ms = int((_time.monotonic() - t0) * 1000)
        return stats

    # Idempotency: read existing hashes
    existing = _existing_hashes(fs_client, scope)

    written = 0
    last_msg_id = ""
    for chunk in chunks:
        if chunk.source_hash in existing:
            stats.chunks_skipped_existing += 1
            continue
        _write_chunk(fs_client, scope, chunk)
        existing.add(chunk.source_hash)
        written += 1
        last_msg_id = chunk.message_end_id

    stats.chunks_written = written

    if written > 0 and last_msg_id:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        total_chunks = len(existing)
        _update_memory_doc_metadata(
            fs_client,
            scope,
            last_indexed_message_id=last_msg_id,
            last_indexed_at=now,
            chunk_count=total_chunks,
        )

    stats.elapsed_ms = int((_time.monotonic() - t0) * 1000)
    return stats


def backfill_group_status(
    fs_client: Any,
    group_id: str,
) -> Dict[str, Any]:
    """Read memory doc metadata for a group chat scope."""
    scope = scope_for_group(group_id)
    try:
        doc = fs_client.collection(COLLECTION).document(scope.scope_key).get()
        if not doc.exists:
            return {
                "scope_key": scope.scope_key,
                "indexed": False,
                "last_indexed_message_id": None,
                "last_indexed_at": None,
                "chunk_count": 0,
            }
        data = doc.to_dict() or {}
        return {
            "scope_key": scope.scope_key,
            "indexed": True,
            "last_indexed_message_id": data.get("last_indexed_message_id"),
            "last_indexed_at": data.get("last_indexed_at"),
            "chunk_count": data.get("chunk_count", 0),
        }
    except Exception as exc:
        logger.error("backfill_group_status failed for %s: %s", group_id, exc)
        return {
            "scope_key": scope.scope_key,
            "indexed": False,
            "last_indexed_message_id": None,
            "last_indexed_at": None,
            "chunk_count": 0,
            "error": str(exc),
        }


def check_group_membership(
    fs_client: Any,
    group_id: str,
    username: str,
) -> bool:
    """Check if a user is a member of the group via MySQL group_chat_members.

    Falls back to False on any read error.
    """
    try:
        from backend.services.database import get_db_connection, get_sql_placeholder

        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"SELECT 1 FROM group_chat_members WHERE group_id = {ph} AND username = {ph}",
                (int(group_id), username),
            )
            return c.fetchone() is not None
    except Exception as exc:
        logger.warning("check_group_membership: error for group %s user %s: %s", group_id, username, exc)
        return False
