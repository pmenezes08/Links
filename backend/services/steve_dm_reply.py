"""
Steve DM reply generation (Grok) and persistence.

Orchestrates private Steve chats and @Steve mentions in human-human DMs.
Called from a background thread via :func:`run_steve_dm_reply`.
"""

from __future__ import annotations

import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import datetime
from typing import List, Optional, Tuple

from backend.services.content_generation.llm import XAI_API_KEY
from backend.services.database import USE_MYSQL, get_db_connection
from backend.services.dm_human_thread import (
    ensure_human_dm_thread_column,
    human_pair_thread_key,
)
from backend.services import ai_usage
from backend.services import entitlements_errors as _errs
from backend.services.entitlements_gate import gate_or_reason
from backend.services.feature_flags import entitlements_enforcement_enabled as _enforce

logger = logging.getLogger(__name__)

PEER_DM_CONTEXT_LINES = 10
GROK_DM_TIMEOUT_SECONDS = 90
INFLIGHT_BUSY_MESSAGE = "I'm still on your last message — give me a moment."
GROK_TIMEOUT_MESSAGE = (
    "That took longer than expected on my side. Try again in a moment, "
    "or say **retry** and I'll take another pass."
)
GROK_EMPTY_MESSAGE = "That one got away from me — try asking again in a moment."


def _canonical_app_origin() -> str:
    return (os.environ.get("PUBLIC_BASE_URL") or "").strip().rstrip("/") or "https://app.c-point.co"


def _premium_subscription_dm_cta() -> str:
    base = _canonical_app_origin()
    url = f"{base}/account_settings/membership"
    return (
        "I'm part of the **Premium** experience — I need an active subscription to chat here.\n\n"
        f"[Manage membership]({url}) · Settings → Manage Membership · upgrade to unlock me."
    )


def start_steve_dm_reply_if_allowed(
    sender_username: str,
    user_message: str,
    recipient_username: str,
    *,
    is_encrypted: bool = False,
) -> Tuple[bool, Optional[dict]]:
    """Start background Steve DM thread when messaging Steve or @Steve in a human DM."""
    mentions_steve = bool(user_message and re.search(r"@steve\b", user_message, re.IGNORECASE))
    is_steve_dm = recipient_username.lower() == "steve"
    if not ((is_steve_dm or mentions_steve) and sender_username.lower() != "steve" and not is_encrypted):
        return False, None

    entitlements_error: Optional[dict] = None
    start_thread = True
    try:
        from backend.services.entitlements_gate import check_steve_access as _check_dm_ste_access

        if _enforce():
            _allowed_dm, _dm_ent_payload, _, _ = _check_dm_ste_access(
                sender_username, ai_usage.SURFACE_DM
            )
            if not _allowed_dm:
                entitlements_error = _dm_ent_payload
                start_thread = False
                logger.info(
                    "Steve DM reply skipped (entitlements): user=%s reason=%s",
                    sender_username,
                    (_dm_ent_payload or {}).get("reason"),
                )
    except Exception as dm_gate_err:
        logger.warning("Steve DM entitlement preflight failed (non-fatal): %s", dm_gate_err)

    if start_thread:
        try:
            import threading

            try:
                from backend.services.steve_dm_typing import mark_dm_typing

                mark_dm_typing(sender_username, recipient_username if not is_steve_dm else "steve")
            except Exception as typing_err:
                logger.warning("Failed to mark Steve DM typing: %s", typing_err)

            thread = threading.Thread(
                target=run_steve_dm_reply,
                args=(sender_username, user_message, recipient_username if not is_steve_dm else None),
            )
            thread.daemon = True
            thread.start()
            logger.info(
                "Triggered Steve DM reply for %s (in chat with %s)",
                sender_username,
                recipient_username,
            )
        except Exception as steve_err:
            logger.warning("Failed to trigger Steve DM reply: %s", steve_err)
            start_thread = False

    return start_thread, entitlements_error


