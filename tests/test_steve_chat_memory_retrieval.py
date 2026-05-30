"""Tests for steve_chat_memory_retrieval — Phase 3 PR3.

Covers:
- Cosine similarity ranking returns correct order.
- should_include_memory_record filtering applied during retrieval.
- Reset-at filtering excludes old chunks.
- Retrieval returns empty when chat_memory_peer_dm_enabled=False.
- Retrieval returns empty when no chunks exist.
- inject_chat_memory_into_context formats via format_relevant_older_memory.
- Intent routing: recall phrases trigger retrieval, casual messages skip.
- Embedding call logs exactly one ai_usage row.
- Retrieval-only reads (no embedding needed) do NOT log usage.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest

from backend.services.steve_chat_memory import (
    CHUNKS_SUBCOLLECTION,
    COLLECTION,
    ThreadMemoryScope,
    scope_for_peer_dm,
)
from backend.services.steve_chat_memory_retrieval import (
    DEFAULT_EMBEDDING_MODEL,
    RECALL_INTENT_PATTERNS,
    REQUEST_TYPE_EMBED,
    SURFACE_DM,
    cosine_similarity,
    embed_text,
    has_recall_intent,
    inject_chat_memory_into_context,
    retrieve_relevant_chunks,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_scope(conv_id: str = "conv123") -> ThreadMemoryScope:
    return scope_for_peer_dm(conv_id)


def _make_chunk(
    chunk_id: str,
    text: str,
    embedding: List[float],
    *,
    stale: bool = False,
    invalidated: bool = False,
    is_deleted: bool = False,
    deleted_at: Any = None,
    encrypted: bool = False,
    message_ts_end: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "chunk_id": chunk_id,
        "text": text,
        "embedding": embedding,
        "stale": stale,
        "invalidated": invalidated,
        "is_deleted": is_deleted,
        "deleted_at": deleted_at,
        "encrypted": encrypted,
        "message_ts_end": message_ts_end or "2025-06-01T10:00:00Z",
        "senders": {"alice": 3, "bob": 2},
    }


def _unit_vector(dim: int, index: int) -> List[float]:
    """Create a unit vector with 1.0 at the given index."""
    v = [0.0] * dim
    v[index] = 1.0
    return v


class FakeFirestoreDoc:
    def __init__(self, doc_id: str, data: Dict[str, Any]):
        self.id = doc_id
        self._data = data
        self.exists = True

    def to_dict(self):
        return dict(self._data)


class FakeCollection:
    def __init__(self, docs: List[FakeFirestoreDoc]):
        self._docs = docs

    def stream(self):
        return iter(self._docs)


class FakeDocRef:
    def __init__(self, docs: List[FakeFirestoreDoc]):
        self._docs = docs

    def collection(self, name: str):
        return FakeCollection(self._docs)


class FakeCollectionRef:
    def __init__(self, docs: List[FakeFirestoreDoc]):
        self._docs = docs

    def document(self, doc_id: str):
        return FakeDocRef(self._docs)


class FakeFirestoreClient:
    def __init__(self, chunks: List[Dict[str, Any]]):
        self._chunks = [
            FakeFirestoreDoc(c.get("chunk_id", f"c{i}"), c)
            for i, c in enumerate(chunks)
        ]

    def collection(self, name: str):
        return FakeCollectionRef(self._chunks)


# ---------------------------------------------------------------------------
# Tests: cosine_similarity
# ---------------------------------------------------------------------------


class TestCosineSimilarity:
    def test_identical_vectors(self):
        v = [1.0, 2.0, 3.0]
        assert cosine_similarity(v, v) == pytest.approx(1.0, abs=1e-6)

    def test_orthogonal_vectors(self):
        a = [1.0, 0.0, 0.0]
        b = [0.0, 1.0, 0.0]
        assert cosine_similarity(a, b) == pytest.approx(0.0, abs=1e-6)

    def test_opposite_vectors(self):
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert cosine_similarity(a, b) == pytest.approx(-1.0, abs=1e-6)

    def test_empty_vectors(self):
        assert cosine_similarity([], []) == 0.0

    def test_mismatched_length(self):
        assert cosine_similarity([1.0, 2.0], [1.0]) == 0.0

    def test_zero_vector(self):
        assert cosine_similarity([0.0, 0.0], [1.0, 2.0]) == 0.0

    def test_ranking_order(self):
        """Verify that more similar vectors get higher scores."""
        query = [1.0, 0.0, 0.0]
        close = [0.9, 0.1, 0.0]
        far = [0.1, 0.9, 0.0]
        assert cosine_similarity(query, close) > cosine_similarity(query, far)


# ---------------------------------------------------------------------------
# Tests: has_recall_intent
# ---------------------------------------------------------------------------


class TestHasRecallIntent:
    @pytest.mark.parametrize(
        "msg",
        [
            "when did we last talk about the project?",
            "what did Alice say yesterday?",
            "do you remember the meeting?",
            "find the message about deadlines",
            "what was the conclusion?",
            "last time we discussed this",
            "she mentioned something about Paris",
            "we talked about budgets earlier",
            "previously you told me the date",
            "you told me about the trip",
            "i told you about the dentist",
            "back when we planned the party",
            "what happened with the delivery?",
            "where did Bob go?",
            "who said that thing about cats?",
            "how many times did we mention lunch?",
            "we discussed the pricing",
            "earlier you said 50%",
            "what about that plan?",
        ],
    )
    def test_recall_phrases_detected(self, msg):
        assert has_recall_intent(msg) is True

    @pytest.mark.parametrize(
        "msg",
        [
            "hello Steve",
            "how are you?",
            "what's the weather today?",
            "tell me a joke",
            "thanks for helping",
            "ok sounds good",
            "",
        ],
    )
    def test_casual_messages_not_detected(self, msg):
        assert has_recall_intent(msg) is False


# ---------------------------------------------------------------------------
# Tests: embed_text
# ---------------------------------------------------------------------------


class TestEmbedText:
    @patch("backend.services.steve_chat_memory_retrieval.ai_usage.log_usage")
    @patch("openai.OpenAI")
    @patch.dict("os.environ", {"XAI_API_KEY": "test-key"})
    def test_logs_exactly_one_usage_row_on_success(self, mock_openai_cls, mock_log_usage):
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client

        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1, 0.2, 0.3])]
        mock_response.usage.total_tokens = 10
        mock_client.embeddings.create.return_value = mock_response

        result = embed_text("hello world", "text-embedding-3-small", username="alice")

        assert result == [0.1, 0.2, 0.3]
        assert mock_log_usage.call_count == 1
        call_kwargs = mock_log_usage.call_args
        assert call_kwargs[0][0] == "alice"
        assert call_kwargs[1]["surface"] == SURFACE_DM
        assert call_kwargs[1]["request_type"] == REQUEST_TYPE_EMBED
        assert call_kwargs[1]["model"] == "text-embedding-3-small"

    @patch("backend.services.steve_chat_memory_retrieval.ai_usage.log_usage")
    @patch("openai.OpenAI")
    @patch.dict("os.environ", {"XAI_API_KEY": "test-key"})
    def test_logs_usage_row_on_failure(self, mock_openai_cls, mock_log_usage):
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_client.embeddings.create.side_effect = RuntimeError("API error")

        with pytest.raises(RuntimeError, match="API error"):
            embed_text("hello", "text-embedding-3-small", username="bob")

        assert mock_log_usage.call_count == 1
        call_kwargs = mock_log_usage.call_args
        assert call_kwargs[1]["success"] is False

    @patch.dict("os.environ", {}, clear=True)
    def test_raises_without_api_key(self):
        with pytest.raises(RuntimeError, match="No embedding API key"):
            embed_text("test", "text-embedding-3-small")


# ---------------------------------------------------------------------------
# Tests: retrieve_relevant_chunks
# ---------------------------------------------------------------------------


class TestRetrieveRelevantChunks:
    def _enabled_entitlements(self, **overrides) -> Dict[str, Any]:
        base = {
            "chat_memory_enabled": True,
            "chat_memory_peer_dm_enabled": True,
            "chat_memory_top_k": 4,
            "chat_memory_max_prompt_chars": 5000,
            "chat_memory_embedding_model": "text-embedding-3-small",
        }
        base.update(overrides)
        return base

    @patch("backend.services.steve_chat_memory_retrieval.embed_text")
    def test_returns_chunks_ranked_by_similarity(self, mock_embed):
        query_vec = [1.0, 0.0, 0.0]
        mock_embed.return_value = query_vec

        chunk_a = _make_chunk("a", "topic A", [0.9, 0.1, 0.0])
        chunk_b = _make_chunk("b", "topic B", [0.1, 0.9, 0.0])
        chunk_c = _make_chunk("c", "topic C", [0.8, 0.2, 0.0])

        fs = FakeFirestoreClient([chunk_a, chunk_b, chunk_c])
        scope = _make_scope()

        results = retrieve_relevant_chunks(
            fs, scope, "query", entitlements=self._enabled_entitlements()
        )

        assert len(results) >= 2
        assert results[0]["chunk_id"] == "a"
        assert results[1]["chunk_id"] == "c"

    @patch("backend.services.steve_chat_memory_retrieval.embed_text")
    def test_filters_stale_chunks(self, mock_embed):
        mock_embed.return_value = [1.0, 0.0]

        chunk_ok = _make_chunk("ok", "good text", [1.0, 0.0])
        chunk_stale = _make_chunk("stale", "stale text", [0.9, 0.1], stale=True)

        fs = FakeFirestoreClient([chunk_ok, chunk_stale])
        scope = _make_scope()

        results = retrieve_relevant_chunks(
            fs, scope, "query", entitlements=self._enabled_entitlements()
        )

        chunk_ids = [r["chunk_id"] for r in results]
        assert "ok" in chunk_ids
        assert "stale" not in chunk_ids

    @patch("backend.services.steve_chat_memory_retrieval.embed_text")
    def test_filters_deleted_chunks(self, mock_embed):
        mock_embed.return_value = [1.0, 0.0]

        chunk_ok = _make_chunk("ok", "good text", [1.0, 0.0])
        chunk_del = _make_chunk("del", "deleted", [0.9, 0.1], is_deleted=True)

        fs = FakeFirestoreClient([chunk_ok, chunk_del])
        scope = _make_scope()

        results = retrieve_relevant_chunks(
            fs, scope, "query", entitlements=self._enabled_entitlements()
        )

        chunk_ids = [r["chunk_id"] for r in results]
        assert "del" not in chunk_ids

    @patch("backend.services.steve_chat_memory_retrieval.embed_text")
    def test_reset_at_excludes_old_chunks(self, mock_embed):
        mock_embed.return_value = [1.0, 0.0]

        old_chunk = _make_chunk(
            "old", "old conversation", [1.0, 0.0],
            message_ts_end="2024-01-01T10:00:00Z",
        )
        new_chunk = _make_chunk(
            "new", "new conversation", [0.9, 0.1],
            message_ts_end="2025-06-15T10:00:00Z",
        )

        fs = FakeFirestoreClient([old_chunk, new_chunk])
        scope = _make_scope()

        results = retrieve_relevant_chunks(
            fs, scope, "query",
            entitlements=self._enabled_entitlements(),
            reset_at="2025-06-01T00:00:00Z",
        )

        chunk_ids = [r["chunk_id"] for r in results]
        assert "old" not in chunk_ids
        assert "new" in chunk_ids

    def test_returns_empty_when_no_chunks(self):
        fs = FakeFirestoreClient([])
        scope = _make_scope()

        with patch("backend.services.steve_chat_memory_retrieval.embed_text") as mock_embed:
            mock_embed.return_value = [1.0, 0.0]
            results = retrieve_relevant_chunks(
                fs, scope, "query",
                entitlements=self._enabled_entitlements(),
            )

        assert results == []
        mock_embed.assert_not_called()

    @patch("backend.services.steve_chat_memory_retrieval.embed_text")
    def test_respects_top_k(self, mock_embed):
        mock_embed.return_value = [1.0, 0.0, 0.0]

        chunks = [
            _make_chunk(f"c{i}", f"text {i}", [1.0 - i * 0.1, i * 0.1, 0.0])
            for i in range(10)
        ]

        fs = FakeFirestoreClient(chunks)
        scope = _make_scope()

        results = retrieve_relevant_chunks(
            fs, scope, "query",
            entitlements=self._enabled_entitlements(chat_memory_top_k=3),
        )

        assert len(results) <= 3

    @patch("backend.services.steve_chat_memory_retrieval.embed_text")
    def test_no_usage_row_for_retrieval_only_read(self, mock_embed):
        """Reading stored vectors does NOT log ai_usage rows."""
        mock_embed.return_value = [1.0, 0.0]
        chunk = _make_chunk("c1", "some text", [1.0, 0.0])
        fs = FakeFirestoreClient([chunk])
        scope = _make_scope()

        with patch("backend.services.steve_chat_memory_retrieval.ai_usage.log_usage") as mock_log:
            mock_embed.return_value = [1.0, 0.0]
            results = retrieve_relevant_chunks(
                fs, scope, "query",
                entitlements=self._enabled_entitlements(),
            )
            assert len(results) == 1
            mock_log.assert_not_called()


# ---------------------------------------------------------------------------
# Tests: inject_chat_memory_into_context
# ---------------------------------------------------------------------------


class TestInjectChatMemoryIntoContext:
    def _enabled_ent(self) -> Dict[str, Any]:
        return {
            "chat_memory_enabled": True,
            "chat_memory_peer_dm_enabled": True,
            "chat_memory_top_k": 4,
            "chat_memory_max_prompt_chars": 5000,
            "chat_memory_embedding_model": "text-embedding-3-small",
        }

    @patch("backend.services.steve_chat_memory_retrieval.retrieve_relevant_chunks")
    def test_returns_formatted_memory_on_recall(self, mock_retrieve):
        mock_retrieve.return_value = [
            {
                "chunk_id": "c1",
                "text": "Alice mentioned Paris trip on Monday",
                "message_ts_start": "2025-05-01T10:00:00Z",
                "message_ts_end": "2025-05-01T12:00:00Z",
                "senders": {"alice": 3, "bob": 2},
            }
        ]

        fs = FakeFirestoreClient([])
        scope = _make_scope()

        result = inject_chat_memory_into_context(
            fs, scope,
            "when did Alice mention Paris?",
            ["alice: hello", "bob: hi"],
            entitlements=self._enabled_ent(),
            username="bob",
        )

        assert "=== RELEVANT OLDER MEMORY ===" in result
        assert "Paris" in result

    @patch("backend.services.steve_chat_memory_retrieval.retrieve_relevant_chunks")
    def test_returns_empty_when_disabled(self, mock_retrieve):
        fs = FakeFirestoreClient([])
        scope = _make_scope()
        ent = {
            "chat_memory_enabled": False,
            "chat_memory_peer_dm_enabled": False,
        }

        result = inject_chat_memory_into_context(
            fs, scope, "when did we talk?", [],
            entitlements=ent, username="alice",
        )

        assert result == ""
        mock_retrieve.assert_not_called()

    @patch("backend.services.steve_chat_memory_retrieval.retrieve_relevant_chunks")
    def test_returns_empty_when_no_recall_intent(self, mock_retrieve):
        fs = FakeFirestoreClient([])
        scope = _make_scope()

        result = inject_chat_memory_into_context(
            fs, scope, "hello Steve, how are you?", [],
            entitlements=self._enabled_ent(), username="alice",
        )

        assert result == ""
        mock_retrieve.assert_not_called()

    @patch("backend.services.steve_chat_memory_retrieval.retrieve_relevant_chunks")
    def test_returns_empty_when_no_chunks_found(self, mock_retrieve):
        mock_retrieve.return_value = []
        fs = FakeFirestoreClient([])
        scope = _make_scope()

        result = inject_chat_memory_into_context(
            fs, scope, "what did Alice say?", [],
            entitlements=self._enabled_ent(), username="bob",
        )

        assert result == ""

    @patch("backend.services.steve_chat_memory_retrieval.retrieve_relevant_chunks")
    def test_retrieval_failure_is_nonfatal(self, mock_retrieve):
        mock_retrieve.side_effect = RuntimeError("Firestore unavailable")
        fs = FakeFirestoreClient([])
        scope = _make_scope()

        result = inject_chat_memory_into_context(
            fs, scope, "what did Alice say?", [],
            entitlements=self._enabled_ent(), username="bob",
        )

        assert result == ""

    @patch("backend.services.steve_chat_memory_retrieval.retrieve_relevant_chunks")
    def test_formats_via_format_relevant_older_memory(self, mock_retrieve):
        mock_retrieve.return_value = [
            {
                "chunk_id": "c1",
                "text": "discussed project budget",
                "message_ts_start": "2025-03-01T10:00:00Z",
                "message_ts_end": "2025-03-01T12:00:00Z",
                "senders": {"alice": 5},
            },
            {
                "chunk_id": "c2",
                "text": "planned team outing",
                "message_ts_start": "2025-04-10T10:00:00Z",
                "message_ts_end": "2025-04-10T14:00:00Z",
                "senders": {"bob": 3},
            },
        ]

        fs = FakeFirestoreClient([])
        scope = _make_scope()

        result = inject_chat_memory_into_context(
            fs, scope, "what did we talk about?", [],
            entitlements=self._enabled_ent(), username="alice",
        )

        assert "=== RELEVANT OLDER MEMORY ===" in result
        assert "budget" in result
        assert "outing" in result


# ---------------------------------------------------------------------------
# Tests: intent routing integration
# ---------------------------------------------------------------------------


class TestIntentRoutingIntegration:
    """Verify that casual messages skip embedding entirely."""

    def _enabled_ent(self) -> Dict[str, Any]:
        return {
            "chat_memory_enabled": True,
            "chat_memory_peer_dm_enabled": True,
            "chat_memory_top_k": 4,
            "chat_memory_max_prompt_chars": 5000,
        }

    @patch("backend.services.steve_chat_memory_retrieval.embed_text")
    def test_casual_message_skips_embed(self, mock_embed):
        fs = FakeFirestoreClient([_make_chunk("c1", "text", [1.0, 0.0])])
        scope = _make_scope()

        result = inject_chat_memory_into_context(
            fs, scope, "hello Steve!", [],
            entitlements=self._enabled_ent(), username="alice",
        )

        assert result == ""
        mock_embed.assert_not_called()

    @patch("backend.services.steve_chat_memory_retrieval.embed_text")
    @patch("backend.services.steve_chat_memory_retrieval.retrieve_relevant_chunks")
    def test_recall_message_triggers_retrieval(self, mock_retrieve, mock_embed):
        mock_retrieve.return_value = [
            {"chunk_id": "c1", "text": "old conv about gym",
             "message_ts_start": "2025-01-01T10:00:00Z",
             "message_ts_end": "2025-01-01T12:00:00Z",
             "senders": {"alice": 2}}
        ]

        fs = FakeFirestoreClient([])
        scope = _make_scope()

        result = inject_chat_memory_into_context(
            fs, scope, "when did we last talk about the gym?", [],
            entitlements=self._enabled_ent(), username="alice",
        )

        assert result != ""
        mock_retrieve.assert_called_once()
