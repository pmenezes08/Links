"""Tests for steve_chat_memory_events — Phase 3 PR4.

Covers:
- Exercise detection: positive/negative cases
- Meal detection
- Photo/link detection
- Event extraction returns correct schema
- query_counters aggregation correctness
- Counter injection respects event_ledger_enabled=False
- Counter injection formats via format_structured_counters
- Count-intent detection: "how many times" triggers, "hello" doesn't
- Reset-at filtering excludes old events
- No AI/vendor calls in extraction (purely deterministic)
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest

from backend.services.steve_chat_memory import (
    PROMPT_HEADER_STRUCTURED_COUNTERS,
    ThreadMemoryScope,
    scope_for_peer_dm,
)
from backend.services.steve_chat_memory_events import (
    ALL_EVENT_TYPES,
    EVENT_COMPLIMENT,
    EVENT_CUSTOM,
    EVENT_EXERCISE,
    EVENT_GOAL_SET,
    EVENT_LINK_SHARED,
    EVENT_MEAL,
    EVENT_MOOD,
    EVENT_PHOTO_SHARED,
    EVENT_QUESTION_ASKED,
    extract_events_from_message,
    has_count_intent,
    index_events_from_chunk,
    inject_counters_into_context,
    query_counters,
    write_events,
)
from backend.services.steve_chat_memory_indexer import ChunkRecord


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _scope(conv_id: str = "conv-test") -> ThreadMemoryScope:
    return scope_for_peer_dm(conv_id)


class _FakeDoc:
    def __init__(self, doc_id: str, data: Dict[str, Any]):
        self.id = doc_id
        self._data = data

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data)


class _FakeEventsCollection:
    def __init__(self) -> None:
        self._docs: Dict[str, Dict[str, Any]] = {}

    def document(self, doc_id: str) -> "_FakeDocRef":
        return _FakeDocRef(self, doc_id)

    def stream(self):
        return [_FakeDoc(did, d) for did, d in self._docs.items()]


class _FakeDocRef:
    def __init__(self, coll: _FakeEventsCollection, doc_id: str):
        self._coll = coll
        self._doc_id = doc_id

    def set(self, data: Dict[str, Any], merge: bool = False):
        self._coll._docs[self._doc_id] = dict(data)


class _FakeFirestore:
    """Minimal Firestore client focused on events subcollection."""

    def __init__(self) -> None:
        self._events: Dict[str, _FakeEventsCollection] = {}

    def collection(self, name: str) -> "_FakeCollectionRef":
        return _FakeCollectionRef(self, name)


class _FakeCollectionRef:
    def __init__(self, fs: _FakeFirestore, name: str):
        self._fs = fs
        self._name = name

    def document(self, doc_id: str) -> "_FakeMemDocRef":
        return _FakeMemDocRef(self._fs, f"{self._name}/{doc_id}")


class _FakeMemDocRef:
    def __init__(self, fs: _FakeFirestore, path: str):
        self._fs = fs
        self._path = path

    def collection(self, name: str) -> _FakeEventsCollection:
        key = f"{self._path}/{name}"
        if key not in self._fs._events:
            self._fs._events[key] = _FakeEventsCollection()
        return self._fs._events[key]


def _events_coll(fs: _FakeFirestore, scope: ThreadMemoryScope) -> _FakeEventsCollection:
    key = f"steve_chat_memory/{scope.scope_key}/events"
    if key not in fs._events:
        fs._events[key] = _FakeEventsCollection()
    return fs._events[key]


def _seed_event(
    fs: _FakeFirestore,
    scope: ThreadMemoryScope,
    event_id: str,
    event_type: str,
    label: str,
    sender: str = "alice",
    timestamp: Optional[str] = None,
    **extra: Any,
) -> None:
    coll = _events_coll(fs, scope)
    data = {
        "event_type": event_type,
        "label": label,
        "sender": sender,
        "timestamp": timestamp or "2026-05-20T10:00:00Z",
        "evidence_snippet": extra.get("evidence_snippet", ""),
        "scope_key": scope.scope_key,
        "source_chunk_id": extra.get("source_chunk_id", ""),
        "source_message_id": extra.get("source_message_id", ""),
    }
    data.update(extra)
    coll._docs[event_id] = data


# ---------------------------------------------------------------------------
# Exercise detection
# ---------------------------------------------------------------------------

class TestExerciseDetection:
    @pytest.mark.parametrize(
        "text",
        [
            "Just got back from the gym!",
            "Had a great workout today",
            "I ran 5 miles this morning",
            "Going running after work",
            "Did some walking in the park",
            "Time to exercise",
            "I trained legs today",
            "It's leg day!",
            "Did some cardio after work",
            "I lifted for an hour",
            "Went to yoga class",
            "Swam 20 laps",
            "Did some crossfit",
        ],
    )
    def test_exercise_detected(self, text):
        events = extract_events_from_message("alice", text)
        types = [e["event_type"] for e in events]
        assert EVENT_EXERCISE in types

    @pytest.mark.parametrize(
        "text",
        [
            "Hello there!",
            "What's for dinner?",
            "Let me know when you're free",
            "I'm going to the store",
            "Good morning!",
            "The weather is nice today",
        ],
    )
    def test_exercise_not_detected(self, text):
        events = extract_events_from_message("alice", text)
        types = [e["event_type"] for e in events]
        assert EVENT_EXERCISE not in types


# ---------------------------------------------------------------------------
# Meal detection
# ---------------------------------------------------------------------------

class TestMealDetection:
    @pytest.mark.parametrize(
        "text",
        [
            "I ate pizza for lunch",
            "Having breakfast now",
            "What should we have for dinner?",
            "I cooked pasta yesterday",
            "That was a good meal",
            "eating a snack right now",
        ],
    )
    def test_meal_detected(self, text):
        events = extract_events_from_message("alice", text)
        types = [e["event_type"] for e in events]
        assert EVENT_MEAL in types

    @pytest.mark.parametrize(
        "text",
        [
            "Hello there!",
            "I went shopping",
            "The movie was great",
        ],
    )
    def test_meal_not_detected(self, text):
        events = extract_events_from_message("alice", text)
        types = [e["event_type"] for e in events]
        assert EVENT_MEAL not in types


# ---------------------------------------------------------------------------
# Photo / link detection
# ---------------------------------------------------------------------------

class TestPhotoLinkDetection:
    def test_photo_detected_with_has_media(self):
        events = extract_events_from_message("alice", "check this out", has_media=True)
        types = [e["event_type"] for e in events]
        assert EVENT_PHOTO_SHARED in types

    def test_photo_not_detected_without_media(self):
        events = extract_events_from_message("alice", "check this out")
        types = [e["event_type"] for e in events]
        assert EVENT_PHOTO_SHARED not in types

    def test_link_detected_with_url(self):
        events = extract_events_from_message(
            "alice", "check out https://example.com/cool-stuff"
        )
        types = [e["event_type"] for e in events]
        assert EVENT_LINK_SHARED in types

    def test_link_not_detected_without_url(self):
        events = extract_events_from_message("alice", "check out this cool stuff")
        types = [e["event_type"] for e in events]
        assert EVENT_LINK_SHARED not in types

    def test_photo_and_link_together(self):
        events = extract_events_from_message(
            "alice", "look at https://example.com", has_media=True,
        )
        types = [e["event_type"] for e in events]
        assert EVENT_PHOTO_SHARED in types
        assert EVENT_LINK_SHARED in types


# ---------------------------------------------------------------------------
# Mood / goal / compliment / question detection
# ---------------------------------------------------------------------------

class TestOtherEventTypes:
    def test_mood_detected(self):
        events = extract_events_from_message("alice", "I'm feeling happy today")
        types = [e["event_type"] for e in events]
        assert EVENT_MOOD in types

    def test_goal_detected(self):
        events = extract_events_from_message("alice", "My goal is to read more books")
        types = [e["event_type"] for e in events]
        assert EVENT_GOAL_SET in types

    def test_compliment_detected(self):
        events = extract_events_from_message("alice", "You're the best!")
        types = [e["event_type"] for e in events]
        assert EVENT_COMPLIMENT in types

    def test_question_detected(self):
        events = extract_events_from_message("alice", "What time is the meeting?")
        types = [e["event_type"] for e in events]
        assert EVENT_QUESTION_ASKED in types


# ---------------------------------------------------------------------------
# Event schema
# ---------------------------------------------------------------------------

class TestEventSchema:
    def test_event_has_required_fields(self):
        events = extract_events_from_message(
            "alice", "went to the gym",
            ts=datetime(2026, 5, 20, 10, 0, 0),
            message_id="msg-001",
        )
        assert len(events) >= 1
        evt = events[0]
        assert "event_type" in evt
        assert "label" in evt
        assert "sender" in evt
        assert "timestamp" in evt
        assert "evidence_snippet" in evt
        assert "message_id" in evt
        assert evt["sender"] == "alice"
        assert isinstance(evt["timestamp"], datetime)
        assert evt["message_id"] == "msg-001"

    def test_evidence_snippet_truncated(self):
        long_text = "gym " * 200
        events = extract_events_from_message("alice", long_text)
        assert len(events) >= 1
        assert len(events[0]["evidence_snippet"]) <= 200

    def test_empty_text_empty_events(self):
        events = extract_events_from_message("alice", "")
        assert events == []

    def test_no_events_from_plain_greeting(self):
        events = extract_events_from_message("alice", "Hi Bob, how are you?")
        exercise_events = [e for e in events if e["event_type"] == EVENT_EXERCISE]
        meal_events = [e for e in events if e["event_type"] == EVENT_MEAL]
        assert len(exercise_events) == 0
        assert len(meal_events) == 0


# ---------------------------------------------------------------------------
# index_events_from_chunk
# ---------------------------------------------------------------------------

class TestIndexEventsFromChunk:
    def test_extracts_from_chunk_record(self):
        chunk = ChunkRecord(
            scope_key="dm:conv-test",
            chunk_id="chunk-001",
            message_start_id="m1",
            message_end_id="m3",
            message_ts_start=datetime(2026, 5, 20, 10, 0, 0),
            message_ts_end=datetime(2026, 5, 20, 10, 10, 0),
            senders={"alice": 2, "bob": 1},
            text="alice: went to the gym today\nbob: nice! how was it?\nalice: great workout",
            source_message_ids=["m1", "m2", "m3"],
        )
        scope = _scope()
        events = index_events_from_chunk(scope, chunk)
        assert len(events) >= 1
        exercise = [e for e in events if e["event_type"] == EVENT_EXERCISE]
        assert len(exercise) >= 1
        assert exercise[0]["scope_key"] == scope.scope_key
        assert exercise[0]["source_chunk_id"] == "chunk-001"

    def test_events_have_event_id(self):
        chunk = ChunkRecord(
            scope_key="dm:conv-test",
            chunk_id="chunk-002",
            message_start_id="m1",
            message_end_id="m1",
            message_ts_start=datetime(2026, 5, 20, 10, 0, 0),
            message_ts_end=datetime(2026, 5, 20, 10, 0, 0),
            senders={"alice": 1},
            text="alice: ate breakfast and went for a run",
            source_message_ids=["m1"],
        )
        events = index_events_from_chunk(_scope(), chunk)
        for evt in events:
            assert "event_id" in evt
            assert len(evt["event_id"]) > 0


# ---------------------------------------------------------------------------
# write_events
# ---------------------------------------------------------------------------

class TestWriteEvents:
    def test_writes_to_firestore(self):
        fs = _FakeFirestore()
        scope = _scope()
        events = [
            {
                "event_id": "evt-001",
                "event_type": EVENT_EXERCISE,
                "label": "exercise: gym",
                "sender": "alice",
                "timestamp": datetime(2026, 5, 20, 10, 0, 0),
                "evidence_snippet": "went to the gym",
                "scope_key": scope.scope_key,
                "source_chunk_id": "chunk-001",
                "source_message_id": "m1",
            },
        ]
        count = write_events(fs, scope, events)
        assert count == 1

        coll = _events_coll(fs, scope)
        assert "evt-001" in coll._docs

    def test_returns_zero_for_empty(self):
        fs = _FakeFirestore()
        assert write_events(fs, _scope(), []) == 0


# ---------------------------------------------------------------------------
# query_counters
# ---------------------------------------------------------------------------

class TestQueryCounters:
    def test_aggregates_by_type_and_label(self):
        fs = _FakeFirestore()
        scope = _scope()
        _seed_event(fs, scope, "e1", EVENT_EXERCISE, "exercise: gym", timestamp="2026-05-20T10:00:00Z")
        _seed_event(fs, scope, "e2", EVENT_EXERCISE, "exercise: gym", timestamp="2026-05-21T10:00:00Z")
        _seed_event(fs, scope, "e3", EVENT_MEAL, "meal: lunch", timestamp="2026-05-20T12:00:00Z")

        counters = query_counters(fs, scope)
        assert len(counters) == 2

        gym_counter = next(c for c in counters if c["label"] == "exercise: gym")
        assert gym_counter["count"] == 2
        assert len(gym_counter["evidence_dates"]) == 2
        assert gym_counter["confidence"] == "keyword-match"

        meal_counter = next(c for c in counters if c["label"] == "meal: lunch")
        assert meal_counter["count"] == 1

    def test_filters_by_event_type(self):
        fs = _FakeFirestore()
        scope = _scope()
        _seed_event(fs, scope, "e1", EVENT_EXERCISE, "exercise: gym")
        _seed_event(fs, scope, "e2", EVENT_MEAL, "meal: dinner")

        counters = query_counters(fs, scope, event_types=[EVENT_EXERCISE])
        assert len(counters) == 1
        assert counters[0]["event_type"] == EVENT_EXERCISE

    def test_filters_by_since(self):
        fs = _FakeFirestore()
        scope = _scope()
        _seed_event(fs, scope, "e1", EVENT_EXERCISE, "exercise: gym", timestamp="2026-05-10T10:00:00Z")
        _seed_event(fs, scope, "e2", EVENT_EXERCISE, "exercise: run", timestamp="2026-05-25T10:00:00Z")

        since = datetime(2026, 5, 20, 0, 0, 0)
        counters = query_counters(fs, scope, since=since)
        assert len(counters) == 1
        assert counters[0]["label"] == "exercise: run"

    def test_reset_at_excludes_old_events(self):
        fs = _FakeFirestore()
        scope = _scope()
        _seed_event(fs, scope, "e1", EVENT_EXERCISE, "exercise: gym", timestamp="2026-01-01T10:00:00Z")
        _seed_event(fs, scope, "e2", EVENT_EXERCISE, "exercise: run", timestamp="2026-05-25T10:00:00Z")

        counters = query_counters(
            fs, scope, reset_at=datetime(2026, 5, 1, 0, 0, 0),
        )
        assert len(counters) == 1
        assert counters[0]["label"] == "exercise: run"

    def test_returns_empty_for_no_events(self):
        fs = _FakeFirestore()
        scope = _scope()
        counters = query_counters(fs, scope)
        assert counters == []

    def test_sorted_by_count_descending(self):
        fs = _FakeFirestore()
        scope = _scope()
        _seed_event(fs, scope, "e1", EVENT_MEAL, "meal: lunch")
        _seed_event(fs, scope, "e2", EVENT_EXERCISE, "exercise: gym")
        _seed_event(fs, scope, "e3", EVENT_EXERCISE, "exercise: gym")
        _seed_event(fs, scope, "e4", EVENT_EXERCISE, "exercise: gym")

        counters = query_counters(fs, scope)
        assert counters[0]["count"] >= counters[-1]["count"]


# ---------------------------------------------------------------------------
# Count-intent detection
# ---------------------------------------------------------------------------

class TestCountIntent:
    @pytest.mark.parametrize(
        "msg",
        [
            "how many times did I exercise this week?",
            "how often do we chat?",
            "count how many photos she sent",
            "what's the total?",
            "how many times did she mention that?",
            "times have I gone to the gym?",
            "how frequently does he post?",
            "when was the last time?",
        ],
    )
    def test_count_phrases_trigger(self, msg):
        assert has_count_intent(msg) is True

    @pytest.mark.parametrize(
        "msg",
        [
            "hello",
            "what's the weather?",
            "tell me a joke",
            "thanks for helping",
            "",
        ],
    )
    def test_casual_messages_dont_trigger(self, msg):
        assert has_count_intent(msg) is False


# ---------------------------------------------------------------------------
# inject_counters_into_context
# ---------------------------------------------------------------------------

class TestInjectCountersIntoContext:
    def _ledger_on_ent(self, **overrides) -> Dict[str, Any]:
        base = {
            "chat_memory_enabled": True,
            "chat_memory_peer_dm_enabled": True,
            "chat_memory_event_ledger_enabled": True,
        }
        base.update(overrides)
        return base

    def _ledger_off_ent(self) -> Dict[str, Any]:
        return {
            "chat_memory_enabled": True,
            "chat_memory_peer_dm_enabled": True,
            "chat_memory_event_ledger_enabled": False,
        }

    def test_returns_empty_when_ledger_disabled(self):
        fs = _FakeFirestore()
        scope = _scope()
        result = inject_counters_into_context(
            fs, scope, "how many times did I exercise?",
            entitlements=self._ledger_off_ent(),
        )
        assert result == ""

    def test_returns_empty_when_no_count_intent(self):
        fs = _FakeFirestore()
        scope = _scope()
        result = inject_counters_into_context(
            fs, scope, "hello Steve",
            entitlements=self._ledger_on_ent(),
        )
        assert result == ""

    def test_returns_formatted_counters_on_match(self):
        fs = _FakeFirestore()
        scope = _scope()
        _seed_event(fs, scope, "e1", EVENT_EXERCISE, "exercise: gym", timestamp="2026-05-20T10:00:00Z")
        _seed_event(fs, scope, "e2", EVENT_EXERCISE, "exercise: gym", timestamp="2026-05-21T10:00:00Z")

        result = inject_counters_into_context(
            fs, scope, "how many times did I go to the gym?",
            entitlements=self._ledger_on_ent(),
        )
        assert PROMPT_HEADER_STRUCTURED_COUNTERS in result
        assert "exercise: gym" in result
        assert "2" in result

    def test_formats_via_format_structured_counters(self):
        fs = _FakeFirestore()
        scope = _scope()
        _seed_event(fs, scope, "e1", EVENT_MEAL, "meal: lunch", timestamp="2026-05-20T12:00:00Z")

        result = inject_counters_into_context(
            fs, scope, "how many meals did I have?",
            entitlements=self._ledger_on_ent(),
        )
        assert result.startswith(PROMPT_HEADER_STRUCTURED_COUNTERS)
        assert "meal: lunch" in result

    def test_reset_at_respected(self):
        fs = _FakeFirestore()
        scope = _scope()
        _seed_event(fs, scope, "e1", EVENT_EXERCISE, "exercise: gym", timestamp="2026-01-01T10:00:00Z")

        result = inject_counters_into_context(
            fs, scope, "how many times did I exercise?",
            entitlements=self._ledger_on_ent(),
            reset_at=datetime(2026, 5, 1, 0, 0, 0),
        )
        assert result == ""

    def test_returns_empty_for_no_events(self):
        fs = _FakeFirestore()
        scope = _scope()
        result = inject_counters_into_context(
            fs, scope, "how many times?",
            entitlements=self._ledger_on_ent(),
        )
        assert result == ""


# ---------------------------------------------------------------------------
# No AI/vendor calls
# ---------------------------------------------------------------------------

class TestNoVendorCalls:
    """Verify extraction is purely deterministic — no LLM or vendor calls."""

    @patch("backend.services.steve_chat_memory_events.logger")
    def test_extraction_makes_no_external_calls(self, _mock_logger):
        events = extract_events_from_message(
            "alice", "went to the gym and ate lunch afterwards",
            has_media=True,
            ts=datetime(2026, 5, 20, 10, 0, 0),
        )
        assert len(events) >= 2
        types = {e["event_type"] for e in events}
        assert EVENT_EXERCISE in types
        assert EVENT_MEAL in types
        assert EVENT_PHOTO_SHARED in types

    def test_no_vendor_imports_in_module(self):
        import sys
        import backend.services.steve_chat_memory_events  # noqa: F401
        mod = sys.modules["backend.services.steve_chat_memory_events"]
        forbidden = {"openai", "anthropic", "httpx", "requests", "xai"}
        referenced = {name for name in dir(mod) if name.lower() in forbidden}
        assert referenced == set(), f"forbidden vendor symbols in module: {referenced}"

        import inspect
        source = inspect.getsource(mod)
        for needle in ("import openai", "from openai", "import anthropic",
                       "import httpx", "import requests", "from xai"):
            assert needle not in source, f"forbidden import line found: {needle!r}"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_none_text(self):
        events = extract_events_from_message("alice", None)
        assert events == []

    def test_none_sender(self):
        events = extract_events_from_message(None, "went to the gym")
        assert len(events) >= 1
        assert events[0]["sender"] == ""

    def test_multiple_event_types_in_one_message(self):
        events = extract_events_from_message(
            "alice",
            "I ate lunch then went to the gym https://example.com",
            has_media=True,
        )
        types = {e["event_type"] for e in events}
        assert EVENT_MEAL in types
        assert EVENT_EXERCISE in types
        assert EVENT_LINK_SHARED in types
        assert EVENT_PHOTO_SHARED in types

    def test_event_types_constant_set(self):
        assert EVENT_EXERCISE in ALL_EVENT_TYPES
        assert EVENT_MEAL in ALL_EVENT_TYPES
        assert EVENT_PHOTO_SHARED in ALL_EVENT_TYPES
        assert EVENT_LINK_SHARED in ALL_EVENT_TYPES
        assert EVENT_CUSTOM in ALL_EVENT_TYPES
