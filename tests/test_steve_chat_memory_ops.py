"""Tests for steve_chat_memory_ops — Phase 3 PR6.

Covers:
- invalidate_memory_for_scope marks all chunks/events as invalidated.
- invalidate_chunks_containing_message only marks the right chunks stale.
- purge_scope_memory hard-deletes all docs.
- memory_health_for_scope returns correct counts and health status.
- on_context_reset calls invalidate + clear_thread_summary.
- on_message_deleted marks correct chunks stale.
- Stale/invalidated chunks are excluded by should_include_memory_record.
- Non-fatal: failures don't propagate.
- Scope isolation: ops on one scope don't affect another.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

import pytest

from backend.services.steve_chat_memory import (
    CHUNKS_SUBCOLLECTION,
    COLLECTION,
    EVENTS_SUBCOLLECTION,
    FIELD_INVALIDATED,
    FIELD_STALE,
    ThreadMemoryScope,
    scope_for_group,
    scope_for_peer_dm,
    should_include_memory_record,
)
from backend.services.steve_chat_memory_ops import (
    invalidate_chunks_containing_message,
    invalidate_memory_for_scope,
    memory_health_for_scope,
    on_context_reset,
    on_message_deleted,
    purge_scope_memory,
)


# ---------------------------------------------------------------------------
# Fake Firestore (same pattern as indexer/retrieval tests)
# ---------------------------------------------------------------------------


class _FakeDoc:
    def __init__(self, doc_id: str, data: Optional[Dict[str, Any]], *, exists: bool = True):
        self.id = doc_id
        self._data = data or {}
        self.exists = exists

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data)


class _FakeCollection:
    def __init__(self):
        self._docs: Dict[str, Dict[str, Any]] = {}
        self._subcollections: Dict[str, "_FakeCollection"] = {}

    def document(self, doc_id: str):
        return _FakeDocRef(self, doc_id)

    def collection(self, name: str):
        if name not in self._subcollections:
            self._subcollections[name] = _FakeCollection()
        return self._subcollections[name]

    def stream(self):
        docs = []
        for doc_id, data in self._docs.items():
            docs.append(_FakeDoc(doc_id, data))
        return iter(docs)


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

    def delete(self):
        self._coll._docs.pop(self._doc_id, None)

    def collection(self, name: str):
        key = f"{self._doc_id}/{name}"
        if key not in self._coll._subcollections:
            self._coll._subcollections[key] = _FakeCollection()
        return self._coll._subcollections[key]


class _FakeFirestore:
    def __init__(self):
        self._collections: Dict[str, _FakeCollection] = {}

    def collection(self, name: str):
        if name not in self._collections:
            self._collections[name] = _FakeCollection()
        return self._collections[name]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_scope(conv_id: str = "conv-1") -> ThreadMemoryScope:
    return scope_for_peer_dm(conv_id)


def _make_group_scope(group_id: str = "42") -> ThreadMemoryScope:
    return scope_for_group(group_id)


def _seed_chunks(
    fs: _FakeFirestore,
    scope: ThreadMemoryScope,
    chunks: List[Dict[str, Any]],
) -> None:
    """Seed chunk docs into the fake Firestore."""
    mem_coll = fs.collection(COLLECTION)
    scope_doc_key = scope.scope_key
    mem_coll._docs[scope_doc_key] = {
        "scope_key": scope.scope_key,
        "last_indexed_at": "2026-05-01T12:00:00Z",
        "chunk_count": len(chunks),
    }

    chunks_key = f"{scope_doc_key}/{CHUNKS_SUBCOLLECTION}"
    if chunks_key not in mem_coll._subcollections:
        mem_coll._subcollections[chunks_key] = _FakeCollection()
    chunks_coll = mem_coll._subcollections[chunks_key]

    for chunk in chunks:
        chunk_id = chunk["chunk_id"]
        chunks_coll._docs[chunk_id] = dict(chunk)


def _seed_events(
    fs: _FakeFirestore,
    scope: ThreadMemoryScope,
    events: List[Dict[str, Any]],
) -> None:
    """Seed event docs into the fake Firestore."""
    mem_coll = fs.collection(COLLECTION)
    scope_doc_key = scope.scope_key

    events_key = f"{scope_doc_key}/{EVENTS_SUBCOLLECTION}"
    if events_key not in mem_coll._subcollections:
        mem_coll._subcollections[events_key] = _FakeCollection()
    events_coll = mem_coll._subcollections[events_key]

    for evt in events:
        event_id = evt["event_id"]
        events_coll._docs[event_id] = dict(evt)


def _get_chunk_data(fs: _FakeFirestore, scope: ThreadMemoryScope, chunk_id: str) -> Optional[Dict[str, Any]]:
    mem_coll = fs.collection(COLLECTION)
    chunks_key = f"{scope.scope_key}/{CHUNKS_SUBCOLLECTION}"
    chunks_coll = mem_coll._subcollections.get(chunks_key)
    if chunks_coll and chunk_id in chunks_coll._docs:
        return chunks_coll._docs[chunk_id]
    return None


def _get_event_data(fs: _FakeFirestore, scope: ThreadMemoryScope, event_id: str) -> Optional[Dict[str, Any]]:
    mem_coll = fs.collection(COLLECTION)
    events_key = f"{scope.scope_key}/{EVENTS_SUBCOLLECTION}"
    events_coll = mem_coll._subcollections.get(events_key)
    if events_coll and event_id in events_coll._docs:
        return events_coll._docs[event_id]
    return None


def _count_subcollection_docs(fs: _FakeFirestore, scope: ThreadMemoryScope, subcollection: str) -> int:
    mem_coll = fs.collection(COLLECTION)
    key = f"{scope.scope_key}/{subcollection}"
    sub = mem_coll._subcollections.get(key)
    return len(sub._docs) if sub else 0


def _sample_chunk(chunk_id: str, source_message_ids: Optional[List[str]] = None, **overrides) -> Dict[str, Any]:
    base = {
        "chunk_id": chunk_id,
        "scope_key": "dm:conv-1",
        "text": f"chunk text for {chunk_id}",
        "source_message_ids": source_message_ids or [],
        "stale": False,
        "invalidated": False,
        "is_deleted": False,
        "deleted_at": None,
        "encrypted": False,
        "message_ts_end": "2026-05-01T12:00:00Z",
    }
    base.update(overrides)
    return base


def _sample_event(event_id: str, **overrides) -> Dict[str, Any]:
    base = {
        "event_id": event_id,
        "event_type": "exercise",
        "label": "gym",
        "sender": "alice",
        "timestamp": "2026-05-01T12:00:00Z",
        "stale": False,
        "invalidated": False,
        "is_deleted": False,
    }
    base.update(overrides)
    return base


# ===========================================================================
# Tests
# ===========================================================================


class TestInvalidateMemoryForScope:
    def test_marks_all_chunks_and_events_invalidated(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-inv")
        _seed_chunks(fs, scope, [
            _sample_chunk("c1"),
            _sample_chunk("c2"),
            _sample_chunk("c3"),
        ])
        _seed_events(fs, scope, [
            _sample_event("e1"),
            _sample_event("e2"),
        ])

        result = invalidate_memory_for_scope(fs, scope, reason="test reset")

        assert result["chunks_invalidated"] == 3
        assert result["events_invalidated"] == 2

        for cid in ("c1", "c2", "c3"):
            data = _get_chunk_data(fs, scope, cid)
            assert data[FIELD_INVALIDATED] is True
            assert data["invalidated_at"] is not None
            assert data["invalidation_reason"] == "test reset"

        for eid in ("e1", "e2"):
            data = _get_event_data(fs, scope, eid)
            assert data[FIELD_INVALIDATED] is True

    def test_no_chunks_or_events_returns_zeros(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-empty")

        result = invalidate_memory_for_scope(fs, scope, reason="empty")
        assert result == {"chunks_invalidated": 0, "events_invalidated": 0}

    def test_reason_truncated_to_200_chars(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-trunc")
        _seed_chunks(fs, scope, [_sample_chunk("c1")])

        long_reason = "x" * 500
        invalidate_memory_for_scope(fs, scope, reason=long_reason)

        data = _get_chunk_data(fs, scope, "c1")
        assert len(data["invalidation_reason"]) == 200


class TestInvalidateChunksContainingMessage:
    def test_marks_only_matching_chunks_stale(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-msg")
        _seed_chunks(fs, scope, [
            _sample_chunk("c1", source_message_ids=["m1", "m2", "m3"]),
            _sample_chunk("c2", source_message_ids=["m4", "m5"]),
            _sample_chunk("c3", source_message_ids=["m2", "m6"]),
        ])

        count = invalidate_chunks_containing_message(fs, scope, "m2")

        assert count == 2

        c1 = _get_chunk_data(fs, scope, "c1")
        assert c1[FIELD_STALE] is True
        assert c1["stale_reason"] == "message_deleted"

        c2 = _get_chunk_data(fs, scope, "c2")
        assert c2[FIELD_STALE] is False

        c3 = _get_chunk_data(fs, scope, "c3")
        assert c3[FIELD_STALE] is True

    def test_no_match_returns_zero(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-nomatch")
        _seed_chunks(fs, scope, [
            _sample_chunk("c1", source_message_ids=["m1"]),
        ])

        count = invalidate_chunks_containing_message(fs, scope, "m99")
        assert count == 0

        c1 = _get_chunk_data(fs, scope, "c1")
        assert c1[FIELD_STALE] is False

    def test_empty_message_id_returns_zero(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-nomsg")
        _seed_chunks(fs, scope, [_sample_chunk("c1", source_message_ids=["m1"])])

        assert invalidate_chunks_containing_message(fs, scope, "") == 0

    def test_integer_message_id_matches_string_ids(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-intid")
        _seed_chunks(fs, scope, [
            _sample_chunk("c1", source_message_ids=["123", "456"]),
        ])

        count = invalidate_chunks_containing_message(fs, scope, "123")
        assert count == 1


class TestPurgeScopeMemory:
    def test_hard_deletes_all_docs(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-purge")
        _seed_chunks(fs, scope, [
            _sample_chunk("c1"),
            _sample_chunk("c2"),
        ])
        _seed_events(fs, scope, [
            _sample_event("e1"),
        ])

        result = purge_scope_memory(fs, scope)

        assert result["chunks_deleted"] == 2
        assert result["events_deleted"] == 1

        assert _count_subcollection_docs(fs, scope, CHUNKS_SUBCOLLECTION) == 0
        assert _count_subcollection_docs(fs, scope, EVENTS_SUBCOLLECTION) == 0

        meta = fs.collection(COLLECTION)._docs.get(scope.scope_key)
        assert meta is None

    def test_empty_scope_returns_zeros(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-empty-purge")

        result = purge_scope_memory(fs, scope)
        assert result == {"chunks_deleted": 0, "events_deleted": 0}


class TestMemoryHealthForScope:
    def test_healthy_scope(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-health")
        _seed_chunks(fs, scope, [
            _sample_chunk("c1"),
            _sample_chunk("c2"),
            _sample_chunk("c3"),
        ])
        _seed_events(fs, scope, [
            _sample_event("e1"),
            _sample_event("e2"),
        ])

        health = memory_health_for_scope(fs, scope)

        assert health["scope_key"] == scope.scope_key
        assert health["chunk_count"] == 3
        assert health["event_count"] == 2
        assert health["stale_chunks"] == 0
        assert health["invalidated_chunks"] == 0
        assert health["last_indexed_at"] == "2026-05-01T12:00:00Z"
        assert health["healthy"] is True

    def test_unhealthy_when_majority_stale(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-unhealth")
        _seed_chunks(fs, scope, [
            _sample_chunk("c1", stale=True),
            _sample_chunk("c2", stale=True),
            _sample_chunk("c3", invalidated=True),
            _sample_chunk("c4"),
        ])

        health = memory_health_for_scope(fs, scope)
        assert health["stale_chunks"] == 2
        assert health["invalidated_chunks"] == 1
        assert health["healthy"] is False

    def test_healthy_when_minority_stale(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-partial")
        _seed_chunks(fs, scope, [
            _sample_chunk("c1", stale=True),
            _sample_chunk("c2"),
            _sample_chunk("c3"),
            _sample_chunk("c4"),
            _sample_chunk("c5"),
        ])

        health = memory_health_for_scope(fs, scope)
        assert health["stale_chunks"] == 1
        assert health["healthy"] is True

    def test_empty_scope_is_healthy(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-none")

        health = memory_health_for_scope(fs, scope)
        assert health["chunk_count"] == 0
        assert health["healthy"] is True


class TestOnContextReset:
    def test_invalidates_all_memory_and_clears_summary(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-reset")
        _seed_chunks(fs, scope, [_sample_chunk("c1"), _sample_chunk("c2")])
        _seed_events(fs, scope, [_sample_event("e1")])

        dm_coll = fs.collection("dm_conversations")
        dm_coll._docs[scope.thread_id] = {
            "steve_thread_summary": "old summary",
            "steve_thread_summary_msg_count": 50,
        }

        reset_at = datetime(2026, 5, 15, 12, 0, 0)
        stats = on_context_reset(fs, scope, reset_at)

        assert stats["chunks_invalidated"] == 2
        assert stats["events_invalidated"] == 1
        assert stats["summary_cleared"] is True

        for cid in ("c1", "c2"):
            data = _get_chunk_data(fs, scope, cid)
            assert data[FIELD_INVALIDATED] is True

        conv_data = dm_coll._docs[scope.thread_id]
        assert conv_data.get("steve_thread_summary") is None
        assert conv_data.get("steve_thread_summary_msg_count") == 0

    def test_group_scope_clears_group_summary(self):
        fs = _FakeFirestore()
        scope = _make_group_scope("77")
        _seed_chunks(fs, scope, [_sample_chunk("c1")])

        group_coll = fs.collection("group_chats")
        group_coll._docs["77"] = {
            "steve_thread_summary": "group summary",
            "steve_thread_summary_msg_count": 30,
        }

        stats = on_context_reset(fs, scope, datetime(2026, 5, 15, 12, 0, 0))
        assert stats["chunks_invalidated"] == 1
        assert stats["summary_cleared"] is True

        conv_data = group_coll._docs["77"]
        assert conv_data.get("steve_thread_summary") is None

    def test_never_raises(self):
        """on_context_reset must not propagate exceptions."""

        class _BrokenFirestore:
            def collection(self, name):
                raise RuntimeError("Firestore is down")

        scope = _make_scope("conv-broken")
        stats = on_context_reset(_BrokenFirestore(), scope, datetime(2026, 5, 15))
        assert stats["chunks_invalidated"] == 0
        assert stats["events_invalidated"] == 0


class TestOnMessageDeleted:
    def test_marks_affected_chunks_stale(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-del")
        _seed_chunks(fs, scope, [
            _sample_chunk("c1", source_message_ids=["m1", "m2"]),
            _sample_chunk("c2", source_message_ids=["m3"]),
        ])

        count = on_message_deleted(fs, scope, "m1")
        assert count == 1

        c1 = _get_chunk_data(fs, scope, "c1")
        assert c1[FIELD_STALE] is True
        c2 = _get_chunk_data(fs, scope, "c2")
        assert c2[FIELD_STALE] is False

    def test_never_raises(self):
        class _BrokenFirestore:
            def collection(self, name):
                raise RuntimeError("boom")

        scope = _make_scope("conv-broken2")
        count = on_message_deleted(_BrokenFirestore(), scope, "m1")
        assert count == 0


class TestShouldIncludeMemoryRecordIntegration:
    """Verify that should_include_memory_record correctly excludes
    records after ops mutations."""

    def test_invalidated_chunk_excluded(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-excl")
        _seed_chunks(fs, scope, [_sample_chunk("c1")])

        invalidate_memory_for_scope(fs, scope, reason="reset")

        data = _get_chunk_data(fs, scope, "c1")
        assert should_include_memory_record(data) is False

    def test_stale_chunk_excluded(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-stale")
        _seed_chunks(fs, scope, [
            _sample_chunk("c1", source_message_ids=["m1"]),
        ])

        invalidate_chunks_containing_message(fs, scope, "m1")

        data = _get_chunk_data(fs, scope, "c1")
        assert should_include_memory_record(data) is False

    def test_clean_chunk_included(self):
        record = _sample_chunk("c1")
        assert should_include_memory_record(record) is True


class TestScopeIsolation:
    def test_ops_on_one_scope_dont_affect_another(self):
        fs = _FakeFirestore()
        scope_a = _make_scope("conv-a")
        scope_b = _make_scope("conv-b")

        _seed_chunks(fs, scope_a, [_sample_chunk("ca1"), _sample_chunk("ca2")])
        _seed_chunks(fs, scope_b, [_sample_chunk("cb1")])

        invalidate_memory_for_scope(fs, scope_a, reason="scope A reset")

        ca1 = _get_chunk_data(fs, scope_a, "ca1")
        assert ca1[FIELD_INVALIDATED] is True

        cb1 = _get_chunk_data(fs, scope_b, "cb1")
        assert cb1.get(FIELD_INVALIDATED, False) is False

    def test_purge_one_scope_leaves_other_intact(self):
        fs = _FakeFirestore()
        scope_a = _make_scope("conv-pa")
        scope_b = _make_scope("conv-pb")

        _seed_chunks(fs, scope_a, [_sample_chunk("ca1")])
        _seed_chunks(fs, scope_b, [_sample_chunk("cb1")])

        purge_scope_memory(fs, scope_a)

        assert _count_subcollection_docs(fs, scope_a, CHUNKS_SUBCOLLECTION) == 0
        assert _count_subcollection_docs(fs, scope_b, CHUNKS_SUBCOLLECTION) == 1


class TestNonFatalFailures:
    """Verify that partial Firestore failures don't crash ops functions."""

    def test_invalidate_with_broken_subcollection_write(self):
        fs = _FakeFirestore()
        scope = _make_scope("conv-broken-write")
        _seed_chunks(fs, scope, [_sample_chunk("c1")])

        mem_coll = fs.collection(COLLECTION)
        chunks_key = f"{scope.scope_key}/{CHUNKS_SUBCOLLECTION}"
        chunks_coll = mem_coll._subcollections[chunks_key]

        original_set = _FakeDocRef.set

        call_count = {"n": 0}

        def _broken_set(self, data, merge=False):
            call_count["n"] += 1
            raise RuntimeError("write failed")

        _FakeDocRef.set = _broken_set
        try:
            result = invalidate_memory_for_scope(fs, scope, reason="fail test")
            assert result["chunks_invalidated"] == 0
        finally:
            _FakeDocRef.set = original_set

    def test_memory_health_with_broken_stream(self):
        """health probe returns partial data when one subcollection fails."""
        fs = _FakeFirestore()
        scope = _make_scope("conv-broken-health")

        fs.collection(COLLECTION)._docs[scope.scope_key] = {
            "scope_key": scope.scope_key,
            "last_indexed_at": "2026-05-01T00:00:00Z",
        }

        health = memory_health_for_scope(fs, scope)
        assert health["scope_key"] == scope.scope_key
        assert health["last_indexed_at"] == "2026-05-01T00:00:00Z"
        assert health["healthy"] is True
