"""Rolling per-thread summary for Steve's long-history context.

Generates and maintains a structured summary of older messages in a DM
or group-chat thread so Steve can answer counting/aggregation questions
(e.g. "how many weddings has Mala attended this year?") without sending
the entire thread to the model every turn.

Gated behind the KB switch ``thread_summary_enabled`` (default False).
When disabled, every public function in this module is a no-op.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

SUMMARY_SURFACE_DM = "dm"
SUMMARY_SURFACE_GROUP = "group"

_SUMMARIZE_SYSTEM_PROMPT = (
    "You are an internal analyst producing a compact, structured summary "
    "of a conversation excerpt. Your output will be injected into a later "
    "prompt as background context — the reader (Steve) is a member of "
    "C-Point, not an assistant.\n\n"
    "Rules:\n"
    "- Produce a STRUCTURED roll-up, not free prose.\n"
    "- Preserve key FACTS, recurring PEOPLE/NAMES, EVENT tallies "
    "(e.g. 'weddings mentioned: 3'), DATES, and any commitments.\n"
    "- Do NOT invent information. If something is ambiguous, say so.\n"
    "- Keep the summary under {max_chars} characters.\n"
    "- Use plain text with bullet points. No markdown headers.\n"
    "- Language: match the dominant language of the conversation.\n"
)


def format_msg_timestamp(dt_val: Any) -> str:
    """Format a message timestamp for Steve's context window.

    Returns ``[May 29, 14:30] `` (with trailing space) or ``""`` if the
    value cannot be parsed.  Messages older than ~180 days include the
    year: ``[Jan 12 2025, 09:15] ``.
    """
    if dt_val is None:
        return ""
    try:
        if hasattr(dt_val, "strftime"):
            dt = dt_val
        elif hasattr(dt_val, "timestamp") and callable(getattr(dt_val, "timestamp")):
            dt = datetime.utcfromtimestamp(dt_val.timestamp())
        elif isinstance(dt_val, str):
            s = dt_val.strip().replace("Z", "+00:00")
            dt = datetime.fromisoformat(s)
        else:
            return ""
        now = datetime.utcnow()
        if hasattr(dt, "tzinfo") and dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        delta = now - dt
        if delta.days > 180:
            return f"[{dt.strftime('%b %d %Y, %H:%M')}] "
        return f"[{dt.strftime('%b %d, %H:%M')}] "
    except Exception:
        return ""


def _get_thread_summary_config(entitlements: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    ent = entitlements or {}
    return {
        "enabled": bool(ent.get("thread_summary_enabled", False)),
        "trigger": max(1, int(ent.get("thread_summary_trigger_messages", 120))),
        "refresh": max(1, int(ent.get("thread_summary_refresh_messages", 40))),
        "max_chars": max(100, int(ent.get("thread_summary_max_chars", 2000))),
    }


def thread_summary_enabled(entitlements: Optional[Dict[str, Any]]) -> bool:
    return bool(_get_thread_summary_config(entitlements)["enabled"])


def dm_context_read_limit(
    entitlements: Optional[Dict[str, Any]],
    *,
    is_peer: bool,
    peer_window: int,
    max_context: int,
) -> int:
    """How many recent messages to load for Steve context assembly.

    Peer DMs stay at ``peer_window`` unless thread summary is enabled, in
    which case we extend the read (capped at ``max_context``) so the
    summary service can see enough older messages to trigger refresh.
    """
    if not is_peer:
        return max(1, int(max_context))
    if not thread_summary_enabled(entitlements):
        return max(1, int(peer_window))
    cfg = _get_thread_summary_config(entitlements)
    extended = int(peer_window) + cfg["trigger"] + cfg["refresh"]
    return max(int(peer_window), min(int(max_context), extended))


def message_line_from_row(
    sender: str,
    text: Optional[str],
    *,
    has_media: bool = False,
    ts: Any = None,
) -> Optional[str]:
    snd = (sender or "").strip()
    if not snd:
        return None
    ts_prefix = format_msg_timestamp(ts)
    body = (text or "").strip()
    if body:
        return f"{ts_prefix}{snd}: {body}"
    if has_media:
        return f"{ts_prefix}{snd}: [shared a photo]"
    return None


def load_thread_summary(
    fs_client: Any,
    *,
    collection: str,
    doc_id: str,
) -> Tuple[Optional[str], int, Optional[datetime]]:
    """Load an existing thread summary from the conversation doc.

    Returns (summary_text, summarized_msg_count, summary_through_ts).
    """
    try:
        doc = fs_client.collection(collection).document(doc_id).get()
        if not doc.exists:
            return None, 0, None
        data = doc.to_dict() or {}
        summary = data.get("steve_thread_summary")
        count = int(data.get("steve_thread_summary_msg_count", 0) or 0)
        through_ts = data.get("steve_thread_summary_through_ts")
        if through_ts and not isinstance(through_ts, datetime):
            try:
                through_ts = datetime.fromisoformat(
                    str(through_ts).replace("Z", "+00:00")
                )
            except Exception:
                through_ts = None
        if isinstance(through_ts, datetime) and through_ts.tzinfo is not None:
            through_ts = through_ts.astimezone(timezone.utc).replace(tzinfo=None)
        return summary, count, through_ts
    except Exception as exc:
        logger.warning("Failed to load thread summary from %s/%s: %s", collection, doc_id, exc)
        return None, 0, None


def _save_thread_summary(
    fs_client: Any,
    *,
    collection: str,
    doc_id: str,
    summary: str,
    msg_count: int,
    through_ts: datetime,
) -> None:
    try:
        fs_client.collection(collection).document(doc_id).set(
            {
                "steve_thread_summary": summary,
                "steve_thread_summary_msg_count": msg_count,
                "steve_thread_summary_through_ts": through_ts.isoformat() + "Z"
                if through_ts.tzinfo is None
                else through_ts.isoformat(),
            },
            merge=True,
        )
    except Exception as exc:
        logger.warning("Failed to save thread summary to %s/%s: %s", collection, doc_id, exc)


def clear_thread_summary(
    fs_client: Any,
    *,
    collection: str,
    doc_id: str,
) -> None:
    """Clear cached thread summary fields after a Steve context reset."""
    try:
        fs_client.collection(collection).document(doc_id).set(
            {
                "steve_thread_summary": None,
                "steve_thread_summary_msg_count": 0,
                "steve_thread_summary_through_ts": None,
            },
            merge=True,
        )
    except Exception as exc:
        logger.warning("Failed to clear thread summary on %s/%s: %s", collection, doc_id, exc)


def is_unsafe_context_message(row: Dict[str, Any]) -> bool:
    """Return True for deleted/encrypted rows that Steve must not ingest."""
    if not row:
        return True
    if row.get("is_deleted") or row.get("deleted") or row.get("deleted_at"):
        return True
    if row.get("is_encrypted") or row.get("encrypted"):
        return True
    return False


def _fetch_older_firestore_dm_lines(
    msgs_ref: Any,
    oldest_loaded_doc: Any,
    *,
    limit: int,
    reset_dt: Optional[datetime],
    parse_dt_fn: Any,
) -> List[str]:
    """Fetch one page of messages older than the current loaded window."""
    if not oldest_loaded_doc or not getattr(oldest_loaded_doc, "exists", lambda: False)():
        return []
    oldest_data = oldest_loaded_doc.to_dict() or {}
    before_ts = oldest_data.get("created_at")
    if before_ts is None:
        return []
    try:
        docs = list(
            msgs_ref.where("created_at", "<", before_ts)
            .order_by("created_at", direction="DESCENDING")
            .limit(int(limit))
            .stream()
        )
    except Exception as exc:
        logger.warning("Failed to fetch older DM messages for summary: %s", exc)
        return []
    docs.reverse()
    lines: List[str] = []
    for doc in docs:
        d = doc.to_dict() or {}
        if is_unsafe_context_message(d):
            continue
        msg_ts = parse_dt_fn(d.get("created_at"))
        if reset_dt and msg_ts and msg_ts < reset_dt:
            continue
        line = message_line_from_row(
            d.get("sender", ""),
            d.get("text"),
            has_media=bool(d.get("image_path") or d.get("media_paths")),
            ts=d.get("created_at"),
        )
        if line:
            lines.append(line)
    return lines


def maybe_refresh_thread_summary(
    *,
    fs_client: Any,
    collection: str,
    doc_id: str,
    all_messages: List[str],
    verbatim_window: int,
    entitlements: Optional[Dict[str, Any]],
    sender_username: str,
    surface: str,
    reset_dt: Optional[datetime] = None,
    at_read_cap: bool = False,
    msgs_ref: Any = None,
    oldest_loaded_doc: Any = None,
    parse_dt_fn: Any = None,
) -> Optional[str]:
    """Conditionally refresh the rolling thread summary.

    Returns the summary text to inject, or None if no summary is
    available / the feature is disabled. When the summary is fresh
    enough, the stored version is returned without re-summarizing.

    IMPORTANT: exactly ONE ``ai_usage.log_usage`` row is written per
    summarize call. No row is written when the cached summary is reused
    or when the feature is disabled.
    """
    config = _get_thread_summary_config(entitlements)
    if not config["enabled"]:
        return None

    older_count = max(0, len(all_messages) - verbatim_window)
    if older_count < config["trigger"]:
        return _load_cached_summary_if_any(fs_client, collection, doc_id, reset_dt=reset_dt)

    existing_summary, prev_count, prev_ts = load_thread_summary(
        fs_client, collection=collection, doc_id=doc_id,
    )
    if reset_dt and (not prev_ts or prev_ts < reset_dt):
        existing_summary = None
        prev_count = 0

    new_since_last = older_count - prev_count
    if existing_summary and new_since_last < config["refresh"] and not at_read_cap:
        return existing_summary

    older_messages = all_messages[:older_count]
    if (
        not existing_summary
        and at_read_cap
        and msgs_ref is not None
        and oldest_loaded_doc is not None
        and parse_dt_fn is not None
    ):
        extra = _fetch_older_firestore_dm_lines(
            msgs_ref,
            oldest_loaded_doc,
            limit=300,
            reset_dt=reset_dt,
            parse_dt_fn=parse_dt_fn,
        )
        if extra:
            older_messages = extra + older_messages
    elif existing_summary and new_since_last < config["refresh"]:
        return existing_summary

    summary = _run_summarize(
        older_messages,
        max_chars=config["max_chars"],
        sender_username=sender_username,
        surface=surface,
        entitlements=entitlements,
        existing_summary=existing_summary,
    )
    if not summary:
        return existing_summary

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    _save_thread_summary(
        fs_client,
        collection=collection,
        doc_id=doc_id,
        summary=summary,
        msg_count=older_count,
        through_ts=now,
    )
    return summary


def _load_cached_summary_if_any(
    fs_client: Any, collection: str, doc_id: str, *, reset_dt: Optional[datetime] = None,
) -> Optional[str]:
    summary, _, through_ts = load_thread_summary(
        fs_client, collection=collection, doc_id=doc_id,
    )
    if reset_dt and (not through_ts or through_ts < reset_dt):
        return None
    return summary


def _run_summarize(
    messages: List[str],
    *,
    max_chars: int,
    sender_username: str,
    surface: str,
    entitlements: Optional[Dict[str, Any]],
    existing_summary: Optional[str] = None,
) -> Optional[str]:
    """Call the LLM to summarize older messages. Logs exactly one ai_usage row."""
    from backend.services import ai_usage
    from backend.services.content_generation.llm import XAI_API_KEY
    from backend.services.steve_model_config import (
        estimate_response_cost_usd,
        get_steve_model_config,
        response_usage_tokens,
    )

    if not XAI_API_KEY:
        logger.warning("XAI_API_KEY not configured, cannot summarize thread")
        return None

    model_config = get_steve_model_config()
    model_to_use = model_config.model

    conversation_text = "\n".join(messages[-500:])

    system_prompt = _SUMMARIZE_SYSTEM_PROMPT.format(max_chars=max_chars)
    if existing_summary:
        user_prompt = (
            f"Update this existing thread summary using the new message excerpt "
            f"({len(messages)} messages). Preserve event counts and named people; "
            f"merge new facts and revise tallies when the new messages change them.\n\n"
            f"EXISTING SUMMARY:\n{existing_summary}\n\n"
            f"NEW MESSAGES:\n{conversation_text}"
        )
    else:
        user_prompt = (
            f"Summarize the following conversation excerpt ({len(messages)} messages). "
            f"Focus on key facts, people, event counts, dates, and commitments.\n\n"
            f"{conversation_text}"
        )

    start_ms = time.time() * 1000
    try:
        from openai import OpenAI

        client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
        response = client.chat.completions.create(
            model=model_to_use,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=800,
            temperature=0.3,
        )
        response_time_ms = int(time.time() * 1000 - start_ms)

        summary = ""
        if response.choices:
            summary = (response.choices[0].message.content or "").strip()

        summary = summary[:max_chars]

        tokens_in, tokens_out = response_usage_tokens(response)
        ai_surface = (
            ai_usage.SURFACE_DM if surface == SUMMARY_SURFACE_DM
            else ai_usage.SURFACE_GROUP
        )
        ai_usage.log_usage(
            sender_username,
            surface=ai_surface,
            request_type="steve_thread_summary",
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=estimate_response_cost_usd(response, model_config),
            response_time_ms=response_time_ms,
            model=model_to_use,
        )

        return summary if summary else None
    except Exception as exc:
        logger.warning("Thread summary LLM call failed: %s", exc)
        return None
