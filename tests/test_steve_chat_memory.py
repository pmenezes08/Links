from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Tuple

import pytest

from backend.services import steve_chat_memory as chatmem


class _Collection:
    def __init__(self, path: Tuple[str, ...]):
        self.path = path

    def document(self, doc_id: str):
        return _Doc(self.path + (str(doc_id),))


class _Doc:
    def __init__(self, path: Tuple[str, ...]):
        self.path = path

    def collection(self, name: str):
        return _Collection(self.path + (name,))


class _FakeFirestore:
    def collection(self, name: str):
        return _Collection((name,))


def test_scope_keys_are_exact_and_surface_isolated():
    dm = chatmem.scope_for_peer_dm("mala_paulo")
    group = chatmem.scope_for_group(42)

    assert dm.scope_key == "dm:mala_paulo"
    assert group.scope_key == "group:42"
    assert dm.scope_key != group.scope_key
    assert chatmem.parse_scope_key("dm:mala_paulo") == dm


def test_scope_keys_reject_ambiguous_values():
    with pytest.raises(ValueError):
        chatmem.scope_key_for_thread("feed", "123")
    with pytest.raises(ValueError):
        chatmem.scope_for_peer_dm("")
    with pytest.raises(ValueError):
        chatmem.scope_for_peer_dm("bad/path")


def test_peer_dm_scope_key_is_sorted_lowercase_when_built_from_usernames():
    assert chatmem.peer_dm_thread_id("Mala", "paulo") == "mala_paulo"
    assert chatmem.peer_dm_scope_key("paulo", "Mala") == "dm:mala_paulo"
    assert chatmem.peer_dm_scope_key("Mala", "paulo") == "dm:mala_paulo"


def test_firestore_layout_uses_single_scope_document_with_sidecar_subcollections():
    fs = _FakeFirestore()
    scope = chatmem.scope_for_peer_dm("conv-1")

    assert chatmem.memory_doc_ref(fs, scope).path == (
        chatmem.COLLECTION,
        "dm:conv-1",
    )
    assert chatmem.chunks_collection_ref(fs, scope).path == (
        chatmem.COLLECTION,
        "dm:conv-1",
        chatmem.CHUNKS_SUBCOLLECTION,
    )
    assert chatmem.events_collection_ref(fs, scope).path == (
        chatmem.COLLECTION,
        "dm:conv-1",
        chatmem.EVENTS_SUBCOLLECTION,
    )
    assert chatmem.firestore_layout_for_scope(scope) == {
        "scope": "steve_chat_memory/dm:conv-1",
        "chunks": "steve_chat_memory/dm:conv-1/chunks",
        "events": "steve_chat_memory/dm:conv-1/events",
    }


def test_config_defaults_all_memory_surfaces_off():
    cfg = chatmem.get_chat_memory_config({})

    assert cfg.enabled is False
    assert cfg.peer_dm_enabled is False
    assert cfg.group_enabled is False
    assert cfg.event_ledger_enabled is False
    assert cfg.min_messages == 200
    assert cfg.chunk_messages == 60
    assert cfg.chunk_chars == 3200
    assert cfg.top_k == 4
    assert cfg.max_prompt_chars == 3500
    assert cfg.backfill_max_messages == 4000
    assert cfg.embedding_model == ""
    assert cfg.indexing_daily_budget_usd == 0.0


def test_config_reads_expected_kb_entitlement_flags_and_clamps_values():
    cfg = chatmem.get_chat_memory_config(
        {
            "chat_memory_enabled": "true",
            "chat_memory_peer_dm_enabled": 1,
            "chat_memory_group_enabled": "yes",
            "chat_memory_min_messages": 0,
            "chat_memory_chunk_messages": -10,
            "chat_memory_chunk_chars": 50,
            "chat_memory_top_k": 0,
            "chat_memory_max_prompt_chars": 100,
            "chat_memory_backfill_max_messages": 0,
            "chat_memory_event_ledger_enabled": "on",
            "chat_memory_embedding_model": "text-embedding-3-small",
            "chat_memory_indexing_daily_budget_usd": -5,
        }
    )

    assert cfg.enabled is True
    assert cfg.peer_dm_enabled is True
    assert cfg.group_enabled is True
    assert cfg.event_ledger_enabled is True
    assert cfg.min_messages == 1
    assert cfg.chunk_messages == 1
    assert cfg.chunk_chars == 200
    assert cfg.top_k == 1
    assert cfg.max_prompt_chars == 500
    assert cfg.backfill_max_messages == 1
    assert cfg.embedding_model == "text-embedding-3-small"
    assert cfg.indexing_daily_budget_usd == 0.0


