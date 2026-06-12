"""R2 snapshot of the profile embedding index (cold-start accelerator).

A new Cloud Run instance used to stream the entire ``steve_user_profiles``
Firestore collection — every embedding vector — before the first networking
search could run: a 5-30s first-request cliff. The snapshot is one
compressed ``.npz`` object in R2 holding the index's ``(username,
chunk_type)`` keys and the normalized vector matrix; loading it makes the
index ready in well under a second. Search behaviour is byte-for-byte the
same once loaded.

PRIVACY: embeddings are profile-derived data (inversion recovers profile
text), so the snapshot MUST go through ``upload_private_bytes_to_r2`` —
never the default public-read/CDN-cached upload helper.

Freshness model: the snapshot is rewritten by
``POST /api/cron/refresh_embedding_index`` (Cloud Scheduler, X-Cron-Secret)
and opportunistically in the background after any successful load (snapshot
or Firestore fallback), so instances converge to live data and the stored
snapshot tracks it. Per-user upserts still update only the local in-memory
index, exactly as before — cross-instance staleness is unchanged by this
module. A missing/corrupt/mismatched snapshot is never fatal: callers fall
back to the legacy Firestore stream.
"""

from __future__ import annotations

import io
import logging
import os
import threading
import time
from typing import Any, Dict

import numpy as np

logger = logging.getLogger(__name__)

SNAPSHOT_KEY = os.environ.get(
    "EMBEDDING_INDEX_SNAPSHOT_KEY", "internal/embedding-index/profile_index_v1.npz"
)
SNAPSHOT_FORMAT_VERSION = 1


def save_index_snapshot() -> bool:
    """Serialize the current in-memory index to R2 (private object).

    Returns False (never raises) when the index is empty or R2 is
    unavailable — the snapshot is an accelerator, not a source of truth.
    """
    try:
        from backend.services.embedding_service import profile_index
        from backend.services.r2_storage import upload_private_bytes_to_r2

        keys, vectors = profile_index.export_state()
        if not keys or vectors is None:
            logger.info("embedding index snapshot skipped: index empty")
            return False
        buf = io.BytesIO()
        np.savez_compressed(
            buf,
            version=np.array([SNAPSHOT_FORMAT_VERSION], dtype=np.int64),
            created_at=np.array([time.time()], dtype=np.float64),
            usernames=np.array([k[0] for k in keys]),
            chunk_types=np.array([k[1] for k in keys]),
            vectors=vectors.astype(np.float32),
        )
        ok = upload_private_bytes_to_r2(
            buf.getvalue(), SNAPSHOT_KEY, content_type="application/octet-stream"
        )
        if ok:
            logger.info(
                "embedding index snapshot saved: %d vectors, %d bytes",
                len(keys), buf.getbuffer().nbytes,
            )
        return ok
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("save_index_snapshot failed: %s", e)
        return False


def load_index_snapshot() -> int:
    """Build the in-memory index from the R2 snapshot.

    Returns the number of vectors loaded; 0 on any miss/corruption/format
    mismatch (callers then fall back to the Firestore stream). Never raises
    and never touches the index unless the snapshot fully validates.
    """
    try:
        from backend.services.embedding_service import (
            EMBEDDING_DIMS,
            profile_index,
        )
        from backend.services.r2_storage import download_bytes_from_r2

        data = download_bytes_from_r2(SNAPSHOT_KEY)
        if not data:
            return 0
        with np.load(io.BytesIO(data), allow_pickle=False) as nz:
            if int(nz["version"][0]) != SNAPSHOT_FORMAT_VERSION:
                logger.warning(
                    "embedding index snapshot version mismatch: %s", nz["version"][0]
                )
                return 0
            created_at = float(nz["created_at"][0])
            usernames = nz["usernames"]
            chunk_types = nz["chunk_types"]
            vectors = nz["vectors"]
        if (
            vectors.ndim != 2
            or vectors.shape[1] != EMBEDDING_DIMS
            or vectors.shape[0] != len(usernames)
            or len(usernames) != len(chunk_types)
        ):
            logger.warning("embedding index snapshot shape invalid; ignoring")
            return 0

        profiles: Dict[str, Dict[str, Any]] = {}
        for i in range(len(usernames)):
            profiles.setdefault(str(usernames[i]), {})[str(chunk_types[i])] = (
                vectors[i].tolist()
            )
        count = profile_index.build(profiles)
        logger.info(
            "embedding index loaded from snapshot: %d vectors from %d users (age %.0fs)",
            count, len(profiles), max(0.0, time.time() - created_at),
        )
        return count
    except Exception as e:
        logger.warning("load_index_snapshot failed: %s", e)
        return 0


def refresh_index_from_firestore_and_snapshot() -> Dict[str, Any]:
    """Cron body: rebuild the index from live Firestore, then rewrite the
    snapshot so future cold starts boot from fresh data."""
    from backend.services.embedding_service import load_index_from_firestore

    count = load_index_from_firestore()
    saved = save_index_snapshot() if count > 0 else False
    return {"vectors": count, "snapshot_saved": saved}


def _background(fn, label: str) -> None:
    """Best-effort daemon thread. Cloud Run may throttle CPU after the
    response is sent, so this can silently die — acceptable: the cron
    refresh bounds snapshot staleness; this only accelerates convergence."""
    def _run():
        try:
            fn()
        except Exception as e:  # pragma: no cover - defensive
            logger.debug("background %s failed: %s", label, e)

    threading.Thread(target=_run, daemon=True).start()


def ensure_index_ready() -> bool:
    """Make the profile index ready, snapshot-first.

    Order: already ready → R2 snapshot (fast; then converge to live data in
    the background and rewrite the snapshot) → legacy Firestore stream (then
    write the first snapshot in the background). Returns readiness.
    """
    from backend.services.embedding_service import (
        load_index_from_firestore,
        profile_index,
    )

    if profile_index.is_ready:
        return True
    if load_index_snapshot() > 0:
        _background(refresh_index_from_firestore_and_snapshot, "index refresh")
        return True
    if load_index_from_firestore() > 0:
        _background(save_index_snapshot, "snapshot save")
        return True
    return False
