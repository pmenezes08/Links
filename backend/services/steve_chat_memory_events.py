"""Structured event extraction and counter aggregation for Steve Phase 3.

Deterministic, regex/keyword-based event detection with NO LLM calls.
Events are stored in the ``events`` subcollection of each
``steve_chat_memory/{scope_key}`` doc and aggregated at query time to
answer count-style questions ("how many times did I exercise this week?").

No ``ai_usage`` rows are written — this module is pure read/aggregate.
"""

from __future__ import annotations

import logging
import re
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence

from backend.services.steve_chat_memory import (
    ChatMemoryConfig,
    ThreadMemoryScope,
    events_collection_ref,
    format_structured_counters,
    get_chat_memory_config,
    parse_memory_datetime,
    should_include_memory_record,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event types (extensible string constants)
# ---------------------------------------------------------------------------

EVENT_EXERCISE = "exercise"
EVENT_MEAL = "meal"
EVENT_MOOD = "mood"
EVENT_GOAL_SET = "goal_set"
EVENT_PHOTO_SHARED = "photo_shared"
EVENT_LINK_SHARED = "link_shared"
EVENT_QUESTION_ASKED = "question_asked"
EVENT_COMPLIMENT = "compliment"
EVENT_CUSTOM = "custom"

ALL_EVENT_TYPES = frozenset({
    EVENT_EXERCISE,
    EVENT_MEAL,
    EVENT_MOOD,
    EVENT_GOAL_SET,
    EVENT_PHOTO_SHARED,
    EVENT_LINK_SHARED,
    EVENT_QUESTION_ASKED,
    EVENT_COMPLIMENT,
    EVENT_CUSTOM,
})


# ---------------------------------------------------------------------------
# Detection patterns — conservative; false negatives > false positives
# ---------------------------------------------------------------------------

_EXERCISE_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b(?:gym|workout|work out|exercise|exercised|exercising)\b", re.I),
    re.compile(r"\b(?:ran|running|jogging|jogged)\b", re.I),
    re.compile(r"\b(?:walked|walking|hike|hiked|hiking)\b", re.I),
    re.compile(r"\b(?:trained|training)\b", re.I),
    re.compile(r"\b(?:leg day|arm day|chest day|back day|push day|pull day)\b", re.I),
    re.compile(r"\b(?:cardio|lifted|lifting|weights|squats?|deadlift|bench press)\b", re.I),
    re.compile(r"\b(?:yoga|pilates|swim|swam|swimming|cycling|cycled)\b", re.I),
    re.compile(r"\b(?:crossfit|calisthenics|stretching|stretches)\b", re.I),
]

_MEAL_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b(?:ate|eating|eaten)\b", re.I),
    re.compile(r"\b(?:breakfast|lunch|dinner|brunch|supper)\b", re.I),
    re.compile(r"\b(?:cooked|cooking|baked|baking)\b", re.I),
    re.compile(r"\b(?:meal|meals)\b", re.I),
]

_MOOD_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b(?:feeling|felt)\s+(?:happy|sad|anxious|stressed|great|terrible|amazing|awful|down|excited|grateful|angry|frustrated|calm|relaxed)\b", re.I),
    re.compile(r"\bi(?:'m| am)\s+(?:happy|sad|anxious|stressed|great|terrible|amazing|awful|down|excited|grateful|angry|frustrated|calm|relaxed)\b", re.I),
]

_GOAL_SET_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b(?:my goal|set a goal|new goal|want to achieve|going to start|committed to)\b", re.I),
]

_QUESTION_PATTERNS: list[re.Pattern] = [
    re.compile(r"^[^.!]*\?\s*$", re.M),
]

_COMPLIMENT_PATTERNS: list[re.Pattern] = [
    re.compile(r"\b(?:you(?:'re| are) (?:the best|amazing|awesome|great|incredible|wonderful))\b", re.I),
    re.compile(r"\b(?:proud of you|love (?:that|this)|well done|good job|nice work|great job|keep it up)\b", re.I),
]

_URL_PATTERN = re.compile(r"https?://[^\s<>\"']+", re.I)


# ---------------------------------------------------------------------------
# Event extraction (deterministic, no LLM)
# ---------------------------------------------------------------------------

