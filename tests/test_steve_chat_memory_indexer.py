"""Tests for the Steve chat-memory chunk indexer (Phase 3 PR2).

Covers:
- Chunk building: correct grouping, time-gap splits, sender counts.
- Source-hash idempotency.
- Unsafe message skipping (deleted/encrypted).
- Reset respect: pre-reset messages excluded.
- Dry-run mode: returns stats, writes nothing.
- Chunk field schema validation.
- Backfill status query.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock

import pytest

from backend.services.steve_chat_memory_indexer import (
    BackfillStats,
    ChunkRecord,
    TIME_GAP_DEFAULT,
    _compute_source_hash,
    _should_split_on_time_gap,
    backfill_peer_dm,
    backfill_status,
    build_chunks_from_rows,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _msg(
    doc_id: str,
    sender: str,
    text: str,
    created_at: datetime,
    *,
    is_deleted: bool = False,
    is_encrypted: bool = False,
    image_path: str = "",
) -> Dict[str, Any]:
    """Build a fake Firestore message row."""
    return {
        "doc_id": doc_id,
        "sender": sender,
        "text": text,
        "created_at": created_at,
        "is_deleted": is_deleted,
        "is_encrypted": is_encrypted,
        "image_path": image_path,
    }


def _make_messages(
    n: int,
    *,
    start: datetime = datetime(2026, 1, 1, 10, 0, 0),
    interval_minutes: int = 2,
    sender_cycle: Tuple[str, ...] = ("alice", "bob"),
) -> List[Dict[str, Any]]:
    """Generate n sequential messages."""
    rows = []
    for i in range(n):
        ts = start + timedelta(minutes=i * interval_minutes)
        sender = sender_cycle[i % len(sender_cycle)]
        rows.append(_msg(f"msg-{i:04d}", sender, f"Message {i}", ts))
    return rows


class _FakeDoc:
    """Minimal stand-in for a Firestore DocumentSnapshot."""

    def __init__(self, doc_id: str, data: Optional[Dict[str, Any]], *, exists: bool = True):
        self.id = doc_id
        self._data = data or {}
        self.exists = exists

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data)


class _FakeQuery:
    """Fake Firestore query that supports order_by/limit/stream chaining."""

    def __init__(self, docs: List[_FakeDoc]):
        self._docs = list(docs)

    def order_by(self, field: str, **kw):
        return self

    def limit(self, n: int):
        return _FakeQuery(self._docs[:n])

    def stream(self):
        return iter(self._docs)

    def where(self, *args, **kw):
        return self


class _FakeCollection:
    """Fake Firestore collection with document/subcollection support."""

    def __init__(self):
        self._docs: Dict[str, Dict[str, Any]] = {}
        self._subcollections: Dict[str, _FakeCollection] = {}
        self._query_docs: List[_FakeDoc] = []

    def document(self, doc_id: str):
        return _FakeDocRef(self, doc_id)

    def collection(self, name: str):
        if name not in self._subcollections:
            self._subcollections[name] = _FakeCollection()
        return self._subcollections[name]

    def order_by(self, field: str, **kw):
        return _FakeQuery(self._query_docs)

    def limit(self, n: int):
        return _FakeQuery(self._query_docs[:n])

    def stream(self):
        docs = []
        for doc_id, data in self._docs.items():
            docs.append(_FakeDoc(doc_id, data))
        return iter(docs)

    def where(self, *args, **kw):
        return self


class _FakeDocRef:
    def __init__(self, coll: _FakeCollection, doc_id: str):
        self._coll = coll
        self._doc_id = doc_id

    def get(self):
        if self._doc_id in self._coll._docs:
            return _FakeDoc(self._doc_id, self._coll._docs[self._doc_id])
        return _FakeDoc(self._doc_id, {}, exists=False)

    def set(self, data: Dict[str, Any], merge: bool = False):
        if merge and self._doc_id in self._coll._docs:
            self._coll._docs[self._doc_id].update(data)
        else:
            self._coll._docs[self._doc_id] = dict(data)

    def collection(self, name: str):
        key = f"{self._doc_id}/{name}"
        if key not in self._coll._subcollections:
            self._coll._subcollections[key] = _FakeCollection()
        return self._coll._subcollections[key]


class _FakeFirestore:
    """Minimal Firestore client double."""

    def __init__(self):
        self._collections: Dict[str, _FakeCollection] = {}

    def collection(self, name: str):
        if name not in self._collections:
            self._collections[name] = _FakeCollection()
        return self._collections[name]


def _seed_conv(
    fs: _FakeFirestore,
    conv_id: str,
    messages: List[Dict[str, Any]],
    *,
    conv_data: Optional[Dict[str, Any]] = None,
) -> None:
    """Seed a fake DM conversation + messages into the fake Firestore."""
    conv_coll = fs.collection("dm_conversations")
    conv_coll._docs[conv_id] = conv_data or {}

    # Messages subcollection key
    msgs_key = f"{conv_id}/messages"
    if msgs_key not in conv_coll._subcollections:
        conv_coll._subcollections[msgs_key] = _FakeCollection()
    msgs_coll = conv_coll._subcollections[msgs_key]

    fake_docs = []
    for m in messages:
        doc_id = m.get("doc_id") or m.get("id", "")
        msgs_coll._docs[doc_id] = dict(m)
        fake_docs.append(_FakeDoc(doc_id, dict(m)))
    msgs_coll._query_docs = fake_docs


# ---------------------------------------------------------------------------
# build_chunks_from_rows
# ---------------------------------------------------------------------------

class TestBuildChunks:
    def test_groups_messages_into_chunks_of_configured_size(self):
        rows = _make_messages(150)
        chunks = build_chunks_from_rows(rows, scope_key="dm:conv-1", chunk_size=60)

        assert len(chunks) == 3  # 60 + 60 + 30
        assert len(chunks[0].source_message_ids) == 60
        assert len(chunks[1].source_message_ids) == 60
        assert len(chunks[2].source_message_ids) == 30

    def test_single_chunk_for_fewer_than_chunk_size_messages(self):
        rows = _make_messages(10)
        chunks = build_chunks_from_rows(rows, scope_key="dm:conv-2", chunk_size=60)

        assert len(chunks) == 1
        assert len(chunks[0].source_message_ids) == 10

    def test_empty_input_yields_no_chunks(self):
        chunks = build_chunks_from_rows([], scope_key="dm:conv-3", chunk_size=60)
        assert chunks == []

    def test_time_gap_splits_into_separate_chunks(self):
        t0 = datetime(2026, 3, 1, 10, 0, 0)
        rows = [
            _msg("m1", "alice", "Hi", t0),
            _msg("m2", "bob", "Hey", t0 + timedelta(minutes=5)),
            # 25-hour gap — exceeds default 24h threshold
            _msg("m3", "alice", "Back", t0 + timedelta(hours=26)),
            _msg("m4", "bob", "Welcome back", t0 + timedelta(hours=26, minutes=2)),
        ]
        chunks = build_chunks_from_rows(rows, scope_key="dm:conv-gap", chunk_size=100)

        assert len(chunks) == 2
        assert chunks[0].source_message_ids == ["m1", "m2"]
        assert chunks[1].source_message_ids == ["m3", "m4"]

    def test_time_gap_under_threshold_does_not_split(self):
        t0 = datetime(2026, 3, 1, 10, 0, 0)
        rows = [
            _msg("m1", "alice", "Hi", t0),
            _msg("m2", "bob", "Hey", t0 + timedelta(hours=20)),
        ]
        chunks = build_chunks_from_rows(rows, scope_key="dm:conv-nosplit", chunk_size=100)

        assert len(chunks) == 1

    def test_senders_dict_counts_messages_per_sender(self):
        rows = _make_messages(10, sender_cycle=("alice", "alice", "bob"))
        chunks = build_chunks_from_rows(rows, scope_key="dm:conv-senders", chunk_size=100)

        assert len(chunks) == 1
        assert chunks[0].senders["alice"] == 7  # indices 0,1,3,4,6,7,9
        assert chunks[0].senders["bob"] == 3    # indices 2,5,8

    def test_scope_key_propagated_to_all_chunks(self):
        rows = _make_messages(120)
        chunks = build_chunks_from_rows(rows, scope_key="dm:my-conv", chunk_size=60)

        for chunk in chunks:
            assert chunk.scope_key == "dm:my-conv"

    def test_chunk_timestamps_match_first_and_last_message(self):
        t0 = datetime(2026, 4, 1, 8, 0, 0)
        rows = _make_messages(5, start=t0, interval_minutes=10)
        chunks = build_chunks_from_rows(rows, scope_key="dm:ts-test", chunk_size=100)

        assert len(chunks) == 1
        assert chunks[0].message_ts_start == t0
        assert chunks[0].message_ts_end == t0 + timedelta(minutes=40)

    def test_chunk_id_is_unique_per_chunk(self):
        rows = _make_messages(120)
        chunks = build_chunks_from_rows(rows, scope_key="dm:uniq", chunk_size=60)

        ids = [c.chunk_id for c in chunks]
        assert len(ids) == len(set(ids))


class TestUnsafeMessageSkipping:
    def test_deleted_messages_excluded(self):
        t0 = datetime(2026, 5, 1, 12, 0, 0)
        rows = [
            _msg("m1", "alice", "Hello", t0),
            _msg("m2", "bob", "Secret", t0 + timedelta(minutes=1), is_deleted=True),
            _msg("m3", "alice", "World", t0 + timedelta(minutes=2)),
        ]
        chunks = build_chunks_from_rows(rows, scope_key="dm:del", chunk_size=100)

        assert len(chunks) == 1
        assert chunks[0].source_message_ids == ["m1", "m3"]
        assert "Secret" not in chunks[0].text

    def test_encrypted_messages_excluded(self):
        t0 = datetime(2026, 5, 1, 12, 0, 0)
        rows = [
            _msg("m1", "alice", "Hello", t0),
            _msg("m2", "bob", "Encrypted msg", t0 + timedelta(minutes=1), is_encrypted=True),
            _msg("m3", "alice", "World", t0 + timedelta(minutes=2)),
        ]
        chunks = build_chunks_from_rows(rows, scope_key="dm:enc", chunk_size=100)

        assert len(chunks) == 1
        assert chunks[0].source_message_ids == ["m1", "m3"]
        assert "Encrypted" not in chunks[0].text

    def test_all_unsafe_yields_no_chunks(self):
        t0 = datetime(2026, 5, 1, 12, 0, 0)
        rows = [
            _msg("m1", "alice", "X", t0, is_deleted=True),
            _msg("m2", "bob", "Y", t0 + timedelta(minutes=1), is_encrypted=True),
        ]
        chunks = build_chunks_from_rows(rows, scope_key="dm:allbad", chunk_size=100)
        assert chunks == []


class TestResetRespect:
    def test_messages_before_reset_excluded(self):
        t0 = datetime(2026, 5, 1, 12, 0, 0)
        reset_at = datetime(2026, 5, 1, 12, 3, 0)
        rows = [
            _msg("m1", "alice", "Before reset 1", t0),
            _msg("m2", "bob", "Before reset 2", t0 + timedelta(minutes=1)),
            _msg("m3", "alice", "After reset", t0 + timedelta(minutes=5)),
            _msg("m4", "bob", "Also after", t0 + timedelta(minutes=6)),
        ]
        chunks = build_chunks_from_rows(
            rows, scope_key="dm:reset", chunk_size=100, reset_at=reset_at,
        )

        assert len(chunks) == 1
        assert chunks[0].source_message_ids == ["m3", "m4"]
        assert "Before reset" not in chunks[0].text

    def test_no_reset_includes_all(self):
        rows = _make_messages(5)
        chunks = build_chunks_from_rows(
            rows, scope_key="dm:noreset", chunk_size=100, reset_at=None,
        )

        assert len(chunks) == 1
        assert len(chunks[0].source_message_ids) == 5

    def test_reset_after_all_messages_yields_no_chunks(self):
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        rows = _make_messages(5, start=t0)
        reset_at = datetime(2027, 1, 1, 0, 0, 0)
        chunks = build_chunks_from_rows(
            rows, scope_key="dm:future-reset", chunk_size=100, reset_at=reset_at,
        )
        assert chunks == []


class TestSourceHashIdempotency:
    def test_same_messages_produce_same_hash(self):
        rows = _make_messages(10)
        c1 = build_chunks_from_rows(rows, scope_key="dm:hash", chunk_size=100)
        c2 = build_chunks_from_rows(rows, scope_key="dm:hash", chunk_size=100)

        assert c1[0].source_hash == c2[0].source_hash

    def test_different_messages_produce_different_hash(self):
        r1 = [_msg("m1", "alice", "Hello", datetime(2026, 1, 1, 10, 0))]
        r2 = [_msg("m1", "alice", "Goodbye", datetime(2026, 1, 1, 10, 0))]

        c1 = build_chunks_from_rows(r1, scope_key="dm:h1", chunk_size=100)
        c2 = build_chunks_from_rows(r2, scope_key="dm:h2", chunk_size=100)

        assert c1[0].source_hash != c2[0].source_hash

    def test_hash_is_sha256_hex(self):
        rows = _make_messages(3)
        chunks = build_chunks_from_rows(rows, scope_key="dm:hex", chunk_size=100)

        h = chunks[0].source_hash
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)


class TestChunkFieldSchema:
    def test_chunk_record_has_all_required_fields(self):
        rows = _make_messages(5)
        chunks = build_chunks_from_rows(rows, scope_key="dm:schema", chunk_size=100)
        chunk = chunks[0]

        assert isinstance(chunk.scope_key, str)
        assert isinstance(chunk.chunk_id, str) and len(chunk.chunk_id) > 0
        assert isinstance(chunk.message_start_id, str)
        assert isinstance(chunk.message_end_id, str)
        assert isinstance(chunk.message_ts_start, datetime)
        assert isinstance(chunk.message_ts_end, datetime)
        assert isinstance(chunk.senders, dict)
        assert isinstance(chunk.text, str) and len(chunk.text) > 0
        assert chunk.summary == ""
        assert isinstance(chunk.source_hash, str) and len(chunk.source_hash) == 64
        assert isinstance(chunk.source_message_ids, list)
        assert chunk.stale is False
        assert chunk.invalidated is False
        assert chunk.is_deleted is False
        assert chunk.deleted_at is None
        assert chunk.encrypted is False
        assert isinstance(chunk.indexed_at, datetime)

    def test_to_firestore_dict_produces_expected_keys(self):
        rows = _make_messages(3)
        chunks = build_chunks_from_rows(rows, scope_key="dm:dict", chunk_size=100)
        d = chunks[0].to_firestore_dict()

        expected_keys = {
            "scope_key", "chunk_id", "message_start_id", "message_end_id",
            "message_ts_start", "message_ts_end", "senders", "text",
            "summary", "source_hash", "source_message_ids", "stale",
            "invalidated", "is_deleted", "deleted_at", "encrypted",
            "indexed_at",
        }
        assert set(d.keys()) == expected_keys

    def test_firestore_dict_timestamps_are_iso_strings(self):
        rows = _make_messages(3)
        chunks = build_chunks_from_rows(rows, scope_key="dm:iso", chunk_size=100)
        d = chunks[0].to_firestore_dict()

        assert d["message_ts_start"].endswith("Z")
        assert d["message_ts_end"].endswith("Z")
        assert d["indexed_at"].endswith("Z")
        assert d["deleted_at"] is None


# ---------------------------------------------------------------------------
# Time gap split helper
# ---------------------------------------------------------------------------

class TestTimeGapSplit:
    def test_no_split_when_prev_is_none(self):
        assert _should_split_on_time_gap(None, datetime(2026, 1, 1)) is False

    def test_no_split_when_curr_is_none(self):
        assert _should_split_on_time_gap(datetime(2026, 1, 1), None) is False

    def test_split_at_exactly_24h(self):
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        assert _should_split_on_time_gap(t0, t0 + timedelta(hours=24), TIME_GAP_DEFAULT) is True

    def test_no_split_just_under_threshold(self):
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        assert _should_split_on_time_gap(
            t0, t0 + timedelta(hours=23, minutes=59), TIME_GAP_DEFAULT,
        ) is False


# ---------------------------------------------------------------------------
# Backfill integration (with fake Firestore)
# ---------------------------------------------------------------------------

class TestBackfillPeerDm:
    def test_dry_run_returns_stats_no_writes(self):
        fs = _FakeFirestore()
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        msgs = _make_messages(10, start=t0)
        _seed_conv(fs, "conv-dry", msgs)

        stats = backfill_peer_dm(fs, "conv-dry", dry_run=True)

        assert stats.dry_run is True
        assert stats.messages_read == 10
        assert stats.messages_included == 10
        assert stats.chunks_built == 1
        assert stats.chunks_written == 0

        # Verify no chunks subcollection was created
        scope_key = "dm:conv-dry"
        mem_coll = fs.collection("steve_chat_memory")
        chunk_key = f"{scope_key}/chunks"
        if chunk_key in mem_coll._subcollections:
            assert len(mem_coll._subcollections[chunk_key]._docs) == 0

    def test_real_run_writes_chunks(self):
        fs = _FakeFirestore()
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        msgs = _make_messages(130, start=t0)
        _seed_conv(fs, "conv-write", msgs)

        stats = backfill_peer_dm(fs, "conv-write", dry_run=False)

        assert stats.dry_run is False
        assert stats.chunks_built == 3  # 60 + 60 + 10
        assert stats.chunks_written == 3
        assert stats.chunks_skipped_existing == 0

    def test_idempotent_rerun_skips_existing(self):
        fs = _FakeFirestore()
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        msgs = _make_messages(10, start=t0)
        _seed_conv(fs, "conv-idem", msgs)

        stats1 = backfill_peer_dm(fs, "conv-idem", dry_run=False)
        assert stats1.chunks_written == 1

        stats2 = backfill_peer_dm(fs, "conv-idem", dry_run=False)
        assert stats2.chunks_written == 0
        assert stats2.chunks_skipped_existing == 1

    def test_skips_deleted_and_encrypted_messages(self):
        fs = _FakeFirestore()
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        msgs = [
            _msg("m1", "alice", "Safe", t0),
            _msg("m2", "bob", "Deleted", t0 + timedelta(minutes=1), is_deleted=True),
            _msg("m3", "alice", "Encrypted", t0 + timedelta(minutes=2), is_encrypted=True),
            _msg("m4", "bob", "Also safe", t0 + timedelta(minutes=3)),
        ]
        _seed_conv(fs, "conv-unsafe", msgs)

        stats = backfill_peer_dm(fs, "conv-unsafe", dry_run=True)

        assert stats.messages_read == 4
        assert stats.messages_skipped_unsafe == 2
        assert stats.messages_included == 2
        assert stats.chunks_built == 1

    def test_respects_reset_at_from_conversation_doc(self):
        fs = _FakeFirestore()
        t0 = datetime(2026, 5, 1, 10, 0, 0)
        reset_at = datetime(2026, 5, 1, 10, 3, 0)
        msgs = [
            _msg("m1", "alice", "Old 1", t0),
            _msg("m2", "bob", "Old 2", t0 + timedelta(minutes=1)),
            _msg("m3", "alice", "New 1", t0 + timedelta(minutes=5)),
            _msg("m4", "bob", "New 2", t0 + timedelta(minutes=6)),
        ]
        _seed_conv(fs, "conv-reset", msgs, conv_data={
            "steve_context_reset_at": reset_at.isoformat() + "Z",
        })

        stats = backfill_peer_dm(fs, "conv-reset", dry_run=True)

        assert stats.messages_skipped_before_reset == 2
        assert stats.messages_included == 2
        assert stats.chunks_built == 1

    def test_limit_caps_messages_read(self):
        fs = _FakeFirestore()
        msgs = _make_messages(200)
        _seed_conv(fs, "conv-limit", msgs)

        stats = backfill_peer_dm(fs, "conv-limit", dry_run=True, limit=50)

        assert stats.messages_read == 50
        assert stats.messages_included == 50

    def test_elapsed_ms_is_populated(self):
        fs = _FakeFirestore()
        msgs = _make_messages(5)
        _seed_conv(fs, "conv-time", msgs)

        stats = backfill_peer_dm(fs, "conv-time", dry_run=True)

        assert stats.elapsed_ms >= 0

    def test_empty_conversation_returns_zero_stats(self):
        fs = _FakeFirestore()
        _seed_conv(fs, "conv-empty", [])

        stats = backfill_peer_dm(fs, "conv-empty", dry_run=True)

        assert stats.messages_read == 0
        assert stats.chunks_built == 0

    def test_updates_memory_doc_metadata_on_write(self):
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_conv(fs, "conv-meta", msgs)

        backfill_peer_dm(fs, "conv-meta", dry_run=False)

        scope_key = "dm:conv-meta"
        mem_doc_data = fs.collection("steve_chat_memory")._docs.get(scope_key, {})
        assert mem_doc_data.get("scope_key") == scope_key
        assert mem_doc_data.get("chunk_count") == 1
        assert mem_doc_data.get("last_indexed_message_id") is not None
        assert mem_doc_data.get("last_indexed_at") is not None


class TestBackfillStatus:
    def test_not_indexed_returns_baseline(self):
        fs = _FakeFirestore()
        result = backfill_status(fs, "conv-unknown")

        assert result["indexed"] is False
        assert result["chunk_count"] == 0
        assert result["last_indexed_message_id"] is None

    def test_indexed_returns_metadata(self):
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_conv(fs, "conv-status", msgs)
        backfill_peer_dm(fs, "conv-status", dry_run=False)

        result = backfill_status(fs, "conv-status")

        assert result["indexed"] is True
        assert result["chunk_count"] == 1
        assert result["scope_key"] == "dm:conv-status"


# ---------------------------------------------------------------------------
# Backfill event ledger integration
# ---------------------------------------------------------------------------

class TestBackfillEventLedger:
    def test_events_written_when_ledger_enabled(self):
        fs = _FakeFirestore()
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        msgs = [
            _msg("m1", "alice", "went to the gym today", t0),
            _msg("m2", "bob", "nice workout!", t0 + timedelta(minutes=1)),
            _msg("m3", "alice", "ate lunch after", t0 + timedelta(minutes=2)),
        ]
        _seed_conv(fs, "conv-evt", msgs)

        stats = backfill_peer_dm(
            fs, "conv-evt", dry_run=False,
            entitlements={
                "chat_memory_enabled": True,
                "chat_memory_peer_dm_enabled": True,
                "chat_memory_event_ledger_enabled": True,
            },
        )
        assert stats.events_written >= 1

    def test_no_events_written_when_ledger_disabled(self):
        fs = _FakeFirestore()
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        msgs = [_msg("m1", "alice", "went to the gym", t0)]
        _seed_conv(fs, "conv-evt-off", msgs)

        stats = backfill_peer_dm(
            fs, "conv-evt-off", dry_run=False,
            entitlements={"chat_memory_event_ledger_enabled": False},
        )
        assert stats.events_written == 0

    def test_no_events_written_in_dry_run(self):
        fs = _FakeFirestore()
        t0 = datetime(2026, 1, 1, 10, 0, 0)
        msgs = [_msg("m1", "alice", "went to the gym", t0)]
        _seed_conv(fs, "conv-evt-dry", msgs)

        stats = backfill_peer_dm(
            fs, "conv-evt-dry", dry_run=True,
            entitlements={
                "chat_memory_enabled": True,
                "chat_memory_peer_dm_enabled": True,
                "chat_memory_event_ledger_enabled": True,
            },
        )
        assert stats.events_written == 0
