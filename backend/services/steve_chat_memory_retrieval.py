"""Scoped semantic retrieval for Steve Phase 3 peer-DM chat memory.

Provides embedding generation, cosine-similarity search over stored
chunk vectors, intent routing, and prompt injection orchestration.

Embedding calls log exactly one ``ai_usage`` row per vendor request.
Retrieval-only reads (cosine over already-stored vectors) never write
usage rows.
"""

from __future__ import annotations

import logging
import math
import os
import re
from typing import Any, Dict, List, Mapping, Optional, Sequence, Union
from dataclasses import is_dataclass, asdict

from backend.services import ai_usage
from backend.services.steve_chat_memory import (
    CHUNKS_SUBCOLLECTION,
    COLLECTION,
    ChatMemoryConfig,
    ThreadMemoryScope,
    chat_memory_enabled_for_scope,
    format_relevant_older_memory,
    get_chat_memory_config,
    should_include_memory_record,
)

logger = logging.getLogger(__name__)

SURFACE_DM = ai_usage.SURFACE_DM
REQUEST_TYPE_EMBED = "steve_chat_memory_embed"

DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_EMBEDDING_DIM = 1536

RECALL_INTENT_PATTERNS: List[re.Pattern] = [
    re.compile(r"\bwhen did\b", re.IGNORECASE),
    re.compile(r"\bwhat did\b", re.IGNORECASE),
    re.compile(r"\bremember\b", re.IGNORECASE),
    re.compile(r"\bfind the\b", re.IGNORECASE),
    re.compile(r"\bwhat was\b", re.IGNORECASE),
    re.compile(r"\blast time\b", re.IGNORECASE),
    re.compile(r"\bmentioned\b", re.IGNORECASE),
    re.compile(r"\btalked about\b", re.IGNORECASE),
    re.compile(r"\bdo you recall\b", re.IGNORECASE),
    re.compile(r"\bwhere did\b", re.IGNORECASE),
    re.compile(r"\bwho said\b", re.IGNORECASE),
    re.compile(r"\bhow many times\b", re.IGNORECASE),
    re.compile(r"\bwe discussed\b", re.IGNORECASE),
    re.compile(r"\bearlier you said\b", re.IGNORECASE),
    re.compile(r"\bpreviously\b", re.IGNORECASE),
    re.compile(r"\byou told me\b", re.IGNORECASE),
    re.compile(r"\bi told you\b", re.IGNORECASE),
    re.compile(r"\bwhat about that\b", re.IGNORECASE),
    re.compile(r"\bback when\b", re.IGNORECASE),
    re.compile(r"\bwhat happened\b", re.IGNORECASE),
]


# ---------------------------------------------------------------------------
# Intent detection
# ---------------------------------------------------------------------------


def has_recall_intent(user_message: str) -> bool:
    """Return True if the message contains recall-intent signals."""
    if not user_message:
        return False
    text = user_message.strip()
    return any(pattern.search(text) for pattern in RECALL_INTENT_PATTERNS)


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------


