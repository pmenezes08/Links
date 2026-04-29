"""
Steve DM reply generation (Grok) and persistence.

Orchestrates private Steve chats and @Steve mentions in human-human DMs.
Called from a background thread via :func:`run_steve_dm_reply`.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from typing import List, Optional

from backend.services.content_generation.llm import GROK_MODEL_FAST, XAI_API_KEY
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

    # ── Entitlements gate (before reminder + Grok) ──
    allowed, reason, _ent = gate_or_reason(sender_username, ai_usage.SURFACE_DM)
    if not allowed and _enforce():
        try:
            from backend.services.content_generation.delivery import send_steve_dm as _send_dm

            if reason == _errs.REASON_PREMIUM_REQUIRED:
                blocked = (
                    "Steve is a Premium feature. Upgrade in Settings → "
                    "Manage Membership to keep chatting with me."
                )
            elif reason == _errs.REASON_DAILY_CAP:
                blocked = "You've hit today's Steve limit. It resets at midnight UTC."
            else:
                blocked = (
                    "You've used up your Steve calls for this month. "
                    "See Settings → AI Usage."
                )
            _send_dm(receiver_username=sender_username, content=blocked)
        except Exception:
            pass
        try:
            ai_usage.log_block(sender_username, surface=ai_usage.SURFACE_DM, reason=reason or "unknown")
        except Exception:
            pass
        _clear_steve_typing()
        return

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

    if not XAI_API_KEY:
        logger.warning("XAI_API_KEY not configured, Steve cannot reply in DM")
        _clear_steve_typing()
        return

    try:
        _run_grok_dm_turn(
            sender_username=sender_username,
            user_message=user_message,
            other_username=other_username,
        )
    except Exception as e:
        logger.error("Error in Steve DM reply: %s", e, exc_info=True)
    finally:
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
) -> None:
    from backend.services.community import is_app_admin
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
    context_reset_at = None
    reset_dt = None
    firestore_context_ok = False
    try:
        import os

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
            docs = msgs_ref.order_by("created_at").stream()
            for doc in docs:
                d = doc.to_dict() or {}
                snd = d.get("sender", "")
                text = (d.get("text") or "").strip()
                if not text or not snd:
                    continue
                msg_ts = _steve_parse_dt(d.get("created_at"))
                if reset_dt and msg_ts and msg_ts < reset_dt:
                    continue
                recent_messages.append(f"{snd}: {text}")
            firestore_context_ok = True
    except Exception as fs_err:
        logger.warning("Steve DM Firestore context failed: %s", fs_err)

    if not firestore_context_ok:
        with get_db_connection() as conn:
            c = conn.cursor()
            from backend.services.database import get_sql_placeholder

            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT sender, message, timestamp FROM messages
                WHERE (sender = {ph} AND receiver = {ph})
                   OR (sender = {ph} AND receiver = {ph})
                ORDER BY timestamp ASC
                """,
                (chat_user_a, chat_user_b, chat_user_b, chat_user_a),
            )
            for row in c.fetchall():
                s = row["sender"] if hasattr(row, "keys") else row[0]
                m = row["message"] if hasattr(row, "keys") else row[1]
                ts_raw = row["timestamp"] if hasattr(row, "keys") else row[2]
                if not m:
                    continue
                row_ts = _steve_parse_dt(ts_raw) if ts_raw is not None else None
                if reset_dt and row_ts and row_ts < reset_dt:
                    continue
                recent_messages.append(f"{s}: {m}")

    current_date = datetime.now().strftime("%A, %B %d, %Y at %H:%M UTC")

    from bodybuilding_app import get_steve_context_for_user

    if user_can_access_steve_kb(sender_username, sender_username):
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

    is_peer = bool(other_username)
    if is_peer:
        all_messages = recent_messages[-PEER_DM_CONTEXT_LINES:]
        older_messages: List[str] = []
        current_messages = all_messages
    else:
        all_messages = recent_messages[-200:]
        if len(all_messages) > 30:
            older_messages = all_messages[:-30]
            current_messages = all_messages[-30:]
        else:
            older_messages = []
            current_messages = all_messages

    context = f"Direct message conversation between {chat_user_a} and {chat_user_b}:\n"
    if older_messages and not is_peer:
        context += f"=== OLDER CONTEXT ({len(older_messages)} messages — background reference) ===\n"
        context += "\n".join(older_messages)
        context += "\n\n"
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

    if context_reset_at and not is_peer:
        context += (
            f"\n\nIMPORTANT: Your conversation context was reset on {context_reset_at}. "
            "Treat messages in OLDER CONTEXT that predate this reset as background only. Focus on CURRENT."
        )

    from backend.services.steve_platform_manual import (
        SURFACE_DM,
        is_professional_advice_intent,
        is_platform_question,
        render_global_steve_safety_prompt,
        render_platform_manual_prompt,
        select_platform_manual_cards,
    )

    platform_manual_prompt = ""
    safety_prompt = ""
    platform_question = False
    professional_advice_question = False
    try:
        platform_question = is_platform_question(user_message)
        professional_advice_question = is_professional_advice_intent(user_message)
        platform_manual_prompt = render_platform_manual_prompt(
            select_platform_manual_cards(user_message, surface=SURFACE_DM)
        )
        safety_prompt = render_global_steve_safety_prompt(user_message, surface=SURFACE_DM)
    except Exception as manual_err:
        logger.warning("Steve DM platform manual load failed (non-fatal): %s", manual_err)

    history_rule = (
        "- You ONLY see a short excerpt above from a DM between two members — not the entire thread.\n"
        "- Do NOT claim you read their full chat history beyond this excerpt."
        if is_peer
        else "- You have access to the conversation excerpts provided below (recent window plus optional older summary).\n"
    )

    system_prompt = f"""You are Steve, a member of C-Point with extra reach, in a private 1:1 chat.

CURRENT DATE AND TIME: {current_date}

IDENTITY RULES:
- You are inside C-Point. "This platform", "the platform", "this app", "the app", and "here" mean C-Point unless the user explicitly names another platform.
- Never answer as if the user is asking about X/Twitter unless they explicitly say X, Twitter, or x.com.
- Do not call yourself an assistant, bot, chatbot, AI service, or support widget.

YOUR CAPABILITIES:
{history_rule}
- You can search the web and X/Twitter for non-C-Point current information when it is relevant
- {"As an admin, you have full platform access." if is_app_admin(sender_username) else ""}

REMINDER VAULT (CRITICAL):
- You cannot save, insert, or schedule rows in the user’s C-Point Reminder Vault from this chat turn by yourself.
- Do not say a reminder was saved, stored, registered, added to the Reminder Vault, added to the dashboard, or that you will fire a push at a specific time — unless the user is clearly quoting a prior message that contains the real confirmation marker **(Vault #** from the dedicated vault flow.
- Do **not** say you cancelled, cleared, removed, or deleted reminders, or that the vault was updated — you cannot do that from this chat. Only the app does when the user says **cancel reminder #**… (optionally several **#ids** in one message) or removes one in **⋯ → Reminder Vault**. If they ask to cancel, tell them to use that phrasing or the vault — do not confirm success yourself.
- If they want to see what is scheduled, point them to **⋯ → Reminder Vault** or replying **list my reminders** when that applies. Otherwise help them phrase a clear time and task without claiming it is already persisted.

TOOL RULES:
- For questions about C-Point, this platform, the app, communities, posts, DMs, Steve, privacy, pricing, onboarding, discovery, bugs, feedback, Paulo, founder, vision, or mission: use the C-Point Platform Manual below and do NOT use web_search or x_search.
- Only discuss X/Twitter if the user explicitly asks about X, Twitter, or x.com.

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
- Be helpful and concise (2-5 sentences for casual, longer for detailed questions)
- Use emojis occasionally
- If you cannot answer, be transparent about it
- NEVER hallucinate or make up information about users — only use the profile data provided below"""

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

    client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": context_for_grok},
    ]

    response = client.responses.create(
        model=GROK_MODEL_FAST,
        input=messages,
        tools=[]
        if (platform_question or professional_advice_question)
        else [{"type": "web_search"}, {"type": "x_search"}],
        max_output_tokens=600,
        temperature=0.7,
    )

    ai_response = response.output_text.strip() if hasattr(response, "output_text") and response.output_text else None

    if not ai_response:
        logger.warning("Steve DM reply: empty response from API")
        return

    try:
        from backend.services.steve_platform_manual import append_professional_disclaimer_if_needed

        ai_response = append_professional_disclaimer_if_needed(ai_response, user_message)
    except Exception as safety_err:
        logger.warning("Steve DM safety footer failed (non-fatal): %s", safety_err)

    from bodybuilding_app import format_steve_response_links

    ai_response = format_steve_response_links(ai_response)
    if not ai_response or not ai_response.strip():
        return

    _persist_grok_steves_reply(
        sender_username=sender_username,
        other_username=other_username,
        body=ai_response.strip(),
    )

    try:
        ai_usage.log_usage(
            sender_username,
            surface=ai_usage.SURFACE_DM,
            request_type="steve_dm_reply",
            model=GROK_MODEL_FAST,
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
