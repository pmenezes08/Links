"""R2 snapshot of the profile embedding index (pure unit tests, no R2/DB).

Round-trips ``backend.services.embedding_index_snapshot`` through an
in-memory fake of the R2 helpers: build -> save -> fresh index -> load ->
search parity, plus the failure modes (missing/corrupt/version-mismatched
snapshots must return 0 and leave the index untouched, falling back to the
Firestore stream).
"""

from __future__ import annotations

import numpy as np
import pytest

import backend.services.embedding_index_snapshot as snap
import backend.services.embedding_service as emb
from backend.services.embedding_service import EMBEDDING_DIMS, ProfileIndex


@pytest.fixture()
def fake_r2(monkeypatch):
    """In-memory stand-in for the private R2 helpers."""
    store = {}

    def upload(data, key, content_type=None):
        store[key] = data
        return True

    def download(key):
        return store.get(key)

    monkeypatch.setattr(
        "backend.services.r2_storage.upload_private_bytes_to_r2", upload
    )
    monkeypatch.setattr(
        "backend.services.r2_storage.download_bytes_from_r2", download
    )
    return store


def _vec(seed: float):
    v = np.zeros(EMBEDDING_DIMS, dtype=np.float32)
    v[0] = seed
    v[1] = 1.0
    return v.tolist()


def _build_index(index: ProfileIndex) -> int:
    return index.build(
        {
            "alice": {"professional": _vec(0.9), "social": _vec(0.1)},
            "bob": {"professional": _vec(-0.5)},
        }
    )


def test_snapshot_round_trip_preserves_keys_and_search(fake_r2, monkeypatch):
    source = ProfileIndex()
    assert _build_index(source) == 3
    monkeypatch.setattr(emb, "profile_index", source)
    assert snap.save_index_snapshot() is True
    assert snap.SNAPSHOT_KEY in fake_r2

    restored = ProfileIndex()
    monkeypatch.setattr(emb, "profile_index", restored)
    assert snap.load_index_snapshot() == 3

    assert restored.is_ready
    assert restored.user_count == 2
    assert sorted(restored.export_state()[0]) == sorted(source.export_state()[0])

    # Search parity: the same query ranks the same user first in both.
    query = _vec(0.9)
    assert [u for u, _ in restored.search(query, k=2)] == [
        u for u, _ in source.search(query, k=2)
    ]


def test_missing_or_corrupt_snapshot_returns_zero(fake_r2, monkeypatch):
    restored = ProfileIndex()
    monkeypatch.setattr(emb, "profile_index", restored)

    # No object stored at all.
    assert snap.load_index_snapshot() == 0
    assert not restored.is_ready

    # Garbage bytes.
    fake_r2[snap.SNAPSHOT_KEY] = b"not an npz file"
    assert snap.load_index_snapshot() == 0
    assert not restored.is_ready


def test_version_mismatch_is_rejected(fake_r2, monkeypatch):
    source = ProfileIndex()
    _build_index(source)
    monkeypatch.setattr(emb, "profile_index", source)
    monkeypatch.setattr(snap, "SNAPSHOT_FORMAT_VERSION", 1)
    assert snap.save_index_snapshot() is True

    restored = ProfileIndex()
    monkeypatch.setattr(emb, "profile_index", restored)
    monkeypatch.setattr(snap, "SNAPSHOT_FORMAT_VERSION", 2)
    assert snap.load_index_snapshot() == 0
    assert not restored.is_ready


def test_save_skips_empty_index(fake_r2, monkeypatch):
    monkeypatch.setattr(emb, "profile_index", ProfileIndex())
    assert snap.save_index_snapshot() is False
    assert snap.SNAPSHOT_KEY not in fake_r2


def test_ensure_index_ready_prefers_snapshot_over_firestore(fake_r2, monkeypatch):
    # Store a valid snapshot, then make Firestore explode if touched
    # synchronously — ensure_index_ready must not need it.
    source = ProfileIndex()
    _build_index(source)
    monkeypatch.setattr(emb, "profile_index", source)
    assert snap.save_index_snapshot() is True

    restored = ProfileIndex()
    monkeypatch.setattr(emb, "profile_index", restored)

    def boom():
        raise AssertionError("Firestore stream must not run synchronously")

    monkeypatch.setattr(emb, "load_index_from_firestore", boom)
    monkeypatch.setattr(snap, "_background", lambda fn, label: None)

    assert snap.ensure_index_ready() is True
    assert restored.is_ready