def test_chat_memory_enabled_for_scope_respects_surface_flags():
    entitlements: Dict[str, Any] = {
        "chat_memory_enabled": True,
        "chat_memory_peer_dm_enabled": True,
        "chat_memory_group_enabled": False,
    }

    assert chatmem.chat_memory_enabled_for_scope(entitlements, chatmem.scope_for_peer_dm("conv")) is True
    assert chatmem.chat_memory_enabled_for_scope(entitlements, chatmem.scope_for_group(7)) is False
    assert chatmem.chat_memory_enabled_for_surface(entitlements, surface="dm") is True
    assert chatmem.chat_memory_enabled_for_scope(
        {"chat_memory_enabled": False, "chat_memory_peer_dm_enabled": True},
        chatmem.scope_for_peer_dm("conv"),
    ) is False


def test_prompt_section_formatting_is_explicit_and_budgeted():
    text = chatmem.format_chat_memory_prompt_sections(
        relevant_chunks=[
            {
                "message_ts_start": "2025-08-14T10:00:00Z",
                "message_ts_end": "2025-08-18T12:00:00Z",
                "speakers": ["Mala", "Paulo"],
                "snippet": "Mala mentioned knee pain after deadlifts and asked for substitutions.",
            }
        ],
        counters=[
            {
                "label": "knee_pain_mentions",
                "count": 4,
                "evidence_dates": ["Jan 12", "Feb 02"],
                "confidence": "medium",
            }
        ],
        max_prompt_chars=1200,
    )

    assert "=== RELEVANT OLDER MEMORY ===" in text
    assert "- [2025-08-14 to 2025-08-18] Mala, Paulo: Mala mentioned knee pain" in text
    assert "=== STRUCTURED THREAD COUNTERS ===" in text
    assert "- knee_pain_mentions: 4" in text
    assert "Evidence dates: Jan 12, Feb 02" in text
    assert "Confidence: medium" in text


def test_prompt_formatters_return_empty_for_empty_inputs():
    assert chatmem.format_relevant_older_memory([]) == ""
    assert chatmem.format_structured_counters([]) == ""
    assert chatmem.format_chat_memory_prompt_sections() == ""


def test_reset_and_privacy_filter_excludes_unsafe_or_old_records():
    reset_at = "2026-05-01T00:00:00Z"
    safe_record = {"message_ts_end": "2026-05-02T12:00:00Z", "snippet": "after reset"}
    old_record = {"message_ts_end": "2026-04-30T23:59:00Z", "snippet": "before reset"}
    stale_record = {"message_ts_end": "2026-05-02T12:00:00Z", "stale": True}
    deleted_record = {"message_ts_end": "2026-05-02T12:00:00Z", "deleted_at": "2026-05-03T00:00:00Z"}
    encrypted_record = {"message_ts_end": "2026-05-02T12:00:00Z", "encrypted": True}

    assert chatmem.should_include_memory_record(safe_record, reset_at=reset_at) is True
    assert chatmem.should_include_memory_record(old_record, reset_at=reset_at) is False
    assert chatmem.should_include_memory_record(stale_record, reset_at=reset_at) is False
    assert chatmem.should_include_memory_record(deleted_record, reset_at=reset_at) is False
    assert chatmem.should_include_memory_record(encrypted_record, reset_at=reset_at) is False
    assert chatmem.filter_memory_records(
        [safe_record, old_record, stale_record, deleted_record, encrypted_record],
        reset_at=reset_at,
    ) == [safe_record]


def test_reset_filter_accepts_firestore_like_timestamp_objects():
    class _Timestamp:
        def __init__(self, value: datetime):
            self.value = value

        def timestamp(self):
            return self.value.timestamp()

    reset_at = _Timestamp(datetime(2026, 5, 1, 0, 0, 0))
    record = {"message_ts_end": _Timestamp(datetime(2026, 5, 1, 1, 0, 0))}

    assert chatmem.should_include_memory_record(record, reset_at=reset_at) is True
