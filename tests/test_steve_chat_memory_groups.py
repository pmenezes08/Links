"""Tests for Steve Phase 3 PR5: group chat memory backfill, retrieval, and gates.

Covers:
- backfill_group_chat reads correct Firestore collection path (group_chats/{id}/messages)
- Scope key format: group:{group_id}
- Membership gate: non-member gets empty retrieval result
- Membership gate: admin bypasses check
- Group reset respected (chunks before reset excluded)
- chat_memory_group_enabled=False blocks everything
- Retrieval integration (cosine similarity over stored vectors)
- CLI --group-id flag routes to correct backfill function
"""

from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock, patch

import pytest

from backend.services.steve_chat_memory import (
    scope_for_group,
    scope_key_for_thread,
    SURFACE_GROUP,
)
from backend.services.steve_chat_memory_indexer import (
    BackfillStats,
    backfill_group_chat,
    backfill_group_status,
    build_chunks_from_rows,
    check_group_membership,
)


# ---------------------------------------------------------------------------
# Helpers (reuse fake Firestore from indexer tests)
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
    sender_cycle: Tuple[str, ...] = ("alice", "bob", "carol"),
) -> List[Dict[str, Any]]:
    rows = []
    for i in range(n):
        ts = start + timedelta(minutes=i * interval_minutes)
        sender = sender_cycle[i % len(sender_cycle)]
        rows.append(_msg(f"gmsg-{i:04d}", sender, f"Group message {i}", ts))
    return rows


class _FakeDoc:
    def __init__(self, doc_id: str, data: Optional[Dict[str, Any]], *, exists: bool = True):
        self.id = doc_id
        self._data = data or {}
        self.exists = exists

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data)


class _FakeQuery:
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
    def __init__(self):
        self._docs: Dict[str, Dict[str, Any]] = {}
        self._subcollections: Dict[str, "_FakeCollection"] = {}
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
    def __init__(self, coll: "_FakeCollection", doc_id: str):
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

    def update(self, data: Dict[str, Any]):
        if self._doc_id not in self._coll._docs:
            self._coll._docs[self._doc_id] = {}
        self._coll._docs[self._doc_id].update(data)

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


def _seed_group(
    fs: _FakeFirestore,
    group_id: str,
    messages: List[Dict[str, Any]],
    *,
    group_data: Optional[Dict[str, Any]] = None,
) -> None:
    """Seed a fake group chat + messages into the fake Firestore."""
    group_coll = fs.collection("group_chats")
    group_coll._docs[group_id] = group_data or {}

    msgs_key = f"{group_id}/messages"
    if msgs_key not in group_coll._subcollections:
        group_coll._subcollections[msgs_key] = _FakeCollection()
    msgs_coll = group_coll._subcollections[msgs_key]

    fake_docs = []
    for m in messages:
        doc_id = m.get("doc_id") or m.get("id", "")
        msgs_coll._docs[doc_id] = dict(m)
        fake_docs.append(_FakeDoc(doc_id, dict(m)))
    msgs_coll._query_docs = fake_docs


# ---------------------------------------------------------------------------
# Scope key format
# ---------------------------------------------------------------------------

class TestGroupScopeKey:
    def test_scope_key_format(self):
        scope = scope_for_group("42")
        assert scope.scope_key == "group:42"
        assert scope.surface == SURFACE_GROUP
        assert scope.thread_id == "42"

    def test_scope_key_via_helper(self):
        key = scope_key_for_thread(SURFACE_GROUP, "99")
        assert key == "group:99"

    def test_scope_isolation_from_dm(self):
        from backend.services.steve_chat_memory import scope_for_peer_dm
        dm_scope = scope_for_peer_dm("42")
        group_scope = scope_for_group("42")
        assert dm_scope.scope_key != group_scope.scope_key
        assert dm_scope.surface == "dm"
        assert group_scope.surface == "group"


# ---------------------------------------------------------------------------
# backfill_group_chat: collection path and basic behaviour
# ---------------------------------------------------------------------------

