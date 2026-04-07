"""
Embedding service for semantic search over user profiles.

Uses OpenAI text-embedding-3-small to compute vector embeddings of user
context strings, stored on the Firestore steve_user_profiles document.
A FAISS in-memory index enables sub-millisecond nearest-neighbour search
at any community size.

Write path:
    compute_and_store_embedding(username)  — called after profile analysis
    or onboarding identity merge.

Read path:
    search_similar_profiles(query_text, candidate_usernames, k)
    — returns top-k usernames most semantically similar to query_text.
"""

import os
import logging
import threading
import time
import numpy as np
from typing import List, Tuple, Optional, Dict

logger = logging.getLogger(__name__)

OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')
EMBEDDING_MODEL = 'text-embedding-3-small'
EMBEDDING_DIMS = 1536

_faiss_available = False
try:
    import faiss
    _faiss_available = True
except ImportError:
    logger.info("faiss-cpu not installed — falling back to numpy cosine search")


# ---------------------------------------------------------------------------
# OpenAI embedding client (lazy singleton)
# ---------------------------------------------------------------------------
_openai_client = None


def _get_openai_client():
    global _openai_client
    if _openai_client is None:
        from openai import OpenAI
        _openai_client = OpenAI(api_key=OPENAI_API_KEY)
    return _openai_client


def compute_embedding(text: str) -> Optional[List[float]]:
    """Compute a 1536-dim embedding for *text* via OpenAI."""
    if not OPENAI_API_KEY:
        logger.warning("OPENAI_API_KEY not set — skipping embedding")
        return None
    if not text or not text.strip():
        return None
    try:
        client = _get_openai_client()
        trimmed = text[:8000]
        resp = client.embeddings.create(input=[trimmed], model=EMBEDDING_MODEL)
        return resp.data[0].embedding
    except Exception as e:
        logger.warning(f"Embedding computation failed: {e}")
        return None


# ---------------------------------------------------------------------------
# FAISS / numpy index — community-scoped search
# ---------------------------------------------------------------------------

class ProfileIndex:
    """Thread-safe in-memory vector index for user profile embeddings.

    Supports two backends:
        * FAISS  (fast, requires faiss-cpu)
        * numpy  (fallback, pure-Python cosine similarity)
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._usernames: List[str] = []
        self._vectors: Optional[np.ndarray] = None  # (N, EMBEDDING_DIMS)
        self._username_to_idx: Dict[str, int] = {}
        self._faiss_index = None
        self._built = False
        self._last_build = 0.0

    # -- bulk load --------------------------------------------------------

    def build(self, profiles: Dict[str, List[float]]) -> int:
        """Build the index from a {username: embedding_vector} dict.
        Returns the number of vectors indexed."""
        if not profiles:
            return 0
        with self._lock:
            usernames = []
            vecs = []
            for uname, vec in profiles.items():
                if vec and len(vec) == EMBEDDING_DIMS:
                    usernames.append(uname)
                    vecs.append(vec)
            if not vecs:
                return 0
            self._usernames = usernames
            self._username_to_idx = {u: i for i, u in enumerate(usernames)}
            self._vectors = np.array(vecs, dtype=np.float32)
            # L2-normalise for cosine similarity via inner-product
            norms = np.linalg.norm(self._vectors, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            self._vectors = self._vectors / norms

            if _faiss_available:
                idx = faiss.IndexFlatIP(EMBEDDING_DIMS)
                idx.add(self._vectors)
                self._faiss_index = idx
            else:
                self._faiss_index = None

            self._built = True
            self._last_build = time.time()
            logger.info(f"ProfileIndex built with {len(usernames)} vectors (FAISS={_faiss_available})")
            return len(usernames)

    # -- incremental upsert -----------------------------------------------

    def upsert(self, username: str, vector: List[float]):
        """Add or update a single user's vector. Rebuilds FAISS if active."""
        if not vector or len(vector) != EMBEDDING_DIMS:
            return
        vec = np.array(vector, dtype=np.float32)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        with self._lock:
            if username in self._username_to_idx:
                idx = self._username_to_idx[username]
                self._vectors[idx] = vec
            else:
                self._usernames.append(username)
                self._username_to_idx[username] = len(self._usernames) - 1
                if self._vectors is not None and self._vectors.shape[0] > 0:
                    self._vectors = np.vstack([self._vectors, vec.reshape(1, -1)])
                else:
                    self._vectors = vec.reshape(1, -1)

            if _faiss_available and self._vectors is not None:
                idx = faiss.IndexFlatIP(EMBEDDING_DIMS)
                idx.add(self._vectors)
                self._faiss_index = idx
            self._built = self._vectors is not None and self._vectors.shape[0] > 0

    # -- search -----------------------------------------------------------

    def search(
        self,
        query_vector: List[float],
        candidate_usernames: Optional[List[str]] = None,
        k: int = 30,
    ) -> List[Tuple[str, float]]:
        """Return up to *k* (username, score) pairs most similar to *query_vector*.

        If *candidate_usernames* is provided, results are restricted to that set.
        """
        if not self._built or self._vectors is None or self._vectors.shape[0] == 0:
            return []

        qvec = np.array(query_vector, dtype=np.float32).reshape(1, -1)
        norm = np.linalg.norm(qvec)
        if norm > 0:
            qvec = qvec / norm

        with self._lock:
            if candidate_usernames is not None:
                candidate_set = set(candidate_usernames)
                mask_indices = [self._username_to_idx[u] for u in candidate_set if u in self._username_to_idx]
                if not mask_indices:
                    return []
                sub_vecs = self._vectors[mask_indices]
                scores = (sub_vecs @ qvec.T).flatten()
                topk = min(k, len(scores))
                top_local = np.argpartition(-scores, topk)[:topk]
                top_local = top_local[np.argsort(-scores[top_local])]
                return [(self._usernames[mask_indices[i]], float(scores[i])) for i in top_local]

            if _faiss_available and self._faiss_index is not None:
                actual_k = min(k, self._faiss_index.ntotal)
                distances, indices = self._faiss_index.search(qvec, actual_k)
                results = []
                for dist, idx in zip(distances[0], indices[0]):
                    if idx < 0:
                        continue
                    results.append((self._usernames[idx], float(dist)))
                return results

            scores = (self._vectors @ qvec.T).flatten()
            topk = min(k, len(scores))
            top_indices = np.argpartition(-scores, topk)[:topk]
            top_indices = top_indices[np.argsort(-scores[top_indices])]
            return [(self._usernames[i], float(scores[i])) for i in top_indices]

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._usernames)

    @property
    def is_ready(self) -> bool:
        return self._built