def run_steve_dm_reply(
    sender_username: str,
    user_message: str,
    other_username: Optional[str] = None,
) -> None:
    """Entry point for threaded Steve DM replies (bodybuilding_app delegates here)."""
    typing_peer = other_username if other_username else "steve"

    def _clear_steve_typing() -> None:
        try:
            from backend.services.steve_dm_typing import clear_dm_typing

            clear_dm_typing(sender_username, typing_peer)
        except Exception as typing_err:
            logger.warning("Failed to clear Steve DM typing: %s", typing_err)

    time.sleep(1.5)

    allowed, gate_reason, _ent = gate_or_reason(sender_username, ai_usage.SURFACE_DM)
    if not allowed and _enforce():
        try:
            if gate_reason == _errs.REASON_PREMIUM_REQUIRED:
                blocked = _premium_subscription_dm_cta()
            elif gate_reason == _errs.REASON_DAILY_CAP:
                blocked = "You've hit today's Steve limit — it resets overnight."
            else:
                blocked = (
                    "You've used up your Steve calls for this month. "
                    "See Settings → AI Usage."
                )
            _emit_steves_dm_text(
                sender_username=sender_username,
                body=blocked,
                other_username=other_username,
            )
        except Exception:
            pass
        try:
            ai_usage.log_block(sender_username, surface=ai_usage.SURFACE_DM, reason=gate_reason or "unknown")
        except Exception:
            pass
        _clear_steve_typing()
        return

    try:
        from backend.services.steve_platform_manual import is_feedback_intent

        if is_feedback_intent(user_message):
            from backend.services.steve_feedback import create_feedback_item

            text = (user_message or "").strip()
            if len(text) < 24:
                body = (
                    "Quick one: what happened, and what were you trying to do? "
                    "Give me that and I'll send it through properly."
                )
                _emit_steves_dm_text(
                    sender_username=sender_username,
                    body=body,
                    other_username=other_username,
                )
                _clear_steve_typing()
                return

            item = create_feedback_item(
                submitted_by=sender_username,
                raw_user_message=text,
                steve_summary=text[:500],
                surface="steve_dm",
            )
            body = (
                f"Got it. I've sent this through as {item.get('type', 'feedback').replace('_', ' ')} "
                f"#{item.get('id')}. I'll keep it tied to your report."
            )
            _emit_steves_dm_text(
                sender_username=sender_username,
                body=body,
                other_username=other_username,
            )
            try:
                ai_usage.log_usage(
                    sender_username,
                    surface=ai_usage.SURFACE_DM,
                    request_type="steve_dm_feedback",
                    model="n/a",
                )
            except Exception:
                pass
            _clear_steve_typing()
            return
    except Exception as feedback_err:
        logger.warning("Steve feedback capture failed, falling back: %s", feedback_err)

    # Reminder Vault — only private DM with Steve (no third participant)
    if not other_username:
        try:
            from backend.services.steve_reminder_vault import (
                try_handle_direct_steve_dm_reminder,
            )

            rm = try_handle_direct_steve_dm_reminder(
                sender_username=sender_username,
                user_message=user_message,
            )
            if rm:
                from backend.services.content_generation.delivery import send_steve_dm

                send_steve_dm(receiver_username=sender_username, content=rm)
                try:
                    ai_usage.log_usage(
                        sender_username,
                        surface=ai_usage.SURFACE_DM,
                        request_type="steve_reminder_vault",
                        model="n/a",
                    )
                except Exception:
                    pass
                _clear_steve_typing()
                return
        except Exception as exc:
            logger.warning("Reminder vault handler failed (non-fatal): %s", exc)

    # Platform activity digest (private Steve DM only — runs before general Grok)
    if not other_username:
        try:
            from backend.services.platform_activity_digest import try_handle_platform_activity_digest_dm

            dm_digest = try_handle_platform_activity_digest_dm(
                sender_username=sender_username,
                user_message=user_message or "",
            )
            if dm_digest:
                from backend.services.content_generation.delivery import send_steve_dm

                send_steve_dm(receiver_username=sender_username, content=dm_digest)
                _clear_steve_typing()
                return
        except Exception as exc:
            logger.warning("Platform digest handler failed (non-fatal): %s", exc)

    if not XAI_API_KEY:
        logger.warning("XAI_API_KEY not configured, Steve cannot reply in DM")
        _clear_steve_typing()
        return

    from backend.services.steve_dm_typing import (
        DmTypingHeartbeat,
        release_dm_inflight,
        try_acquire_dm_inflight,
    )

    lock_peer = other_username if other_username else "steve"
    heartbeat = DmTypingHeartbeat(sender_username, typing_peer)
    heartbeat.start()
    try:
        if not try_acquire_dm_inflight(sender_username, lock_peer):
            _emit_steves_dm_text(
                sender_username=sender_username,
                body=INFLIGHT_BUSY_MESSAGE,
                other_username=other_username,
            )
            return

        try:
            _run_grok_dm_turn(
                sender_username=sender_username,
                user_message=user_message,
                other_username=other_username,
                entitlements=_ent,
            )
        finally:
            release_dm_inflight(sender_username, lock_peer)
    except Exception as e:
        logger.error("Error in Steve DM reply: %s", e, exc_info=True)
    finally:
        heartbeat.stop()
        _clear_steve_typing()


