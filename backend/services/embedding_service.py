"""
Chunked embedding service for semantic search over user profiles.

Each user profile is split into up to 4 semantic chunks (professional,
personality, experiences, social), each embedded independently via OpenAI
text-embedding-3-small.  A multi-vector FAISS in-memory index enables
sub-millisecond nearest-neighbour search — finding the needle in a 100k
haystack by matching against whichever chunk is most relevant to the query.

Write path:
    compute_and_store_embeddings(username)  — called after profile analysis,
    onboarding identity merge, or post creation.

Read path:
    search_similar_profiles(query_text, candidate_usernames, k)
    — returns top-k usernames whose best-matching chunk is most similar.
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

CHUNK_TYPES = ('professional', 'personality', 'experiences', 'social')

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
# Chunk assembly — split a profile into semantic facets
# ---------------------------------------------------------------------------

def build_profile_chunks(profile: dict) -> Dict[str, str]:
    """Build up to 4 text chunks from a raw steve_user_profiles document.

    Each chunk groups semantically related fields so that niche signals
    (e.g. "climbed Kilimanjaro") are concentrated rather than diluted.
    Data may appear in multiple chunks when relevant to both.
    Returns {chunk_type: text} — empty chunks are omitted.
    """
    from bodybuilding_app import _migrate_analysis_to_v3

    analysis = _migrate_analysis_to_v3(profile.get('analysis', {}))
    ob = profile.get('onboardingIdentity') or {}
    platform = profile.get('profilingPlatformActivity') or {}

    chunks: Dict[str, str] = {}

    # --- professional chunk ---
    prof_parts = []
    if analysis.get('summary'):
        prof_parts.append(analysis['summary'])
    pro = analysis.get('professional') or {}
    co = pro.get('company') or {}
    if co.get('description'):
        prof_parts.append(f"Company ({co.get('name','?')}): {co['description']} [{co.get('sector','')} / {co.get('stage','')}]")
    role = pro.get('role') or {}
    if role.get('implication'):
        prof_parts.append(f"Role: {role.get('title','')} ({role.get('seniority','')}) — {role['implication']}")
    career = pro.get('careerHistory') or []
    if career:
        lines = []
        for entry in career[:8]:
            if not isinstance(entry, dict):
                continue
            line = f"{entry.get('role', '?')} at {entry.get('company', '?')}"
            if entry.get('duration'):
                line += f" ({entry['duration']})"
            elif entry.get('period'):
                line += f" [{entry['period']}]"
            if entry.get('highlight'):
                line += f" — {entry['highlight']}"
            lines.append(line)
        if lines:
            prof_parts.append(f"Career: {'; '.join(lines)}")
    loc = pro.get('location') or {}
    if loc.get('context'):
        prof_parts.append(f"Location: {loc['context']}")
    if pro.get('webFindings'):
        prof_parts.append(f"Professional background: {pro['webFindings']}")
    edu = pro.get('education')
    if edu:
        if isinstance(edu, list):
            edu_lines = []
            for e in edu[:5]:
                if isinstance(e, dict):
                    edu_lines.append(f"{e.get('degree', '')} @ {e.get('institution', '')} {e.get('year', '')}".strip())
                elif isinstance(e, str):
                    edu_lines.append(e)
            if edu_lines:
                prof_parts.append(f"Education: {'; '.join(edu_lines)}")
        elif isinstance(edu, str) and edu.strip():
            prof_parts.append(f"Education: {edu.strip()}")
    if prof_parts:
        chunks['professional'] = ' | '.join(prof_parts)

    # --- personality chunk ---
    pers_parts = []
    identity = analysis.get('identity') or {}
    if identity.get('bridgeInsight'):
        pers_parts.append(identity['bridgeInsight'])
    if identity.get('drivingForces'):
        pers_parts.append(f"Driving forces: {identity['drivingForces']}")
    if identity.get('roles'):
        pers_parts.append(f"Roles: {', '.join(identity['roles'][:5])}")
    traits = analysis.get('traits') or []
    if traits:
        pers_parts.append(f"Traits: {', '.join(traits[:6])}")
    personal = analysis.get('personal') or {}
    if personal.get('lifestyle'):
        pers_parts.append(f"Lifestyle: {personal['lifestyle']}")
    if (ob.get('talkAllDay') or '').strip():
        pers_parts.append(f"Could talk all day about: {ob['talkAllDay'].strip()}")
    if (ob.get('recommend') or '').strip():
        pers_parts.append(f"Recommends: {ob['recommend'].strip()}")
    if pers_parts:
        chunks['personality'] = ' | '.join(pers_parts)

    # --- experiences chunk ---
    exp_parts = []
    if (ob.get('journey') or '').strip():
        exp_parts.append(f"Journey: {ob['journey'].strip()}")
    interests = analysis.get('interests') or {}
    if interests:
        top = sorted(interests.items(), key=lambda x: x[1].get('score', 0) if isinstance(x[1], dict) else 0, reverse=True)[:8]
        for k, v in top:
            if not isinstance(v, dict):
                continue
            frag = k
            src = (v.get('source') or '').strip()
            if src:
                frag += f": {src[:200]}"
            exp_parts.append(frag)
    if personal.get('webFindings'):
        exp_parts.append(f"Personal background: {personal['webFindings']}")
    if analysis.get('observations'):
        exp_parts.append(analysis['observations'])
    if analysis.get('networkingValue'):
        exp_parts.append(f"Networking value: {analysis['networkingValue']}")
    if exp_parts:
        chunks['experiences'] = ' | '.join(exp_parts)

    # --- social chunk ---
    soc_parts = []
    if (ob.get('reachOut') or '').strip():
        soc_parts.append(f"Wants reach-outs about: {ob['reachOut'].strip()}")
    public_posts = personal.get('publicPosts') or []
    if public_posts:
        recent = [p for p in public_posts if isinstance(p, dict) and p.get('relevance') in ('high', 'medium')][:4]
        if recent:
            soc_parts.append('Recent activity: ' + '; '.join(p.get('insight', '') for p in recent if p.get('insight')))
    authored = platform.get('authoredPosts') or []
    if authored:
        snippets = [p.get('snippet', '')[:120] for p in authored[:5] if isinstance(p, dict) and p.get('snippet')]
        if snippets:
            soc_parts.append('C-Point posts: ' + '; '.join(snippets))
    starters = analysis.get('conversationStarters') or []
    if starters:
        soc_parts.append('Conversation starters: ' + '; '.join(starters[:4]))
    if soc_parts:
        chunks['social'] = ' | '.join(soc_parts)

    return chunks


# ---------------------------------------------------------------------------
# Multi-vector FAISS / numpy index
# ---------------------------------------------------------------------------

class ProfileIndex:
    """Thread-safe in-memory multi-vector index for chunked profile embeddings.

    Each user may have up to len(CHUNK_TYPES) vectors.  Search returns the
    best-scoring chunk per user, deduplicated.

    Supports two backends:
        * FAISS  (fast, requires faiss-cpu)
        * numpy  (fallback, pure-Python cosine similarity)
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._keys: List[Tuple[str, str]] = []       # (username, chunk_type)
        self._vectors: Optional[np.ndarray] = None    # (N_total, EMBEDDING_DIMS)
        self._user_indices: Dict[str, List[int]] = {} # username -> list of row indices
        self._faiss_index = None
        self._built = False
        self._last_build = 0.0

    def build(self, profiles: Dict[str, Dict[str, List[float]]]) -> int:
        """Build index from {username: {chunk_type: vector}}.
        Returns total number of vectors indexed."""
        if not profiles:
            return 0
        with self._lock:
            keys = []
            vecs = []
            user_indices: Dict[str, List[int]] = {}
            idx = 0
            for uname, chunks in profiles.items():
                for ctype, vec in chunks.items():
                    if vec and len(vec) == EMBEDDING_DIMS:
                        keys.append((uname, ctype))
                        vecs.append(vec)
                        user_indices.setdefault(uname, []).append(idx)
                        idx += 1
            if not vecs:
                return 0
            self._keys = keys
            self._user_indices = user_indices
            self._vectors = np.array(vecs, dtype=np.float32)
            norms = np.linalg.norm(self._vectors, axis=1, keepdims=True)
            norms[norms == 0] = 1.0
            self._vectors = self._vectors / norms

            if _faiss_available:
                fi = faiss.IndexFlatIP(EMBEDDING_DIMS)
                fi.add(self._vectors)
                self._faiss_index = fi
            else:
                self._faiss_index = None

            self._built = True
            self._last_build = time.time()
            n_users = len(user_indices)
            logger.info(f"ProfileIndex built: {len(vecs)} vectors from {n_users} users (FAISS={_faiss_available})")
            return len(vecs)

    def upsert(self, username: str, chunks: Dict[str, List[float]]):
        """Add or replace all chunk vectors for a user. Rebuilds FAISS."""
        if not chunks:
            return
        valid = {ct: vec for ct, vec in chunks.items() if vec and len(vec) == EMBEDDING_DIMS}
        if not valid:
            return
        with self._lock:
            old_indices = set(self._user_indices.get(username, []))
            if old_indices:
                keep_mask = [i for i in range(len(self._keys)) if i not in old_indices]
                self._keys = [self._keys[i] for i in keep_mask]
                if self._vectors is not None and len(keep_mask) > 0:
                    self._vectors = self._vectors[keep_mask]
                elif self._vectors is not None:
                    self._vectors = None
            else:
                keep_mask = None

            new_keys = []
            new_vecs = []
            for ct, vec in valid.items():
                v = np.array(vec, dtype=np.float32)
                norm = np.linalg.norm(v)
                if norm > 0:
                    v = v / norm
                new_keys.append((username, ct))
                new_vecs.append(v)
            new_arr = np.array(new_vecs, dtype=np.float32)

            if self._vectors is not None and self._vectors.shape[0] > 0:
                self._vectors = np.vstack([self._vectors, new_arr])
            else:
                self._vectors = new_arr
            self._keys.extend(new_keys)

            self._user_indices = {}
            for i, (uname, _ct) in enumerate(self._keys):
                self._user_indices.setdefault(uname, []).append(i)

            if _faiss_available and self._vectors is not None:
                fi = faiss.IndexFlatIP(EMBEDDING_DIMS)
                fi.add(self._vectors)
                self._faiss_index = fi
            self._built = self._vectors is not None and self._vectors.shape[0] > 0

    def search(
        self,
        query_vector: List[float],
        candidate_usernames: Optional[List[str]] = None,
        k: int = 30,
    ) -> List[Tuple[str, float]]:
        """Return up to *k* (username, best_score) pairs.

        Searches across ALL chunk vectors, then deduplicates by username
        keeping the highest-scoring chunk per user.
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
                mask_indices = []
                for uname in candidate_set:
                    mask_indices.extend(self._user_indices.get(uname, []))
                if not mask_indices:
                    return []
                sub_vecs = self._vectors[mask_indices]
                scores = (sub_vecs @ qvec.T).flatten()
                best_per_user: Dict[str, float] = {}
                for local_i, global_i in enumerate(mask_indices):
                    uname = self._keys[global_i][0]
                    s = float(scores[local_i])
                    if uname not in best_per_user or s > best_per_user[uname]:
                        best_per_user[uname] = s
                ranked = sorted(best_per_user.items(), key=lambda x: -x[1])[:k]
                return ranked

            all_scores = (self._vectors @ qvec.T).flatten()

            if _faiss_available and self._faiss_index is not None:
                search_k = min(k * len(CHUNK_TYPES), self._faiss_index.ntotal)
                distances, indices = self._faiss_index.search(qvec, search_k)
                best_per_user: Dict[str, float] = {}
                for dist, idx in zip(distances[0], indices[0]):
                    if idx < 0:
                        continue
                    uname = self._keys[idx][0]
                    s = float(dist)
                    if uname not in best_per_user or s > best_per_user[uname]:
                        best_per_user[uname] = s
            else:
                best_per_user: Dict[str, float] = {}
                for i, s in enumerate(all_scores):
                    uname = self._keys[i][0]
                    sf = float(s)
                    if uname not in best_per_user or sf > best_per_user[uname]:
                        best_per_user[uname] = sf

            ranked = sorted(best_per_user.items(), key=lambda x: -x[1])[:k]
            return ranked

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._keys)

    @property
    def user_count(self) -> int:
        with self._lock:
            return len(self._user_indices)

    @property
    def is_ready(self) -> bool:
        return self._built


profile_index = ProfileIndex()


# ---------------------------------------------------------------------------
# Firestore integration
# ---------------------------------------------------------------------------

def load_index_from_firestore() -> int:
    """Stream all steve_user_profiles and build the multi-vector index.
    Reads new ``embeddings`` dict; falls back to legacy ``embedding`` field."""
    try:
        from backend.services.firestore_reads import _get_client
        fs = _get_client()
        profiles: Dict[str, Dict[str, List[float]]] = {}
        for doc in fs.collection('steve_user_profiles').stream():
            data = doc.to_dict()
            embs = data.get('embeddings')
            if isinstance(embs, dict):
                chunks = {}
                for ct in CHUNK_TYPES:
                    vec = embs.get(ct)
                    if vec and isinstance(vec, list) and len(vec) == EMBEDDING_DIMS:
                        chunks[ct] = vec
                if chunks:
                    profiles[doc.id] = chunks
                    continue
            legacy = data.get('embedding')
            if legacy and isinstance(legacy, list) and len(legacy) == EMBEDDING_DIMS:
                profiles[doc.id] = {'professional': legacy}
        count = profile_index.build(profiles)
        logger.info(f"FAISS index loaded from Firestore: {count} vectors from {len(profiles)} users")
        return count
    except Exception as e:
        logger.warning(f"Failed to load FAISS index from Firestore: {e}")
        return 0


def compute_and_store_embeddings(username: str, chunk_types: List[str] = None) -> bool:
    """Compute chunked embeddings for *username* and store on Firestore + in-memory index.

    If *chunk_types* is provided, only those chunks are recomputed (useful
    for targeted refresh, e.g. social chunk on new post).  Otherwise all
    chunks are rebuilt from the current profile.
    """
    try:
        from backend.services.firestore_reads import get_steve_user_profile
        from backend.services.firestore_writes import _get_client as _get_fs_write_client

        profile = get_steve_user_profile(username)
        if not profile:
            return False

        all_chunks = build_profile_chunks(profile)
        if not all_chunks:
            return False

        target_chunks = chunk_types or list(all_chunks.keys())
        new_embeddings: Dict[str, List[float]] = {}
        for ct in target_chunks:
            text = all_chunks.get(ct)
            if not text:
                continue
            vec = compute_embedding(text)
            if vec:
                new_embeddings[ct] = vec

        if not new_embeddings:
            return False

        fs = _get_fs_write_client()
        update_payload = {f'embeddings.{ct}': vec for ct, vec in new_embeddings.items()}
        fs.collection('steve_user_profiles').document(username).set(
            update_payload, merge=True
        )

        existing = {}
        doc = fs.collection('steve_user_profiles').document(username).get()
        if doc.exists:
            embs = (doc.to_dict() or {}).get('embeddings') or {}
            for ct in CHUNK_TYPES:
                vec = embs.get(ct)
                if vec and isinstance(vec, list) and len(vec) == EMBEDDING_DIMS:
                    existing[ct] = vec
        existing.update(new_embeddings)

        profile_index.upsert(username, existing)
        logger.debug(f"Chunked embeddings stored for {username}: {list(new_embeddings.keys())}")
        return True
    except Exception as e:
        logger.warning(f"compute_and_store_embeddings failed for {username}: {e}")
        return False


def compute_and_store_embeddings_background(username: str, chunk_types: List[str] = None):
    """Fire-and-forget wrapper that runs compute_and_store_embeddings in a thread."""
    t = threading.Thread(
        target=compute_and_store_embeddings,
        args=(username, chunk_types),
        daemon=True,
    )
    t.start()


# Backward-compatible aliases
compute_and_store_embedding = compute_and_store_embeddings
compute_and_store_embedding_background = compute_and_store_embeddings_background


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

    The search runs across all chunk vectors, so a niche query like
    "climbing experience" can match a user's experiences chunk even if
    their professional chunk is about something entirely different.

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