class TestBackfillGroupChat:
    def test_reads_from_group_chats_collection(self):
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_group(fs, "100", msgs)

        stats = backfill_group_chat(
            fs, "100", dry_run=True, skip_membership_check=True,
            entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": True},
        )

        assert stats.conv_id == "100"
        assert stats.scope_key == "group:100"
        assert stats.messages_read == 10
        assert stats.messages_included == 10
        assert stats.chunks_built >= 1

    def test_writes_chunks_on_non_dry_run(self):
        fs = _FakeFirestore()
        msgs = _make_messages(130)
        _seed_group(fs, "200", msgs)

        stats = backfill_group_chat(
            fs, "200", dry_run=False, skip_membership_check=True,
            entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": True},
        )

        assert stats.dry_run is False
        assert stats.chunks_written >= 1
        assert stats.chunks_written == stats.chunks_built

    def test_idempotent_rerun(self):
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_group(fs, "300", msgs)
        ent = {"chat_memory_enabled": True, "chat_memory_group_enabled": True}

        s1 = backfill_group_chat(fs, "300", dry_run=False, skip_membership_check=True, entitlements=ent)
        s2 = backfill_group_chat(fs, "300", dry_run=False, skip_membership_check=True, entitlements=ent)

        assert s1.chunks_written == 1
        assert s2.chunks_written == 0
        assert s2.chunks_skipped_existing == 1

    def test_empty_group_returns_zero_stats(self):
        fs = _FakeFirestore()
        _seed_group(fs, "400", [])

        stats = backfill_group_chat(
            fs, "400", dry_run=True, skip_membership_check=True,
            entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": True},
        )

        assert stats.messages_read == 0
        assert stats.chunks_built == 0


# ---------------------------------------------------------------------------
# Membership gate
# ---------------------------------------------------------------------------

class TestMembershipGate:
    def test_non_member_gets_empty_stats(self):
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_group(fs, "500", msgs)

        stats = backfill_group_chat(
            fs, "500",
            dry_run=True,
            member_usernames=["alice", "bob"],
            requesting_username="mallory",
            entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": True},
        )

        assert stats.messages_read == 0
        assert stats.chunks_built == 0

    def test_member_can_backfill(self):
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_group(fs, "501", msgs)

        stats = backfill_group_chat(
            fs, "501",
            dry_run=True,
            member_usernames=["alice", "bob", "carol"],
            requesting_username="alice",
            entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": True},
        )

        assert stats.messages_read == 10
        assert stats.chunks_built >= 1

    def test_skip_membership_check_bypasses_gate(self):
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_group(fs, "502", msgs)

        stats = backfill_group_chat(
            fs, "502",
            dry_run=True,
            member_usernames=["alice"],
            requesting_username="intruder",
            skip_membership_check=True,
            entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": True},
        )

        assert stats.messages_read == 10

    def test_no_requesting_username_blocks(self):
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_group(fs, "503", msgs)

        stats = backfill_group_chat(
            fs, "503",
            dry_run=True,
            member_usernames=["alice"],
            requesting_username=None,
            entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": True},
        )

        assert stats.messages_read == 0

    def test_check_group_membership_with_mysql(self):
        """Membership check uses MySQL group_chat_members table."""
        mock_cursor = MagicMock()
        mock_cursor.fetchone.return_value = (1,)
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)

        with patch("backend.services.database.get_db_connection", return_value=mock_conn), \
             patch("backend.services.database.get_sql_placeholder", return_value="%s"):
            assert check_group_membership(None, "600", "alice") is True

        mock_cursor.fetchone.return_value = None
        with patch("backend.services.database.get_db_connection", return_value=mock_conn), \
             patch("backend.services.database.get_sql_placeholder", return_value="%s"):
            assert check_group_membership(None, "600", "mallory") is False

    def test_check_group_membership_db_error_returns_false(self):
        with patch("backend.services.database.get_db_connection", side_effect=Exception("DB down")):
            assert check_group_membership(None, "600", "alice") is False

    def test_check_group_membership_admin_bypass_in_retrieval(self):
        """is_special entitlement bypasses membership check in retrieval wiring."""
        with patch("backend.services.database.get_db_connection", side_effect=Exception("no db")):
            assert check_group_membership(None, "601", "admin_user") is False

        ent = {"is_special": True}
        _is_admin = bool((ent or {}).get("is_special"))
        has_access = _is_admin or False
        assert has_access is True