def _emit_steves_dm_text(
    *,
    sender_username: str,
    body: str,
    other_username: Optional[str],
) -> None:
    """Feedback-style short replies (no Grok): route to the correct thread."""
    from backend.services.firestore_writes import write_steves_message_human_pair_thread
    from redis_cache import cache, invalidate_message_cache

    if other_username:
        pid = _insert_steves_mysql_row_human_thread(
            sender_username=sender_username,
            peer_username=other_username,
            body=body,
        )
        if pid:
            try:
                write_steves_message_human_pair_thread(
                    human_peer_a=sender_username,
                    human_peer_b=other_username,
                    message_id=int(pid),
                    text=body,
                    mysql_receiver_username=other_username,
                )
            except Exception:
                pass
        try:
            invalidate_message_cache(sender_username, other_username)
            cache.delete(f"chat_threads:{sender_username}")
            invalidate_message_cache(other_username, sender_username)
            cache.delete(f"chat_threads:{other_username}")
        except Exception:
            pass
    else:
        from backend.services.content_generation.delivery import send_steve_dm

        send_steve_dm(receiver_username=sender_username, content=body)


def _insert_steves_mysql_row_human_thread(
    *,
    sender_username: str,
    peer_username: str,
    body: str,
) -> Optional[int]:
    from backend.services.database import get_sql_placeholder

    th = human_pair_thread_key(sender_username, peer_username)
    msg_id: Optional[int] = None
    with get_db_connection() as conn:
        c = conn.cursor()
        ensure_human_dm_thread_column(c)
        ph = get_sql_placeholder()
        if USE_MYSQL:
            c.execute(
                f"""
                INSERT INTO messages (sender, receiver, message, timestamp, human_dm_thread)
                VALUES ('steve', {ph}, {ph}, NOW(), {ph})
                """,
                (peer_username, body, th),
            )
        else:
            ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
            c.execute(
                f"""
                INSERT INTO messages (sender, receiver, message, timestamp, human_dm_thread)
                VALUES ('steve', {ph}, {ph}, {ph}, {ph})
                """,
                (peer_username, body, ts, th),
            )
        msg_id = getattr(c, "lastrowid", None)
        conn.commit()
    return int(msg_id) if msg_id else None