def extract_events_from_message(
    sender: str,
    text: str,
    *,
    has_media: bool = False,
    ts: Optional[datetime] = None,
    message_id: str = "",
) -> list[dict]:
    """Extract structured events from a single message using regex/keywords.

    Returns a list of event dicts, each with:
    ``{event_type, label, sender, timestamp, evidence_snippet, message_id}``

    Conservative: prefers false negatives over false positives.
    """
    events: list[dict] = []
    clean_text = (text or "").strip()
    timestamp = ts or datetime.now(timezone.utc).replace(tzinfo=None)
    if isinstance(timestamp, datetime) and timestamp.tzinfo is not None:
        timestamp = timestamp.astimezone(timezone.utc).replace(tzinfo=None)

    sender_clean = (sender or "").strip()

    def _add(event_type: str, label: str, snippet: str = "") -> None:
        events.append({
            "event_type": event_type,
            "label": label,
            "sender": sender_clean,
            "timestamp": timestamp,
            "evidence_snippet": (snippet or clean_text)[:200],
            "message_id": message_id,
        })

    if has_media:
        _add(EVENT_PHOTO_SHARED, "photo shared")

    if clean_text:
        if _URL_PATTERN.search(clean_text):
            _add(EVENT_LINK_SHARED, "link shared")

        for pat in _EXERCISE_PATTERNS:
            m = pat.search(clean_text)
            if m:
                _add(EVENT_EXERCISE, f"exercise: {m.group(0).lower()}")
                break

        for pat in _MEAL_PATTERNS:
            m = pat.search(clean_text)
            if m:
                _add(EVENT_MEAL, f"meal: {m.group(0).lower()}")
                break

        for pat in _MOOD_PATTERNS:
            m = pat.search(clean_text)
            if m:
                _add(EVENT_MOOD, f"mood: {m.group(0).lower()}")
                break

        for pat in _GOAL_SET_PATTERNS:
            m = pat.search(clean_text)
            if m:
                _add(EVENT_GOAL_SET, f"goal: {m.group(0).lower()}")
                break

        for pat in _COMPLIMENT_PATTERNS:
            m = pat.search(clean_text)
            if m:
                _add(EVENT_COMPLIMENT, f"compliment: {m.group(0).lower()}")
                break

        for pat in _QUESTION_PATTERNS:
            m = pat.search(clean_text)
            if m:
                _add(EVENT_QUESTION_ASKED, "question asked")
                break

    return events


# ---------------------------------------------------------------------------
# Chunk-level extraction
# ---------------------------------------------------------------------------

def _parse_chunk_messages(chunk: Any) -> list[dict]:
    """Parse individual message rows from a ChunkRecord.

    Each line in ``chunk.text`` follows the format produced by
    ``message_line_from_row``: ``[HH:MM] sender: body`` or ``sender: body``.
    """
    text = ""
    source_message_ids: list[str] = []
    senders_map: dict[str, int] = {}

    if hasattr(chunk, "text"):
        text = chunk.text or ""
        source_message_ids = getattr(chunk, "source_message_ids", []) or []
        senders_map = getattr(chunk, "senders", {}) or {}
    elif isinstance(chunk, Mapping):
        text = str(chunk.get("text") or "")
        source_message_ids = chunk.get("source_message_ids") or []
        senders_map = chunk.get("senders") or {}

    ts_start = None
    if hasattr(chunk, "message_ts_start"):
        ts_start = chunk.message_ts_start
    elif isinstance(chunk, Mapping):
        ts_start = parse_memory_datetime(chunk.get("message_ts_start"))

    lines = text.split("\n")
    messages: list[dict] = []
    line_pattern = re.compile(r"^(?:\[[^\]]*\]\s*)?(\S+?):\s+(.+)$")

    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        m = line_pattern.match(line)
        if not m:
            continue
        sender = m.group(1)
        body = m.group(2)
        msg_id = source_message_ids[i] if i < len(source_message_ids) else ""
        has_media = body.strip() == "[shared a photo]"
        messages.append({
            "sender": sender,
            "text": "" if has_media else body,
            "has_media": has_media,
            "message_id": msg_id,
            "timestamp": ts_start,
        })

    return messages


def index_events_from_chunk(
    scope: ThreadMemoryScope,
    chunk: Any,
) -> list[dict]:
    """Extract events from all messages in a chunk.

    Returns event docs ready for Firestore write (includes scope_key,
    source_chunk_id).
    """
    chunk_id = ""
    if hasattr(chunk, "chunk_id"):
        chunk_id = chunk.chunk_id or ""
    elif isinstance(chunk, Mapping):
        chunk_id = str(chunk.get("chunk_id") or "")

    messages = _parse_chunk_messages(chunk)
    all_events: list[dict] = []

    for msg in messages:
        raw_events = extract_events_from_message(
            msg["sender"],
            msg["text"],
            has_media=msg.get("has_media", False),
            ts=msg.get("timestamp"),
            message_id=msg.get("message_id", ""),
        )
        for evt in raw_events:
            evt["scope_key"] = scope.scope_key
            evt["source_chunk_id"] = chunk_id
            evt["source_message_id"] = evt.pop("message_id", "")
            evt["event_id"] = uuid.uuid4().hex[:20]
            all_events.append(evt)

    return all_events


# ---------------------------------------------------------------------------
# Firestore write
# ---------------------------------------------------------------------------