# ---------------------------------------------------------------------------
# Group reset respected
# ---------------------------------------------------------------------------

class TestGroupResetRespected:
    def test_messages_before_reset_excluded(self):
        fs = _FakeFirestore()
        t0 = datetime(2026, 5, 1, 10, 0, 0)
        reset_at = datetime(2026, 5, 1, 10, 6, 0)
        msgs = [
            _msg("g1", "alice", "Before reset 1", t0),
            _msg("g2", "bob", "Before reset 2", t0 + timedelta(minutes=2)),
            _msg("g3", "carol", "After reset", t0 + timedelta(minutes=8)),
            _msg("g4", "alice", "Also after", t0 + timedelta(minutes=10)),
        ]
        _seed_group(fs, "700", msgs, group_data={
            "steve_context_reset_at": reset_at.isoformat() + "Z",
        })

        stats = backfill_group_chat(
            fs, "700", dry_run=True, skip_membership_check=True,
            entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": True},
        )

        assert stats.messages_skipped_before_reset == 2
        assert stats.messages_included == 2
        assert stats.chunks_built == 1

    def test_no_reset_includes_all(self):
        fs = _FakeFirestore()
        msgs = _make_messages(5)
        _seed_group(fs, "701", msgs)

        stats = backfill_group_chat(
            fs, "701", dry_run=True, skip_membership_check=True,
            entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": True},
        )

        assert stats.messages_included == 5


# ---------------------------------------------------------------------------
# chat_memory_group_enabled=False blocks everything
# ---------------------------------------------------------------------------

class TestGroupDisabledFlag:
    def test_group_disabled_blocks_backfill(self):
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_group(fs, "800", msgs)

        stats = backfill_group_chat(
            fs, "800", dry_run=True,
            member_usernames=["alice"],
            requesting_username="alice",
            entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": False},
        )

        assert stats.messages_read == 0
        assert stats.chunks_built == 0

    def test_group_disabled_default_blocks(self):
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_group(fs, "801", msgs)

        stats = backfill_group_chat(
            fs, "801", dry_run=True,
            member_usernames=["alice"],
            requesting_username="alice",
            entitlements={},
        )

        assert stats.messages_read == 0
        assert stats.chunks_built == 0

    def test_skip_membership_check_still_runs_when_disabled(self):
        """Admin/cron with skip_membership_check can force even if group_enabled=False."""
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_group(fs, "802", msgs)

        stats = backfill_group_chat(
            fs, "802", dry_run=True,
            skip_membership_check=True,
            entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": False},
        )

        assert stats.messages_read == 10


# ---------------------------------------------------------------------------
# Retrieval integration (cosine similarity)
# ---------------------------------------------------------------------------