def _run_grok_dm_turn(
    *,
    sender_username: str,
    user_message: str,
    other_username: Optional[str],
    entitlements: Optional[dict] = None,
) -> None:
    from backend.services.community import is_app_admin
    from backend.services.steve_model_config import (
        context_limit,
        estimate_response_cost_usd,
        get_steve_model_config,
        output_cap_for_surface,
        peer_context_limit,
        response_usage_tokens,
    )
    from backend.services.steve_prompt_policy import (
        append_response_policy,
        should_include_user_profile,
    )
    from backend.services.steve_profiling_gates import user_can_access_steve_kb
    from openai import OpenAI

    if other_username:
        chat_user_a = sender_username
        chat_user_b = other_username
    else:
        chat_user_a = sender_username
        chat_user_b = "steve"

    def _steve_parse_dt(val):
        from datetime import datetime as _dt, timezone as _tz

        if val is None:
            return None
        try:
            if hasattr(val, "timestamp") and callable(getattr(val, "timestamp")):
                return _dt.utcfromtimestamp(val.timestamp())
            if isinstance(val, _dt):
                if val.tzinfo is not None:
                    return val.astimezone(_tz.utc).replace(tzinfo=None)
                return val
            if isinstance(val, str):
                s = val.strip().replace("Z", "+00:00")
                dt = _dt.fromisoformat(s)
                if dt.tzinfo is not None:
                    return dt.astimezone(_tz.utc).replace(tzinfo=None)
                return dt
        except Exception:
            pass
        return None

    recent_messages: List[str] = []
    image_urls_collected: List[str] = []
    context_reset_at = None
    reset_dt = None
    firestore_context_ok = False
    fs = None
    conv_id = None

    is_peer = bool(other_username)
    from backend.services.steve_thread_memory import dm_context_read_limit

    _peer_window = peer_context_limit(entitlements, fallback=PEER_DM_CONTEXT_LINES)
    _max_ctx = context_limit(entitlements, fallback=200)
    _read_limit = dm_context_read_limit(
        entitlements,
        is_peer=is_peer,
        peer_window=_peer_window,
        max_context=_max_ctx,
    )

    try:
        import os

        from backend.services.steve_chat_images import append_image_from_row

        FIRESTORE_DATABASE = os.environ.get("FIRESTORE_DATABASE", "cpoint")
        from google.cloud import firestore as _firestore

        project = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCP_PROJECT")
        fs = _firestore.Client(project=project, database=FIRESTORE_DATABASE) if project else _firestore.Client(database=FIRESTORE_DATABASE)

        from backend.services.firestore_reads import _find_dm_conv_id

        conv_id = _find_dm_conv_id(fs, chat_user_a, chat_user_b)
        if conv_id:
            try:
                conv_doc = fs.collection("dm_conversations").document(conv_id).get()
                if conv_doc.exists:
                    cd = conv_doc.to_dict() or {}
                    context_reset_at = cd.get("steve_context_reset_at")
                    reset_dt = _steve_parse_dt(context_reset_at)
            except Exception as reset_err:
                logger.warning("Failed to load DM conversation reset timestamp: %s", reset_err)

            msgs_ref = fs.collection("dm_conversations").document(conv_id).collection("messages")
            docs = list(
                msgs_ref.order_by("created_at", direction="DESCENDING")
                .limit(_read_limit)
                .stream()
            )
            docs.reverse()
            from backend.services.steve_thread_memory import (
                format_msg_timestamp,
                is_unsafe_context_message,
            )

            for doc in docs:
                d = doc.to_dict() or {}
                if is_unsafe_context_message(d):
                    continue
                append_image_from_row(d, image_urls_collected)
                snd = d.get("sender", "")
                text = (d.get("text") or "").strip()
                msg_ts = _steve_parse_dt(d.get("created_at"))
                if reset_dt and msg_ts and msg_ts < reset_dt:
                    continue
                ts_prefix = format_msg_timestamp(d.get("created_at"))
                if text and snd:
                    recent_messages.append(f"{ts_prefix}{snd}: {text}")
                elif snd and (d.get("image_path") or d.get("media_paths")):
                    recent_messages.append(f"{ts_prefix}{snd}: [shared a photo]")
            firestore_context_ok = True
    except Exception as fs_err:
        logger.warning("Steve DM Firestore context failed: %s", fs_err)

    if not firestore_context_ok:
        from backend.services.steve_chat_images import append_image_from_row
        from backend.services.steve_thread_memory import format_msg_timestamp as _fmt_ts

        with get_db_connection() as conn:
            c = conn.cursor()
            from backend.services.database import get_sql_placeholder

            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT sender, message, image_path, media_paths, timestamp, is_encrypted FROM messages
                WHERE (sender = {ph} AND receiver = {ph})
                   OR (sender = {ph} AND receiver = {ph})
                ORDER BY timestamp DESC
                LIMIT {int(_read_limit)}
                """,
                (chat_user_a, chat_user_b, chat_user_b, chat_user_a),
            )
            rows = list(c.fetchall())
            rows.reverse()
            for row in rows:
                if hasattr(row, "keys"):
                    row_dict = {
                        "image_path": row.get("image_path"),
                        "media_paths": row.get("media_paths"),
                    }
                    s = row["sender"]
                    m = row.get("message")
                    ts_raw = row.get("timestamp")
                    is_encrypted = bool(row.get("is_encrypted", False))
                else:
                    row_dict = {
                        "image_path": row[2] if len(row) > 2 else None,
                        "media_paths": row[3] if len(row) > 3 else None,
                    }
                    s = row[0]
                    m = row[1]
                    ts_raw = row[4] if len(row) > 4 else None
                    is_encrypted = bool(row[5]) if len(row) > 5 else False
                append_image_from_row(row_dict, image_urls_collected)
                if not s or is_encrypted:
                    continue
                row_ts = _steve_parse_dt(ts_raw) if ts_raw is not None else None
                if reset_dt and row_ts and row_ts < reset_dt:
                    continue
                ts_prefix = _fmt_ts(ts_raw)
                text = (m or "").strip() if m is not None else ""
                if text:
                    recent_messages.append(f"{ts_prefix}{s}: {text}")
                elif row_dict.get("image_path") or row_dict.get("media_paths"):
                    recent_messages.append(f"{ts_prefix}{s}: [shared a photo]")

    current_date = datetime.now().strftime("%A, %B %d, %Y at %H:%M UTC")

    from bodybuilding_app import get_steve_context_for_user

    include_own_profile = should_include_user_profile(user_message)
    if include_own_profile and user_can_access_steve_kb(sender_username, sender_username):
        user_profile_ctx = get_steve_context_for_user(sender_username)
    else:
        user_profile_ctx = ""

    mentioned_profiles = []
    mentioned_usernames = set(re.findall(r"@(\w+)", user_message)) if user_message else set()
    mentioned_usernames.discard("steve")
    mentioned_usernames.discard("Steve")
    mentioned_usernames.discard(sender_username)

    for mentioned_user in mentioned_usernames:
        if user_can_access_steve_kb(sender_username, mentioned_user):
            profile_ctx = get_steve_context_for_user(mentioned_user, viewer_username=sender_username)
            if profile_ctx:
                mentioned_profiles.append((mentioned_user, profile_ctx))

    max_context = context_limit(entitlements, fallback=200)
    verbatim_window = _peer_window if is_peer else 30
    all_messages = recent_messages[-_read_limit:]
    if len(all_messages) > verbatim_window:
        older_messages = all_messages[:-verbatim_window]
        current_messages = all_messages[-verbatim_window:]
    else:
        older_messages: List[str] = []
        current_messages = all_messages

    thread_summary_text = None
    if firestore_context_ok and conv_id:
        try:
            from backend.services.steve_thread_memory import (
                SUMMARY_SURFACE_DM,
                maybe_refresh_thread_summary,
            )

            thread_summary_text = maybe_refresh_thread_summary(
                fs_client=fs,
                collection="dm_conversations",
                doc_id=conv_id,
                all_messages=all_messages,
                verbatim_window=verbatim_window,
                entitlements=entitlements,
                sender_username=sender_username,
                surface=SUMMARY_SURFACE_DM,
                reset_dt=reset_dt,
            )
        except Exception as ts_err:
            logger.warning("Thread summary failed (non-fatal): %s", ts_err)

    # Phase 3 chat memory: semantic retrieval + structured counters for peer DMs
    chat_memory_section = ""
    counter_section = ""
    if is_peer and firestore_context_ok and conv_id:
        try:
            from backend.services.steve_chat_memory import (
                chat_memory_enabled_for_scope,
                scope_for_peer_dm,
            )
            from backend.services.steve_chat_memory_retrieval import (
                inject_chat_memory_into_context,
            )
            from backend.services.steve_chat_memory_events import (
                inject_counters_into_context,
            )

            _mem_scope = scope_for_peer_dm(conv_id)
            if chat_memory_enabled_for_scope(entitlements, _mem_scope):
                chat_memory_section = inject_chat_memory_into_context(
                    fs,
                    _mem_scope,
                    user_message,
                    recent_messages,
                    entitlements=entitlements,
                    reset_at=reset_dt,
                    username=sender_username,
                )
                counter_section = inject_counters_into_context(
                    fs,
                    _mem_scope,
                    user_message,
                    entitlements=entitlements,
                    reset_at=reset_dt,
                )
        except Exception as mem_err:
            logger.warning("Chat memory retrieval/counters failed (non-fatal): %s", mem_err)

    context = f"Direct message conversation between {chat_user_a} and {chat_user_b}:\n"
    if thread_summary_text:
        context += "=== THREAD MEMORY (structured summary of earlier conversation) ===\n"
        context += thread_summary_text
        context += "\n\n"
    if older_messages and not thread_summary_text:
        context += f"=== OLDER CONTEXT ({len(older_messages)} messages — background reference) ===\n"
        context += "\n".join(older_messages)
        context += "\n\n"
    if chat_memory_section:
        context += chat_memory_section + "\n\n"
    if counter_section:
        context += counter_section + "\n\n"
    scope = (
        f"last {len(current_messages)} messages (including the @Steve tag)"
        if is_peer
        else f"last {len(current_messages)} messages — focus here"
    )
    context += f"=== CURRENT CONVERSATION ({scope}) ===\n"
    context += "\n".join(current_messages)

    if other_username:
        context += f"\n\n{sender_username} mentioned you (@Steve). Respond helpfully using only this excerpt."
    else:
        context += f"\n\n{sender_username} is chatting with you directly. Respond naturally and helpfully."

    context += f"\n\n[Current date and time: {current_date}]"

    from backend.services.steve_chat_images import (
        STEVE_SHARED_PHOTO_USER_MESSAGE,
        build_grok_user_content,
        select_image_urls_for_turn,
        vision_focus_context_line,
        vision_system_prompt_addon,
    )

    max_imgs = 5
    try:
        if entitlements and isinstance(entitlements.get("max_images_per_turn"), int):
            max_imgs = min(max_imgs, int(entitlements["max_images_per_turn"]))
    except Exception:
        pass
    force_vision = (user_message or "").strip() == STEVE_SHARED_PHOTO_USER_MESSAGE
    image_selection = select_image_urls_for_turn(
        image_urls_collected,
        user_message,
        force=force_vision,
        max_count=max_imgs,
    )
    image_urls = image_selection.urls
    if image_urls:
        context += f"\n\n[{len(image_urls)} image(s) from the conversation are attached for you to see.]"
        context += vision_focus_context_line(image_selection)

    if context_reset_at and not is_peer:
        context += (
            f"\n\nIMPORTANT: Your conversation context was reset on {context_reset_at}. "
            "Treat messages in OLDER CONTEXT that predate this reset as background only. Focus on CURRENT."
        )

    from backend.services.steve_platform_manual import (
        SURFACE_DM,
        render_global_steve_safety_prompt,
        render_platform_manual_prompt,
        select_platform_manual_cards,
    )

    platform_manual_prompt = ""
    safety_prompt = ""
    try:
        platform_manual_prompt = render_platform_manual_prompt(
            select_platform_manual_cards(user_message, surface=SURFACE_DM)
        )
        safety_prompt = render_global_steve_safety_prompt(user_message, surface=SURFACE_DM)
    except Exception as manual_err:
        logger.warning("Steve DM platform manual load failed (non-fatal): %s", manual_err)

    if is_peer and thread_summary_text:
        history_rule = (
            "- You see a recent window of this DM plus a summary of older conversation between two members.\n"
            "- Answer naturally using both the summary and the recent messages."
        )
    elif is_peer:
        history_rule = (
            "- You see a recent window of this DM between two members, plus optional RELEVANT OLDER MEMORY (semantic retrieval) and STRUCTURED THREAD COUNTERS sections.\n"
            "- Use the older memory and counters when they answer the question. If they don't contain the needed info, say so honestly."
        )
    else:
        history_rule = "- You have access to the conversation excerpts provided below (recent window plus optional older summary).\n"

    platform_question_dm = False
    professional_dm = False
    try:
        from backend.services.steve_platform_manual import (
            is_professional_advice_intent,
            is_platform_question,
        )

        platform_question_dm = bool(is_platform_question(user_message))
        professional_dm = bool(is_professional_advice_intent(user_message))
    except Exception as manual_gate_err:
        logger.warning("Steve DM platform/manual gate failed (non-fatal): %s", manual_gate_err)

    from backend.services.steve_community_config import get_paid_steve_package_config
    from backend.services.steve_prompt_policy import (
        STEVE_EMOJI_RULES,
        STEVE_LANGUAGE_RULES,
        render_steve_external_knowledge_guidance,
    )
    from backend.services.steve_tool_policy import steve_tool_names_for_log
    from backend.services.steve_tool_router import resolve_steve_hosted_tools

    steve_pkg = get_paid_steve_package_config()
    dm_tools = resolve_steve_hosted_tools(
        user_message,
        username=sender_username,
        surface=ai_usage.SURFACE_DM,
        platform_question=platform_question_dm,
        professional_advice_question=professional_dm,
        config=steve_pkg,
    )
    has_web_tools = any(
        isinstance(t, dict) and (t.get("type") or "").strip().lower() == "web_search" for t in (dm_tools or [])
    )
    has_x_tool = any(
        isinstance(t, dict) and (t.get("type") or "").strip().lower() == "x_search" for t in (dm_tools or [])
    )
    external_blocked = not dm_tools
    caps_lines = render_steve_external_knowledge_guidance(
        web_search_attached=has_web_tools,
        x_search_attached=has_x_tool,
        external_tools_blocked=external_blocked,
    )
    admin_line = (
        "\n- As an admin, you have full platform access."
        if is_app_admin(sender_username)
        else ""
    )

    system_prompt = f"""You are Steve, a member of C-Point with extra reach, in a private 1:1 chat.