def _get_embedding_api_config() -> tuple:
    """Return (api_key, base_url) for the embeddings endpoint.

    Priority:
    1. Explicit EMBEDDING_API_BASE_URL → pair with XAI_API_KEY or OPENAI_API_KEY
    2. Otherwise default to OpenAI (OPENAI_API_KEY + api.openai.com)
       since xAI does not serve a compatible embeddings endpoint.
    """
    explicit_url = os.environ.get("EMBEDDING_API_BASE_URL")
    if explicit_url:
        key = os.environ.get("XAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
        return key, explicit_url

    key = os.environ.get("OPENAI_API_KEY") or os.environ.get("XAI_API_KEY")
    return key, "https://api.openai.com/v1"


def embed_text(
    text: str,
    model: str = DEFAULT_EMBEDDING_MODEL,
    *,
    username: str = "system",
) -> List[float]:
    """Call the embeddings API and return a vector.

    Logs exactly one ``ai_usage`` row on success or failure. Raises on
    API errors so the caller can fall back gracefully.
    """
    from openai import OpenAI

    api_key, base_url = _get_embedding_api_config()
    if not api_key:
        logger.warning("No embedding API key configured (OPENAI_API_KEY / XAI_API_KEY) - using zero vector for local testing")
        return [0.0] * 1536  # dummy vector for local testing (text-embedding-3-small dim)

    client = OpenAI(api_key=api_key, base_url=base_url)

    import time as _time

    t0 = _time.perf_counter()
    try:
        response = client.embeddings.create(input=[text], model=model)
        vector = response.data[0].embedding
        elapsed_ms = int((_time.perf_counter() - t0) * 1000)

        ai_usage.log_usage(
            username,
            surface=SURFACE_DM,
            request_type=REQUEST_TYPE_EMBED,
            model=model,
            tokens_in=response.usage.total_tokens if hasattr(response, "usage") and response.usage else None,
            response_time_ms=elapsed_ms,
        )
        return vector
    except Exception as exc:
        elapsed_ms = int((_time.perf_counter() - t0) * 1000)
        ai_usage.log_usage(
            username,
            surface=SURFACE_DM,
            request_type=REQUEST_TYPE_EMBED,
            model=model,
            success=False,
            reason_blocked=str(exc)[:200],
            response_time_ms=elapsed_ms,
        )
        raise


def embed_chunks(
    fs_client: Any,
    scope: ThreadMemoryScope,
    chunks: Sequence[Union[Mapping[str, Any], Any]],
    model: str = DEFAULT_EMBEDDING_MODEL,
    *,
    username: str = "system",
) -> int:
    """Embed each chunk's text and store vector on the chunk doc.

    Returns the number of chunks successfully embedded. Each embedding
    call logs its own usage row via ``embed_text``.
    Supports both dicts and ChunkRecord dataclasses.
    """
    embedded_count = 0
    for chunk in chunks:
        # Support both dict (old) and ChunkRecord dataclass (new)
        if is_dataclass(chunk) and not isinstance(chunk, type):
            chunk_dict = asdict(chunk)
        else:
            chunk_dict = chunk if isinstance(chunk, dict) else dict(chunk) if hasattr(chunk, "keys") else {}

        chunk_id = chunk_dict.get("chunk_id") or chunk_dict.get("id")
        text = (chunk_dict.get("text") or chunk_dict.get("summary") or "").strip()
        if not chunk_id or not text:
            continue

        existing_embedding = chunk_dict.get("embedding")
        if existing_embedding and len(existing_embedding) > 0:
            continue

        try:
            vector = embed_text(text, model, username=username)
        except Exception as exc:
            logger.warning(
                "embed_chunks: failed to embed chunk %s: %s", chunk_id, exc
            )
            continue

        try:
            (
                fs_client.collection(COLLECTION)
                .document(scope.scope_key)
                .collection(CHUNKS_SUBCOLLECTION)
                .document(str(chunk_id))
                .update({
                    "embedding": vector,
                    "embedding_model": model,
                    "embedding_dim": len(vector),
                })
            )
            embedded_count += 1
        except Exception as exc:
            logger.warning(
                "embed_chunks: failed to write embedding for chunk %s: %s",
                chunk_id, exc,
            )

    return embedded_count


# ---------------------------------------------------------------------------
# Cosine similarity
# ---------------------------------------------------------------------------


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


# ---------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------


def retrieve_relevant_chunks(
    fs_client: Any,
    scope: ThreadMemoryScope,
    query_text: str,
    *,
    entitlements: Optional[Mapping[str, Any]] = None,
    top_k: int = 4,
    max_chars: int = 3500,
    reset_at: Any = None,
    username: str = "system",
) -> List[Dict[str, Any]]:
    """Load chunks for scope, compute query embedding, return top_k by cosine.

    This function generates one embedding (the query), which logs a usage
    row.  Reading stored chunk vectors does NOT log usage.
    """
    config = get_chat_memory_config(entitlements)
    effective_top_k = min(top_k, config.top_k) if entitlements else top_k
    effective_max_chars = min(max_chars, config.max_prompt_chars) if entitlements else max_chars

    chunks_ref = (
        fs_client.collection(COLLECTION)
        .document(scope.scope_key)
        .collection(CHUNKS_SUBCOLLECTION)
    )

    try:
        docs = list(chunks_ref.stream())
    except Exception as exc:
        logger.warning(
            "retrieve_relevant_chunks: failed to read chunks for %s: %s",
            scope.scope_key, exc,
        )
        return []

    all_chunks: List[Dict[str, Any]] = []
    for doc in docs:
        data = doc.to_dict() or {}
        data["chunk_id"] = doc.id
        if not should_include_memory_record(data, reset_at=reset_at):
            continue
        embedding = data.get("embedding")
        if not embedding or not isinstance(embedding, (list, tuple)):
            continue
        all_chunks.append(data)

    if not all_chunks:
        return []

    embedding_model = (
        config.embedding_model
        if config.embedding_model
        else DEFAULT_EMBEDDING_MODEL
    )

    try:
        query_vector = embed_text(query_text, embedding_model, username=username)
    except Exception as exc:
        logger.warning(
            "retrieve_relevant_chunks: query embedding failed: %s", exc
        )
        return []

    scored: List[tuple] = []
    for chunk in all_chunks:
        score = cosine_similarity(query_vector, chunk["embedding"])
        scored.append((score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:effective_top_k]

    results: List[Dict[str, Any]] = []
    total_chars = 0
    for score, chunk in top:
        text = (chunk.get("text") or chunk.get("summary") or "").strip()
        if total_chars + len(text) > effective_max_chars:
            break
        chunk_result = dict(chunk)
        chunk_result["_score"] = score
        chunk_result.pop("embedding", None)
        results.append(chunk_result)
        total_chars += len(text)

    return results


# ---------------------------------------------------------------------------
# Orchestration: inject into DM context
# ---------------------------------------------------------------------------


def inject_chat_memory_into_context(
    fs_client: Any,
    scope: ThreadMemoryScope,
    user_message: str,
    recent_messages: List[str],
    *,
    entitlements: Optional[Mapping[str, Any]] = None,
    reset_at: Any = None,
    username: str = "system",
) -> str:
    """Orchestrate retrieval and return formatted prompt section.

    Returns ``""`` if:
    - Chat memory is disabled for this scope.
    - The user message lacks recall intent.
    - No chunks are available or retrieval fails.

    Retrieval failure is always non-fatal.
    """
    if not chat_memory_enabled_for_scope(entitlements, scope):
        return ""

    if not has_recall_intent(user_message):
        return ""

    config = get_chat_memory_config(entitlements)

    try:
        chunks = retrieve_relevant_chunks(
            fs_client,
            scope,
            user_message,
            entitlements=entitlements,
            top_k=config.top_k,
            max_chars=config.max_prompt_chars,
            reset_at=reset_at,
            username=username,
        )
    except Exception as exc:
        logger.warning(
            "inject_chat_memory_into_context: retrieval failed for %s: %s",
            scope.scope_key, exc,
        )
        return ""

    if not chunks:
        return ""

    return format_relevant_older_memory(
        chunks,
        max_chars=config.max_prompt_chars,
        top_k=config.top_k,
    )