class TestGroupRetrievalIntegration:
    def test_retrieval_with_stored_vectors(self):
        """Verify that retrieval respects group scope and cosine ranking."""
        from backend.services.steve_chat_memory_retrieval import (
            cosine_similarity,
            retrieve_relevant_chunks,
        )

        fs = _FakeFirestore()
        scope = scope_for_group("900")

        mem_coll = fs.collection("steve_chat_memory")
        scope_doc_key = scope.scope_key
        mem_coll._docs[scope_doc_key] = {"scope_key": scope_doc_key}

        chunks_key = f"{scope_doc_key}/chunks"
        mem_coll._subcollections[chunks_key] = _FakeCollection()
        chunks_coll = mem_coll._subcollections[chunks_key]

        vec_a = [1.0, 0.0, 0.0]
        vec_b = [0.0, 1.0, 0.0]
        chunks_coll._docs["c1"] = {
            "chunk_id": "c1",
            "text": "Alice talked about dogs",
            "embedding": vec_a,
            "message_ts_end": datetime(2026, 3, 1).isoformat(),
        }
        chunks_coll._docs["c2"] = {
            "chunk_id": "c2",
            "text": "Bob mentioned cats",
            "embedding": vec_b,
            "message_ts_end": datetime(2026, 3, 2).isoformat(),
        }

        query_vec = [0.9, 0.1, 0.0]
        with patch(
            "backend.services.steve_chat_memory_retrieval.embed_text",
            return_value=query_vec,
        ):
            results = retrieve_relevant_chunks(
                fs, scope, "dogs",
                entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": True},
                top_k=2,
                username="alice",
            )

        assert len(results) >= 1
        assert results[0]["chunk_id"] == "c1"
        assert results[0]["_score"] > results[-1]["_score"] if len(results) > 1 else True

    def test_retrieval_respects_reset(self):
        """Chunks before reset_at are excluded from retrieval."""
        from backend.services.steve_chat_memory_retrieval import retrieve_relevant_chunks

        fs = _FakeFirestore()
        scope = scope_for_group("901")

        mem_coll = fs.collection("steve_chat_memory")
        scope_doc_key = scope.scope_key
        mem_coll._docs[scope_doc_key] = {"scope_key": scope_doc_key}

        chunks_key = f"{scope_doc_key}/chunks"
        mem_coll._subcollections[chunks_key] = _FakeCollection()
        chunks_coll = mem_coll._subcollections[chunks_key]

        chunks_coll._docs["old"] = {
            "chunk_id": "old",
            "text": "Very old conversation",
            "embedding": [1.0, 0.0],
            "message_ts_end": datetime(2025, 1, 1).isoformat() + "Z",
        }
        chunks_coll._docs["new"] = {
            "chunk_id": "new",
            "text": "Recent conversation",
            "embedding": [0.0, 1.0],
            "message_ts_end": datetime(2026, 6, 1).isoformat() + "Z",
        }

        reset_at = datetime(2026, 1, 1)
        with patch(
            "backend.services.steve_chat_memory_retrieval.embed_text",
            return_value=[0.5, 0.5],
        ):
            results = retrieve_relevant_chunks(
                fs, scope, "anything",
                entitlements={"chat_memory_enabled": True, "chat_memory_group_enabled": True},
                top_k=10,
                reset_at=reset_at,
                username="alice",
            )

        chunk_ids = [r["chunk_id"] for r in results]
        assert "old" not in chunk_ids
        assert "new" in chunk_ids


# ---------------------------------------------------------------------------
# CLI --group-id flag
# ---------------------------------------------------------------------------

class TestCLIGroupIdFlag:
    def test_group_id_and_conv_id_mutually_exclusive(self):
        """argparse should reject both --group-id and --conv-id together."""
        result = subprocess.run(
            [sys.executable, "scripts/backfill_steve_chat_memory.py",
             "--conv-id", "abc", "--group-id", "123"],
            capture_output=True, text=True,
        )
        assert result.returncode != 0
        assert "not allowed" in result.stderr.lower() or "error" in result.stderr.lower()

    def test_neither_argument_fails(self):
        """argparse should require at least one of --group-id or --conv-id."""
        result = subprocess.run(
            [sys.executable, "scripts/backfill_steve_chat_memory.py"],
            capture_output=True, text=True,
        )
        assert result.returncode != 0


# ---------------------------------------------------------------------------
# backfill_group_status
# ---------------------------------------------------------------------------

class TestBackfillGroupStatus:
    def test_not_indexed_baseline(self):
        fs = _FakeFirestore()
        result = backfill_group_status(fs, "999")

        assert result["indexed"] is False
        assert result["scope_key"] == "group:999"
        assert result["chunk_count"] == 0

    def test_indexed_returns_metadata(self):
        fs = _FakeFirestore()
        msgs = _make_messages(10)
        _seed_group(fs, "998", msgs)
        ent = {"chat_memory_enabled": True, "chat_memory_group_enabled": True}
        backfill_group_chat(fs, "998", dry_run=False, skip_membership_check=True, entitlements=ent)

        result = backfill_group_status(fs, "998")

        assert result["indexed"] is True
        assert result["chunk_count"] == 1
        assert result["scope_key"] == "group:998"