CURRENT DATE AND TIME: {current_date}

IDENTITY RULES:
- You are inside C-Point. "This platform", "the platform", "this app", "the app", and "here" mean C-Point unless the user explicitly names another platform.
- Never answer as if the user is asking about X/Twitter unless they explicitly say X, Twitter, or x.com.
- Do not call yourself an assistant, bot, chatbot, AI service, or support widget.

CONTEXT SCOPE:
{history_rule}

EXTERNAL KNOWLEDGE:
{caps_lines}{admin_line}

{STEVE_LANGUAGE_RULES}

TOOL RULES:
- For questions about C-Point, this platform, the app, communities, posts, DMs, Steve, privacy, pricing, onboarding, discovery, bugs, feedback, Paulo, founder, vision, or mission: use the C-Point Platform Manual below and do NOT use web search or X search.
- Follow **EXTERNAL KNOWLEDGE** above for when live web/X sources apply; do not contradict it.
- Only discuss X/Twitter if the user explicitly asks about X, Twitter, or x.com.

REMINDER VAULT (CRITICAL):
- You cannot save, insert, or schedule rows in the user's C-Point Reminder Vault from this chat turn by yourself.
- Do not say a reminder was saved, stored, registered, added to the Reminder Vault, added to the dashboard, or that you will fire a push at a specific time — unless the user is clearly quoting a prior message that contains the real confirmation marker **(Vault #** from the dedicated vault flow.
- Do **not** say you cancelled, cleared, removed, or deleted reminders, or that the vault was updated — you cannot do that from this chat. Only the app does when the user says **cancel reminder #**… (optionally several **#ids** in one message) or removes one in **⋯ → Reminder Vault**. If they ask to cancel, tell them to use that phrasing or the vault — do not confirm success yourself.
- If they want to see what is scheduled, point them to **⋯ → Reminder Vault** or replying **list my reminders** when that applies. Otherwise help them phrase a clear time and task without claiming it is already persisted.

{platform_manual_prompt}

{safety_prompt}

CONVERSATION INTELLIGENCE:
- Focus on messages in CURRENT CONVERSATION unless older context was provided and is directly relevant.
- Reference older context only when it helps answer the current question.

COMMUNITY & PRIVACY RULES:
- You can only share information about users if the person asking shares a community with them.
- Never reveal information about communities the user is not a member of.
- Only share profile information that has been provided to you below — do NOT make up details about users.
- If you don't have information about a mentioned user, say so honestly.

RESPONSE STYLE:
- Be helpful and concise for casual chat (2-5 sentences). For news, weather, sports, politics, markets, and current-events briefings, ignore the short casual limit and follow STEVE RESPONSE POLICY **news_current_events** (structured sections, substantive bullets, headline Markdown sources).
{STEVE_EMOJI_RULES}
- If you cannot answer, be transparent about it
- NEVER hallucinate or make up information about users — only use the profile data provided below"""

    system_prompt = append_response_policy(system_prompt, user_message, surface=SURFACE_DM)

    if image_urls:
        system_prompt += vision_system_prompt_addon(
            focus_single_image=image_selection.reply_targeted or image_selection.specific_image,
        )

    if user_profile_ctx:
        system_prompt += f"""

WHAT YOU KNOW ABOUT @{sender_username} (the person you're chatting with):
{user_profile_ctx}
Use this knowledge naturally — don't announce it, but let it guide your tone and relevance."""

    if mentioned_profiles:
        for m_username, m_ctx in mentioned_profiles:
            system_prompt += f"""

WHAT YOU KNOW ABOUT @{m_username} (mentioned in the conversation):
{m_ctx}
Only share this information if asked. Be factual — do not embellish or invent details beyond what is listed here."""

    context_for_grok = context

    model_config = get_steve_model_config()
    model_to_use = model_config.model
    max_output_tokens = output_cap_for_surface(
        entitlements,
        ai_usage.SURFACE_DM,
        model_config.max_output_tokens_dm,
    )

    logger.info(
        "Steve DM Grok model=%s tools=%s images=%s",
        model_to_use,
        steve_tool_names_for_log(dm_tools),
        len(image_urls),
    )

    client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
    user_content = build_grok_user_content(context_for_grok, image_urls)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    started = time.perf_counter()
    response = None
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(
                client.responses.create,
                model=model_to_use,
                input=messages,
                tools=dm_tools,
                max_output_tokens=max_output_tokens,
                temperature=0.7,
            )
            response = future.result(timeout=GROK_DM_TIMEOUT_SECONDS)
    except FuturesTimeoutError:
        logger.warning("Steve DM reply: Grok timeout after %ss", GROK_DM_TIMEOUT_SECONDS)
        _persist_grok_steves_reply(
            sender_username=sender_username,
            other_username=other_username,
            body=GROK_TIMEOUT_MESSAGE,
        )
        return
    response_time_ms = int((time.perf_counter() - started) * 1000)

    ai_response = response.output_text.strip() if response and hasattr(response, "output_text") and response.output_text else None

    if not ai_response:
        logger.warning("Steve DM reply: empty response from API")
        _persist_grok_steves_reply(
            sender_username=sender_username,
            other_username=other_username,
            body=GROK_EMPTY_MESSAGE,
        )
        return

    try:
        from backend.services.steve_platform_manual import append_professional_disclaimer_if_needed

        ai_response = append_professional_disclaimer_if_needed(ai_response, user_message)
    except Exception as safety_err:
        logger.warning("Steve DM safety footer failed (non-fatal): %s", safety_err)

    from bodybuilding_app import format_steve_response_links

    ai_response = format_steve_response_links(ai_response)
    if not ai_response or not ai_response.strip():
        _persist_grok_steves_reply(
            sender_username=sender_username,
            other_username=other_username,
            body=GROK_EMPTY_MESSAGE,
        )
        return

    _persist_grok_steves_reply(
        sender_username=sender_username,
        other_username=other_username,
        body=ai_response.strip(),
    )

    try:
        from backend.services.steve_credit_weights import tools_flags_from_response

        tokens_in, tokens_out = response_usage_tokens(response)
        web_t, x_t = tools_flags_from_response(response)
        ai_usage.log_usage(
            sender_username,
            surface=ai_usage.SURFACE_DM,
            request_type="steve_dm_reply",
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=estimate_response_cost_usd(response, model_config),
            response_time_ms=response_time_ms,
            model=model_to_use,
            tools_web_search=web_t,
            tools_x_search=x_t,
        )
    except Exception:
        pass


def _persist_grok_steves_reply(
    *,
    sender_username: str,
    other_username: Optional[str],
    body: str,
) -> None:
    from datetime import datetime

    from backend.services.firestore_writes import (
        write_dm_message,
        write_steves_message_human_pair_thread,
    )
    from redis_cache import cache, invalidate_message_cache

    if other_username:
        pid = _insert_steves_mysql_row_human_thread(
            sender_username=sender_username,
            peer_username=other_username,
            body=body,
        )
        if pid:
            try:
                write_steves_message_human_pair_thread(
                    human_peer_a=sender_username,
                    human_peer_b=other_username,
                    message_id=int(pid),
                    text=body,
                    mysql_receiver_username=other_username,
                )
            except Exception:
                pass
        try:
            invalidate_message_cache(sender_username, other_username)
            cache.delete(f"chat_threads:{sender_username}")
            invalidate_message_cache(other_username, sender_username)
            cache.delete(f"chat_threads:{other_username}")
        except Exception:
            pass
    else:
        with get_db_connection() as conn:
            c = conn.cursor()
            if USE_MYSQL:
                c.execute(
                    """
                    INSERT INTO messages (sender, receiver, message, timestamp)
                    VALUES (%s, %s, %s, NOW())
                    """,
                    ("steve", sender_username, body),
                )
            else:
                ts = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
                c.execute(
                    """
                    INSERT INTO messages (sender, receiver, message, timestamp)
                    VALUES (?, ?, ?, ?)
                    """,
                    ("steve", sender_username, body, ts),
                )
            conn.commit()
            steve_msg_id = getattr(c, "lastrowid", None)
        try:
            write_dm_message(sender="steve", receiver=sender_username, message_id=int(steve_msg_id), text=body)
        except Exception:
            pass
        try:
            invalidate_message_cache(sender_username, "steve")
            cache.delete(f"chat_threads:{sender_username}")
        except Exception:
            pass