# Singleton index
profile_index = ProfileIndex()


# ---------------------------------------------------------------------------
# Firestore integration helpers
# ---------------------------------------------------------------------------

def load_index_from_firestore() -> int:
    """Stream all steve_user_profiles that have an 'embedding' field and
    build the in-memory index.  Returns number of vectors loaded."""
    try:
        from backend.services.firestore_reads import _get_client
        fs = _get_client()
        profiles: Dict[str, List[float]] = {}
        for doc in fs.collection('steve_user_profiles').stream():
            data = doc.to_dict()
            emb = data.get('embedding')
            if emb and isinstance(emb, list) and len(emb) == EMBEDDING_DIMS:
                profiles[doc.id] = emb
        count = profile_index.build(profiles)
        logger.info(f"FAISS index loaded from Firestore: {count} profiles")
        return count
    except Exception as e:
        logger.warning(f"Failed to load FAISS index from Firestore: {e}")
        return 0


def compute_and_store_embedding(username: str, context_string: str = None) -> bool:
    """Compute embedding for *username* and store on Firestore + in-memory index.

    If *context_string* is not provided, it is built via get_steve_context_for_user.
    This is safe to call from a background thread.
    """
    try:
        if not context_string:
            from bodybuilding_app import get_steve_context_for_user
            context_string = get_steve_context_for_user(username)
        if not context_string or not context_string.strip():
            return False

        vec = compute_embedding(context_string)
        if not vec:
            return False

        from backend.services.firestore_writes import _get_client as _get_fs_write_client
        fs = _get_fs_write_client()
        fs.collection('steve_user_profiles').document(username).set(
            {'embedding': vec}, merge=True
        )

        profile_index.upsert(username, vec)
        logger.debug(f"Embedding stored for {username} ({len(context_string)} chars)")
        return True
    except Exception as e:
        logger.warning(f"compute_and_store_embedding failed for {username}: {e}")
        return False


def compute_and_store_embedding_background(username: str, context_string: str = None):
    """Fire-and-forget wrapper that runs compute_and_store_embedding in a thread."""
    t = threading.Thread(
        target=compute_and_store_embedding,
        args=(username, context_string),
        daemon=True,
    )
    t.start()


# ---------------------------------------------------------------------------
# High-level search for networking endpoints
# ---------------------------------------------------------------------------

def search_similar_profiles(
    query_text: str,
    candidate_usernames: List[str],
    k: int = 30,
) -> List[str]:
    """Embed *query_text* and return the top-k most semantically similar
    usernames from *candidate_usernames*.

    Falls back to returning all candidates (unranked) if embeddings are
    unavailable.
    """
    if not profile_index.is_ready or not OPENAI_API_KEY:
        return candidate_usernames[:k] if len(candidate_usernames) > k else candidate_usernames

    qvec = compute_embedding(query_text)
    if not qvec:
        return candidate_usernames[:k] if len(candidate_usernames) > k else candidate_usernames

    results = profile_index.search(qvec, candidate_usernames=candidate_usernames, k=k)
    if not results:
        return candidate_usernames[:k] if len(candidate_usernames) > k else candidate_usernames
    return [uname for uname, _score in results]
