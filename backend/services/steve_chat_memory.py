"""Exact-scope chat memory skeleton for Steve Phase 3.

This module is intentionally deterministic and vendor-free. It defines the
thread scope, Firestore sidecar layout, KB/entitlement-backed config parsing,
prompt formatting, and privacy/reset filters that later indexing/retrieval PRs
can build on without changing the thread boundary contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import logging
from typing import Any, Iterable, Mapping, Optional, Sequence

logger = logging.getLogger(__name__)

SURFACE_DM = "dm"
SURFACE_PEER_DM = SURFACE_DM
SURFACE_GROUP = "group"
SUPPORTED_SURFACES = frozenset({SURFACE_DM, SURFACE_GROUP})

SCOPE_PREFIX_DM = SURFACE_DM
SCOPE_PREFIX_GROUP = SURFACE_GROUP

COLLECTION = "steve_chat_memory"
CHUNKS_SUBCOLLECTION = "chunks"
EVENTS_SUBCOLLECTION = "events"

FIELD_SCOPE_KEY = "scope_key"
FIELD_SURFACE = "surface"
FIELD_THREAD_ID = "thread_id"
FIELD_STALE = "stale"
FIELD_INVALIDATED = "invalidated"
FIELD_IS_DELETED = "is_deleted"
FIELD_DELETED_AT = "deleted_at"
FIELD_ENCRYPTED = "encrypted"
FIELD_MESSAGE_TS_START = "message_ts_start"
FIELD_MESSAGE_TS_END = "message_ts_end"
FIELD_SOURCE_MESSAGE_IDS = "source_message_ids"

PROMPT_HEADER_THREAD_MEMORY = "=== THREAD MEMORY ==="
PROMPT_HEADER_RELEVANT_OLDER_MEMORY = "=== RELEVANT OLDER MEMORY ==="
PROMPT_HEADER_STRUCTURED_COUNTERS = "=== STRUCTURED THREAD COUNTERS ==="

SECTION_THREAD_MEMORY = PROMPT_HEADER_THREAD_MEMORY
SECTION_RELEVANT_OLDER_MEMORY = PROMPT_HEADER_RELEVANT_OLDER_MEMORY
SECTION_STRUCTURED_COUNTERS = PROMPT_HEADER_STRUCTURED_COUNTERS


@dataclass(frozen=True)
class ThreadMemoryScope:
    surface: str
    thread_id: str
    scope_key: str


@dataclass(frozen=True)
class ChatMemoryConfig:
    enabled: bool = False
    peer_dm_enabled: bool = False
    group_enabled: bool = False
    min_messages: int = 200
    chunk_messages: int = 60
    chunk_chars: int = 3200
    top_k: int = 4
    max_prompt_chars: int = 3500
    backfill_max_messages: int = 4000
    event_ledger_enabled: bool = False
    embedding_model: str = ""
    indexing_daily_budget_usd: float = 0.0


DEFAULT_CONFIG = ChatMemoryConfig()


def scope_key_for_thread(surface: str, thread_id: Any) -> str:
    """Return the exact Firestore document id for one Steve chat memory scope."""

    normalized_surface = str(surface or "").strip().lower()
    if normalized_surface not in SUPPORTED_SURFACES:
        raise ValueError(f"Unsupported Steve chat memory surface: {surface!r}")
    normalized_thread_id = _normalize_thread_id(thread_id)
    return f"{normalized_surface}:{normalized_thread_id}"


def scope_for_peer_dm(conv_id: Any) -> ThreadMemoryScope:
    thread_id = _normalize_thread_id(conv_id)
    return ThreadMemoryScope(
        surface=SURFACE_DM,
        thread_id=thread_id,
        scope_key=scope_key_for_thread(SURFACE_DM, thread_id),
    )


def scope_for_group(group_id: Any) -> ThreadMemoryScope:
    thread_id = _normalize_thread_id(group_id)
    return ThreadMemoryScope(
        surface=SURFACE_GROUP,
        thread_id=thread_id,
        scope_key=scope_key_for_thread(SURFACE_GROUP, thread_id),
    )


def parse_scope_key(scope_key: str) -> ThreadMemoryScope:
    raw = str(scope_key or "").strip()
    if ":" not in raw:
        raise ValueError("Steve chat memory scope key must include a surface prefix")
    surface, thread_id = raw.split(":", 1)
    normalized_scope_key = scope_key_for_thread(surface, thread_id)
    return ThreadMemoryScope(
        surface=surface.strip().lower(),
        thread_id=_normalize_thread_id(thread_id),
        scope_key=normalized_scope_key,
    )


def chat_memory_scope_key(surface: str, thread_id: Any) -> str:
    return scope_key_for_thread(surface, thread_id)


def peer_dm_thread_id(user_a: str, user_b: str) -> str:
    """Return the sorted peer-DM id used when a Firestore conv id is unavailable."""

    a = _normalize_thread_id(str(user_a).lower())
    b = _normalize_thread_id(str(user_b).lower())
    if a == b:
        raise ValueError("peer DM scope requires two distinct users")
    return "_".join(sorted((a, b)))


def peer_dm_scope_key(user_a: str, user_b: str) -> str:
    return scope_key_for_thread(SURFACE_DM, peer_dm_thread_id(user_a, user_b))


def group_scope_key(group_id: Any) -> str:
    return scope_key_for_thread(SURFACE_GROUP, group_id)


def get_chat_memory_config(entitlements: Optional[Mapping[str, Any]]) -> ChatMemoryConfig:
    """Read Phase 3 memory knobs from resolved entitlements with safe defaults.

    The expected keys are supplied by the KB/entitlements layer, but this module
    stays usable before those flags are wired: all memory surfaces default off.
    """

    fields = entitlements or {}
    defaults = DEFAULT_CONFIG
    return ChatMemoryConfig(
        enabled=_bool(fields, "chat_memory_enabled", defaults.enabled),
        peer_dm_enabled=_bool(fields, "chat_memory_peer_dm_enabled", defaults.peer_dm_enabled),
        group_enabled=_bool(fields, "chat_memory_group_enabled", defaults.group_enabled),
        min_messages=_int(fields, "chat_memory_min_messages", defaults.min_messages, minimum=1),
        chunk_messages=_int(fields, "chat_memory_chunk_messages", defaults.chunk_messages, minimum=1),
        chunk_chars=_int(fields, "chat_memory_chunk_chars", defaults.chunk_chars, minimum=200),
        top_k=_int(fields, "chat_memory_top_k", defaults.top_k, minimum=1),
        max_prompt_chars=_int(fields, "chat_memory_max_prompt_chars", defaults.max_prompt_chars, minimum=500),
        backfill_max_messages=_int(
            fields,
            "chat_memory_backfill_max_messages",
            defaults.backfill_max_messages,
            minimum=1,
        ),
        event_ledger_enabled=_bool(
            fields,
            "chat_memory_event_ledger_enabled",
            defaults.event_ledger_enabled,
        ),
        embedding_model=_str(fields.get("chat_memory_embedding_model"), defaults.embedding_model),
        indexing_daily_budget_usd=_float(
            fields,
            "chat_memory_indexing_daily_budget_usd",
            defaults.indexing_daily_budget_usd,
            minimum=0.0,
        ),
    )


def chat_memory_enabled_for_scope(
    entitlements: Optional[Mapping[str, Any]],
    scope: ThreadMemoryScope,
) -> bool:
    config = get_chat_memory_config(entitlements)
    if not config.enabled:
        return False
    if scope.surface == SURFACE_DM:
        return config.peer_dm_enabled
    if scope.surface == SURFACE_GROUP:
        return config.group_enabled
    return False


def chat_memory_enabled_for_surface(
    entitlements: Optional[Mapping[str, Any]],
    *,
    surface: str,
) -> bool:
    scope = ThreadMemoryScope(surface=surface, thread_id="_probe", scope_key=f"{surface}:_probe")
    return chat_memory_enabled_for_scope(entitlements, scope)


def memory_doc_ref(fs_client: Any, scope: ThreadMemoryScope) -> Any:
    return fs_client.collection(COLLECTION).document(scope.scope_key)


def chunks_collection_ref(fs_client: Any, scope: ThreadMemoryScope) -> Any:
    return memory_doc_ref(fs_client, scope).collection(CHUNKS_SUBCOLLECTION)


def events_collection_ref(fs_client: Any, scope: ThreadMemoryScope) -> Any:
    return memory_doc_ref(fs_client, scope).collection(EVENTS_SUBCOLLECTION)


def firestore_layout_for_scope(scope: ThreadMemoryScope) -> dict[str, str]:
    base = f"{COLLECTION}/{scope.scope_key}"
    return {
        "scope": base,
        "chunks": f"{base}/{CHUNKS_SUBCOLLECTION}",
        "events": f"{base}/{EVENTS_SUBCOLLECTION}",
    }


def base_scope_manifest(scope: ThreadMemoryScope) -> dict[str, str]:
    return {
        FIELD_SCOPE_KEY: scope.scope_key,
        FIELD_SURFACE: scope.surface,
        FIELD_THREAD_ID: scope.thread_id,
    }


def should_include_memory_record(
    record: Mapping[str, Any],
    *,
    reset_at: Any = None,
) -> bool:
    """Return whether an indexed chunk/event may be used in a prompt."""

    if not record:
        return False
    for key in (FIELD_STALE, FIELD_INVALIDATED, FIELD_IS_DELETED, FIELD_DELETED_AT, FIELD_ENCRYPTED):
        if record.get(key):
            return False
    reset_dt = parse_memory_datetime(reset_at)
    if reset_dt is None:
        return True
    end_dt = parse_memory_datetime(
        record.get(FIELD_MESSAGE_TS_END)
        or record.get("ts_end")
        or record.get("end_ts")
        or record.get("timestamp_end")
        or record.get("created_at")
        or record.get("timestamp")
    )
    if end_dt is None:
        return True
    return end_dt >= reset_dt


def filter_memory_records(
    records: Sequence[Mapping[str, Any]],
    *,
    reset_at: Any = None,
) -> list[Mapping[str, Any]]:
    return [record for record in records or [] if should_include_memory_record(record, reset_at=reset_at)]


def format_relevant_older_memory(
    chunks: Sequence[Mapping[str, Any]],
    *,
    max_chars: int = DEFAULT_CONFIG.max_prompt_chars,
    top_k: Optional[int] = None,
) -> str:
    lines: list[str] = []
    remaining = max(0, int(max_chars or 0))
    selected = list(chunks or [])
    if top_k is not None:
        selected = selected[: max(0, int(top_k))]
    for chunk in selected:
        if remaining <= 0:
            break
        text = _chunk_text(chunk)
        if not text:
            continue
        date_label = _range_label(chunk)
        speakers = _speakers_label(chunk)
        prefix = f"- [{date_label}]"
        if speakers:
            prefix += f" {speakers}:"
        else:
            prefix += ":"
        line = f"{prefix} {text}"
        if len(line) > remaining:
            line = line[:remaining].rstrip()
        if line:
            lines.append(line)
            remaining -= len(line) + 1
    if not lines:
        return ""
    return f"{PROMPT_HEADER_RELEVANT_OLDER_MEMORY}\n" + "\n".join(lines)


def format_relevant_older_memory_section(
    chunks: Iterable[Mapping[str, Any]],
    *,
    max_chars: int,
    top_k: Optional[int] = None,
) -> str:
    return format_relevant_older_memory(list(chunks or []), max_chars=max_chars, top_k=top_k)


def format_structured_counters(
    counters: Sequence[Mapping[str, Any]],
    *,
    max_chars: int = 1600,
) -> str:
    lines: list[str] = []
    remaining = max(0, int(max_chars or 0))
    for counter in counters or []:
        if remaining <= 0:
            break
        label = str(counter.get("label") or counter.get("event_type") or counter.get("name") or counter.get("type") or "").strip()
        if not label:
            continue
        value = counter.get("count", counter.get("value", "unknown"))
        line_parts = [f"- {label}: {value}"]
        evidence_dates = counter.get("evidence_dates") or counter.get("dates") or []
        if evidence_dates:
            dates_text = _evidence_dates_label(evidence_dates)
            if dates_text:
                line_parts.append(f"  Evidence dates: {dates_text}")
        confidence = str(counter.get("confidence") or "").strip()
        if confidence:
            line_parts.append(f"  Confidence: {confidence}")
        line = "\n".join(line_parts)
        if len(line) > remaining:
            line = line[:remaining].rstrip()
        if line:
            lines.append(line)
            remaining -= len(line) + 1
    if not lines:
        return ""
    return f"{PROMPT_HEADER_STRUCTURED_COUNTERS}\n" + "\n".join(lines)


def format_structured_counters_section(
    counters: Iterable[Mapping[str, Any]],
    *,
    max_chars: int,
) -> str:
    return format_structured_counters(list(counters or []), max_chars=max_chars)


def format_chat_memory_prompt_sections(
    *,
    relevant_chunks: Optional[Sequence[Mapping[str, Any]]] = None,
    counters: Optional[Sequence[Mapping[str, Any]]] = None,
    max_prompt_chars: int = DEFAULT_CONFIG.max_prompt_chars,
) -> str:
    relevant_budget = max(500, int(max_prompt_chars * 0.7))
    counter_budget = max(300, int(max_prompt_chars) - relevant_budget)
    parts = [
        format_relevant_older_memory(relevant_chunks or [], max_chars=relevant_budget),
        format_structured_counters(counters or [], max_chars=counter_budget),
    ]
    return "\n\n".join(part for part in parts if part.strip())


def format_thread_memory_prompt_sections(
    *,
    relevant_chunks: Optional[Iterable[Mapping[str, Any]]] = None,
    counters: Optional[Iterable[Mapping[str, Any]]] = None,
    entitlements: Optional[Mapping[str, Any]] = None,
    max_prompt_chars: Optional[int] = None,
) -> str:
    cfg = get_chat_memory_config(entitlements)
    budget = int(max_prompt_chars or cfg.max_prompt_chars)
    return format_chat_memory_prompt_sections(
        relevant_chunks=list(relevant_chunks or []),
        counters=list(counters or []),
        max_prompt_chars=budget,
    )[:budget]


def parse_memory_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    try:
        if isinstance(value, datetime):
            dt = value
        elif hasattr(value, "timestamp") and callable(getattr(value, "timestamp")):
            dt = datetime.fromtimestamp(value.timestamp(), timezone.utc)
        elif isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        else:
            return None
        if dt.tzinfo is not None:
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _normalize_thread_id(thread_id: Any) -> str:
    value = str(thread_id or "").strip()
    if not value:
        raise ValueError("Steve chat memory thread id cannot be empty")
    if "/" in value:
        raise ValueError("Steve chat memory thread id cannot contain '/'")
    return value


def _bool(fields: Mapping[str, Any], name: str, default: bool) -> bool:
    raw = fields.get(name)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    if raw is None:
        return default
    return bool(raw)


def _int(fields: Mapping[str, Any], name: str, default: int, *, minimum: int) -> int:
    try:
        value = int(fields.get(name))
    except Exception:
        return default
    return max(minimum, value)


def _float(fields: Mapping[str, Any], name: str, default: float, *, minimum: float) -> float:
    try:
        value = float(fields.get(name))
    except Exception:
        return default
    return max(minimum, value)


def _str(value: Any, default: str) -> str:
    text = str(value or "").strip()
    return text or default


def _chunk_text(chunk: Mapping[str, Any]) -> str:
    text = str(
        chunk.get("snippet")
        or chunk.get("evidence_snippet")
        or chunk.get("summary")
        or chunk.get("text")
        or ""
    ).strip()
    return " ".join(text.split())


def _range_label(chunk: Mapping[str, Any]) -> str:
    start = _date_label(
        chunk.get(FIELD_MESSAGE_TS_START)
        or chunk.get("ts_start")
        or chunk.get("start_ts")
        or chunk.get("timestamp_start")
        or chunk.get("start")
    )
    end = _date_label(
        chunk.get(FIELD_MESSAGE_TS_END)
        or chunk.get("ts_end")
        or chunk.get("end_ts")
        or chunk.get("timestamp_end")
        or chunk.get("end")
    )
    explicit = str(chunk.get("date_range") or "").strip()
    if explicit:
        return explicit
    if start and end and start != end:
        return f"{start} to {end}"
    return start or end or "undated"


def _date_label(value: Any) -> str:
    dt = parse_memory_datetime(value)
    if dt is not None:
        return dt.date().isoformat()
    text = str(value or "").strip()
    return text[:10] if text else ""


def _speakers_label(chunk: Mapping[str, Any]) -> str:
    speakers = chunk.get("speakers") or chunk.get("senders") or []
    if isinstance(speakers, Mapping):
        speakers = speakers.keys()
    if isinstance(speakers, str):
        return speakers.strip()
    return ", ".join(str(speaker).strip() for speaker in list(speakers)[:4] if str(speaker).strip())


def _evidence_dates_label(value: Any) -> str:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return ", ".join(str(date).strip() for date in value if str(date).strip())
    return str(value or "").strip()
