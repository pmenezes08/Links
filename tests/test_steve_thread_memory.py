"""Tests for backend.services.steve_thread_memory.

Covers the thread summary gating, trigger/refresh thresholds, config
parsing, timestamp formatting, and the strict no-op behaviour when the
feature is disabled.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from backend.services.steve_thread_memory import (
    _get_thread_summary_config,
    clear_thread_summary,
    dm_context_read_limit,
    format_msg_timestamp,
    is_unsafe_context_message,
    load_thread_summary,
    maybe_refresh_thread_summary,
    message_line_from_row,
)


# ── Config parsing ──────────────────────────────────────────────────────

def test_config_disabled_by_default():
    cfg = _get_thread_summary_config({})
    assert cfg["enabled"] is False
    assert cfg["trigger"] == 120
    assert cfg["refresh"] == 40
    assert cfg["max_chars"] == 2000


def test_config_reads_entitlements():
    ent = {
        "thread_summary_enabled": True,
        "thread_summary_trigger_messages": 80,
        "thread_summary_refresh_messages": 20,
        "thread_summary_max_chars": 1500,
    }
    cfg = _get_thread_summary_config(ent)
    assert cfg["enabled"] is True
    assert cfg["trigger"] == 80
    assert cfg["refresh"] == 20
    assert cfg["max_chars"] == 1500


def test_config_clamps_to_minimum():
    ent = {
        "thread_summary_enabled": True,
        "thread_summary_trigger_messages": 0,
        "thread_summary_refresh_messages": -5,
        "thread_summary_max_chars": 10,
    }
    cfg = _get_thread_summary_config(ent)
    assert cfg["trigger"] >= 1
    assert cfg["refresh"] >= 1
    assert cfg["max_chars"] >= 100


# ── Disabled = strict no-op ─────────────────────────────────────────────

def test_disabled_returns_none_no_llm_call():
    """When thread_summary_enabled is False, no LLM call or ai_usage row."""
    fs = MagicMock()
    result = maybe_refresh_thread_summary(
        fs_client=fs,
        collection="dm_conversations",
        doc_id="alice_bob",
        all_messages=[f"msg{i}" for i in range(300)],
        verbatim_window=30,
        entitlements={"thread_summary_enabled": False},
        sender_username="alice",
        surface="dm",
    )
    assert result is None


# ── Trigger threshold ───────────────────────────────────────────────────

def test_below_trigger_returns_cached_if_any():
    """When older messages < trigger, returns cached summary (if any)."""
    fs = MagicMock()
    doc_mock = MagicMock()
    doc_mock.exists = True
    doc_mock.to_dict.return_value = {
        "steve_thread_summary": "Previous summary",
        "steve_thread_summary_msg_count": 50,
    }
    fs.collection.return_value.document.return_value.get.return_value = doc_mock

    result = maybe_refresh_thread_summary(
        fs_client=fs,
        collection="dm_conversations",
        doc_id="alice_bob",
        all_messages=[f"msg{i}" for i in range(60)],
        verbatim_window=30,
        entitlements={
            "thread_summary_enabled": True,
            "thread_summary_trigger_messages": 120,
        },
        sender_username="alice",
        surface="dm",
    )
    assert result == "Previous summary"


def test_below_trigger_no_cached_returns_none():
    """When older messages < trigger and no cached summary, returns None."""
    fs = MagicMock()
    doc_mock = MagicMock()
    doc_mock.exists = False
    fs.collection.return_value.document.return_value.get.return_value = doc_mock

    result = maybe_refresh_thread_summary(
        fs_client=fs,
        collection="dm_conversations",
        doc_id="alice_bob",
        all_messages=[f"msg{i}" for i in range(60)],
        verbatim_window=30,
        entitlements={
            "thread_summary_enabled": True,
            "thread_summary_trigger_messages": 120,
        },
        sender_username="alice",
        surface="dm",
    )
    assert result is None


# ── Refresh cadence ─────────────────────────────────────────────────────

def test_existing_summary_reused_when_not_enough_new_messages():
    """Cached summary returned if new messages since last summary < refresh."""
    fs = MagicMock()
    doc_mock = MagicMock()
    doc_mock.exists = True
    doc_mock.to_dict.return_value = {
        "steve_thread_summary": "Cached summary",
        "steve_thread_summary_msg_count": 140,
    }
    fs.collection.return_value.document.return_value.get.return_value = doc_mock

    result = maybe_refresh_thread_summary(
        fs_client=fs,
        collection="dm_conversations",
        doc_id="alice_bob",
        all_messages=[f"msg{i}" for i in range(200)],
        verbatim_window=30,
        entitlements={
            "thread_summary_enabled": True,
            "thread_summary_trigger_messages": 120,
            "thread_summary_refresh_messages": 40,
        },
        sender_username="alice",
        surface="dm",
    )
    assert result == "Cached summary"


# ── LLM call + ai_usage row ────────────────────────────────────────────

def test_triggers_llm_call_and_logs_usage():
    """When above trigger and refresh cadence, an LLM call runs and
    exactly one ai_usage.log_usage row is written."""
    fs = MagicMock()
    doc_mock = MagicMock()
    doc_mock.exists = True
    doc_mock.to_dict.return_value = {
        "steve_thread_summary": None,
        "steve_thread_summary_msg_count": 0,
    }
    fs.collection.return_value.document.return_value.get.return_value = doc_mock

    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "Summary of events"
    mock_response.usage = MagicMock(
        input_tokens=500, output_tokens=100,
        input_tokens_details=None, prompt_tokens=None,
        completion_tokens=None, total_tokens=600,
        prompt_tokens_details=None, cached_input_tokens=None,
    )

    with patch("backend.services.content_generation.llm.XAI_API_KEY", "test-key"), \
         patch("openai.OpenAI") as MockOpenAI, \
         patch("backend.services.ai_usage.log_usage") as mock_log_usage:
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_client.chat.completions.create.return_value = mock_response

        result = maybe_refresh_thread_summary(
            fs_client=fs,
            collection="dm_conversations",
            doc_id="alice_bob",
            all_messages=[f"msg{i}" for i in range(200)],
            verbatim_window=30,
            entitlements={
                "thread_summary_enabled": True,
                "thread_summary_trigger_messages": 50,
                "thread_summary_refresh_messages": 10,
                "thread_summary_max_chars": 2000,
            },
            sender_username="alice",
            surface="dm",
        )

        assert result == "Summary of events"
        mock_log_usage.assert_called_once()
        call_kwargs = mock_log_usage.call_args
        assert call_kwargs[1]["request_type"] == "steve_thread_summary"


# ── Load from Firestore ─────────────────────────────────────────────────

def test_load_thread_summary_existing():
    fs = MagicMock()
    doc_mock = MagicMock()
    doc_mock.exists = True
    doc_mock.to_dict.return_value = {
        "steve_thread_summary": "A summary",
        "steve_thread_summary_msg_count": 100,
        "steve_thread_summary_through_ts": "2026-05-01T12:00:00Z",
    }
    fs.collection.return_value.document.return_value.get.return_value = doc_mock

    summary, count, ts = load_thread_summary(
        fs, collection="dm_conversations", doc_id="alice_bob",
    )
    assert summary == "A summary"
    assert count == 100
    assert ts is not None


def test_load_thread_summary_missing():
    fs = MagicMock()
    doc_mock = MagicMock()
    doc_mock.exists = False
    fs.collection.return_value.document.return_value.get.return_value = doc_mock

    summary, count, ts = load_thread_summary(
        fs, collection="dm_conversations", doc_id="nonexistent",
    )
    assert summary is None
    assert count == 0
    assert ts is None


def test_clear_thread_summary_resets_cached_fields():
    fs = MagicMock()

    clear_thread_summary(fs, collection="dm_conversations", doc_id="alice_bob")

    fs.collection.return_value.document.return_value.set.assert_called_once_with(
        {
            "steve_thread_summary": None,
            "steve_thread_summary_msg_count": 0,
            "steve_thread_summary_through_ts": None,
        },
        merge=True,
    )


def test_cached_summary_before_reset_is_not_returned():
    fs = MagicMock()
    doc_mock = MagicMock()
    doc_mock.exists = True
    doc_mock.to_dict.return_value = {
        "steve_thread_summary": "stale summary",
        "steve_thread_summary_msg_count": 20,
        "steve_thread_summary_through_ts": "2026-04-01T12:00:00Z",
    }
    fs.collection.return_value.document.return_value.get.return_value = doc_mock

    result = maybe_refresh_thread_summary(
        fs_client=fs,
        collection="dm_conversations",
        doc_id="alice_bob",
        all_messages=[f"msg{i}" for i in range(40)],
        verbatim_window=30,
        entitlements={
            "thread_summary_enabled": True,
            "thread_summary_trigger_messages": 120,
        },
        sender_username="alice",
        surface="dm",
        reset_dt=datetime(2026, 5, 1, 0, 0, 0),
    )
    assert result is None


# ── format_msg_timestamp ────────────────────────────────────────────────

def test_timestamp_recent_datetime():
    dt = datetime.utcnow() - timedelta(days=5)
    result = format_msg_timestamp(dt)
    assert result.startswith("[")
    assert result.endswith("] ")
    assert str(dt.year) not in result  # year omitted for recent


def test_timestamp_old_datetime_includes_year():
    dt = datetime.utcnow() - timedelta(days=365)
    result = format_msg_timestamp(dt)
    assert str(dt.year) in result


def test_timestamp_none_returns_empty():
    assert format_msg_timestamp(None) == ""


def test_timestamp_iso_string():
    result = format_msg_timestamp("2026-05-20T14:30:00Z")
    assert "[May 20, 14:30]" in result


def test_timestamp_invalid_returns_empty():
    assert format_msg_timestamp("not-a-date") == ""
    assert format_msg_timestamp(12345) == ""


# ── message_line_from_row with timestamp ────────────────────────────────

def test_message_line_with_timestamp():
    line = message_line_from_row("alice", "hello", ts="2026-05-20T14:30:00Z")
    assert line is not None
    assert line.startswith("[May 20, 14:30]")
    assert "alice: hello" in line


def test_message_line_media_with_timestamp():
    line = message_line_from_row("bob", "", has_media=True, ts="2026-05-20T09:00:00Z")
    assert line is not None
    assert "[shared a photo]" in line
    assert "[May 20, 09:00]" in line


def test_message_line_no_timestamp():
    line = message_line_from_row("alice", "hello")
    assert line == "alice: hello"


def test_unsafe_context_message_detects_deleted_and_encrypted_rows():
    assert is_unsafe_context_message({}) is True
    assert is_unsafe_context_message({"sender": "alice", "text": "ok"}) is False
    assert is_unsafe_context_message({"sender": "alice", "is_deleted": True}) is True
    assert is_unsafe_context_message({"sender": "alice", "deleted_at": "2026-05-01"}) is True
    assert is_unsafe_context_message({"sender": "alice", "is_encrypted": True}) is True
    assert is_unsafe_context_message({"sender": "alice", "encrypted": True}) is True


# ── dm_context_read_limit ───────────────────────────────────────────────

def test_dm_context_read_limit_non_peer():
    limit = dm_context_read_limit({}, is_peer=False, peer_window=60, max_context=200)
    assert limit == 200


def test_dm_context_read_limit_peer_no_summary():
    limit = dm_context_read_limit(
        {"thread_summary_enabled": False},
        is_peer=True, peer_window=60, max_context=200,
    )
    assert limit == 60


def test_dm_context_read_limit_peer_with_summary():
    limit = dm_context_read_limit(
        {
            "thread_summary_enabled": True,
            "thread_summary_trigger_messages": 120,
            "thread_summary_refresh_messages": 40,
        },
        is_peer=True, peer_window=60, max_context=200,
    )
    assert limit > 60
    assert limit <= 200