def write_events(
    fs_client: Any,
    scope: ThreadMemoryScope,
    events: list[dict],
) -> int:
    """Write event docs to ``steve_chat_memory/{scope_key}/events/{event_id}``.

    Returns count of events written. Non-fatal on individual write failures.
    """
    if not events:
        return 0

    events_ref = events_collection_ref(fs_client, scope)
    written = 0

    for evt in events:
        event_id = evt.get("event_id") or uuid.uuid4().hex[:20]
        doc_data = {
            "scope_key": evt.get("scope_key", scope.scope_key),
            "event_type": evt.get("event_type", ""),
            "label": evt.get("label", ""),
            "sender": evt.get("sender", ""),
            "timestamp": _serialise_ts(evt.get("timestamp")),
            "evidence_snippet": evt.get("evidence_snippet", "")[:200],
            "source_chunk_id": evt.get("source_chunk_id", ""),
            "source_message_id": evt.get("source_message_id", ""),
            "created_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
        }
        try:
            events_ref.document(event_id).set(doc_data)
            written += 1
        except Exception as exc:
            logger.warning(
                "write_events: failed to write event %s for %s: %s",
                event_id, scope.scope_key, exc,
            )

    return written


# ---------------------------------------------------------------------------
# Counter query / aggregation
# ---------------------------------------------------------------------------

def query_counters(
    fs_client: Any,
    scope: ThreadMemoryScope,
    *,
    event_types: Optional[list[str]] = None,
    since: Optional[datetime] = None,
    reset_at: Any = None,
) -> list[dict]:
    """Read events subcollection, filter, and aggregate into counter dicts.

    Returns list of ``{event_type, label, count, evidence_dates, confidence}``.
    """
    reset_dt = parse_memory_datetime(reset_at)
    since_dt = parse_memory_datetime(since)

    try:
        events_ref = events_collection_ref(fs_client, scope)
        docs = list(events_ref.stream())
    except Exception as exc:
        logger.warning(
            "query_counters: failed to read events for %s: %s",
            scope.scope_key, exc,
        )
        return []

    type_filter = frozenset(event_types) if event_types else None

    buckets: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
        "event_type": "",
        "label": "",
        "count": 0,
        "evidence_dates": [],
        "confidence": "keyword-match",
    })

    for doc in docs:
        data = doc.to_dict() if hasattr(doc, "to_dict") else (doc or {})

        if not should_include_memory_record(data, reset_at=reset_at):
            continue

        evt_type = str(data.get("event_type") or "").strip()
        if not evt_type:
            continue
        if type_filter and evt_type not in type_filter:
            continue

        evt_ts = parse_memory_datetime(data.get("timestamp"))
        if reset_dt and evt_ts and evt_ts < reset_dt:
            continue
        if since_dt and evt_ts and evt_ts < since_dt:
            continue

        label = str(data.get("label") or evt_type).strip()
        bucket_key = f"{evt_type}::{label}"

        bucket = buckets[bucket_key]
        bucket["event_type"] = evt_type
        bucket["label"] = label
        bucket["count"] += 1
        if evt_ts:
            bucket["evidence_dates"].append(evt_ts.date().isoformat())

    result = sorted(buckets.values(), key=lambda b: b["count"], reverse=True)
    for r in result:
        r["evidence_dates"] = sorted(set(r["evidence_dates"]))
    return result


# ---------------------------------------------------------------------------
# Count-intent detection (deterministic)
# ---------------------------------------------------------------------------

_COUNT_INTENT_PATTERNS: list[re.Pattern] = [
    re.compile(r"\bhow many\b", re.I),
    re.compile(r"\bhow often\b", re.I),
    re.compile(r"\bcount\b", re.I),
    re.compile(r"\btotal\b", re.I),
    re.compile(r"\btimes did\b", re.I),
    re.compile(r"\btimes have\b", re.I),
    re.compile(r"\bhow frequently\b", re.I),
    re.compile(r"\bwhen.+last\b", re.I),
]


def has_count_intent(user_message: str) -> bool:
    """Return True if the message asks a count/frequency question."""
    if not user_message:
        return False
    text = user_message.strip()
    return any(p.search(text) for p in _COUNT_INTENT_PATTERNS)


# ---------------------------------------------------------------------------
# Orchestration: inject counters into prompt context
# ---------------------------------------------------------------------------

def inject_counters_into_context(
    fs_client: Any,
    scope: ThreadMemoryScope,
    user_message: str,
    *,
    entitlements: Optional[Mapping[str, Any]] = None,
    reset_at: Any = None,
) -> str:
    """Check config + intent, query counters, format via skeleton helper.

    Returns formatted counter section string or ``""`` if counters are
    disabled, no count intent, or no events found.
    """
    config = get_chat_memory_config(entitlements)
    if not config.event_ledger_enabled:
        return ""

    if not has_count_intent(user_message):
        return ""

    try:
        counters = query_counters(
            fs_client,
            scope,
            reset_at=reset_at,
        )
    except Exception as exc:
        logger.warning(
            "inject_counters_into_context: query failed for %s: %s",
            scope.scope_key, exc,
        )
        return ""

    if not counters:
        return ""

    return format_structured_counters(counters, max_chars=1600)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialise_ts(value: Any) -> Optional[str]:
    dt = parse_memory_datetime(value)
    if dt is None:
        return None
    return dt.isoformat() + "Z"
