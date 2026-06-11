"""Steve post summaries — authorized, gated, cached, and logged.

Replaces the legacy ``GET /api/post/<id>/summary`` handler that lived in the
``bodybuilding_app`` monolith, which violated three invariants: it called the
xAI API directly with no entitlements gate, wrote no ``ai_usage_log`` rows,
and let any logged-in user summarize any post by id (no community-membership
authorization). This service restores all three, and adds the economics
layer (KB-driven config, Redis cache, per-24h backstop):

* requester must be a member of the post's community (non-enumerating 404);
* summaries are cached per ``post_id + reply_count`` — viewer-independent
  by construction (the prompt mirrors the discussion's language, and no
  profile/KB enrichment enters the context), so one generation serves the
  whole community. Cache hits log nothing and debit nothing;
* generations are gated via ``check_steve_access`` with ``community_id``
  so in-community calls draw from the Steve Community Package pool
  (blocked calls get their ``log_block`` row inside the gate), plus a
  KB-tunable per-user daily backstop independent of the general caps;
* exactly one ``ai_usage.log_usage`` row per upstream call, surface
  ``post_summary`` (credit weight comes from steve_credit_weights / the KB).

All knobs (kill switch, affordance thresholds, TTL, backstop, model) live
on the ``post-summary`` KB page — never hardcoded in Python or TS.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

from redis_cache import cache as _shared_cache

from backend.services import ai_usage
from backend.services import entitlements_errors as errs
from backend.services import knowledge_base
from backend.services.ai_usage import SURFACE_POST_SUMMARY
from backend.services.community import is_app_admin
from backend.services.community_access import user_is_member_of_community
from backend.services.content_generation.llm import GROK_MODEL_FAST, XAI_API_KEY
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.entitlements_gate import check_steve_access
from backend.services.feature_flags import entitlements_enforcement_enabled
from backend.services.steve_model_config import (
    estimate_call_cost_usd,
    response_usage_tokens,
)

logger = logging.getLogger(__name__)

DISCUSSION_CHAR_CAP = 8000
FALLBACK_MAX_OUTPUT_TOKENS = 500

SYSTEM_PROMPT = """You are a helpful assistant that summarizes social media discussions.

LANGUAGE RULE: Detect the language of the discussion and write your summary in THAT SAME language.
- If the discussion is in Portuguese, write the summary in European Portuguese (PT-PT).
- If in English, write in English.
- If in Spanish, write in Spanish.

Create a clear, concise summary that captures:
1. The main topic or point of the original post
2. Key points raised in the comments
3. Any consensus or disagreements
4. Notable insights or conclusions

Keep the summary to 3-5 sentences maximum. Be objective and informative."""

_NOT_FOUND: Tuple[Dict[str, Any], int] = ({"success": False, "error": "Post not found"}, 404)


# ── KB-backed config ────────────────────────────────────────────────────


@dataclass(frozen=True)
class PostSummaryConfig:
    enabled: bool = True
    min_replies_for_affordance: int = 5
    min_thread_chars_for_affordance: int = 600
    cache_ttl_seconds: int = 21600
    calls_per_user_per_24h: int = 50
    model: str = GROK_MODEL_FAST


def get_post_summary_config() -> PostSummaryConfig:
    """Load the ``post-summary`` KB page; malformed/missing values fall back
    to conservative defaults so a KB issue cannot make the surface unbounded."""
    defaults = PostSummaryConfig()
    try:
        page = knowledge_base.get_page("post-summary") or {}
        fields = {f.get("name"): f.get("value") for f in (page.get("fields") or []) if f.get("name")}
    except Exception as exc:
        logger.warning("Could not load post-summary KB page: %s", exc)
        return defaults

    def _int(name: str, fallback: int, minimum: int = 0) -> int:
        try:
            return max(minimum, int(fields.get(name)))
        except Exception:
            return fallback

    def _bool(name: str, fallback: bool) -> bool:
        val = fields.get(name)
        if isinstance(val, bool):
            return val
        if isinstance(val, str):
            return val.strip().lower() in ("true", "1", "yes")
        return fallback

    model = fields.get("summary_model")
    return PostSummaryConfig(
        enabled=_bool("post_summary_enabled", defaults.enabled),
        min_replies_for_affordance=_int("min_replies_for_affordance", defaults.min_replies_for_affordance),
        min_thread_chars_for_affordance=_int(
            "min_thread_chars_for_affordance", defaults.min_thread_chars_for_affordance
        ),
        cache_ttl_seconds=_int("cache_ttl_seconds", defaults.cache_ttl_seconds, minimum=1),
        calls_per_user_per_24h=_int("calls_per_user_per_24h", defaults.calls_per_user_per_24h, minimum=1),
        model=str(model) if model else defaults.model,
    )


# ── Cache + backstop helpers ────────────────────────────────────────────


def _cache_key(post_id: int, reply_count: int) -> str:
    # Reply count in the key makes invalidation automatic: a new reply
    # changes the key and the stale entry simply ages out via TTL.
    return f"post_summary:v1:{int(post_id)}:{int(reply_count)}"


def _generations_last_24h(username: str) -> int:
    """Successful post_summary generations for ``username`` in 24h.

    Cache hits never log, so this naturally counts only real spend.
    """
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                SELECT COUNT(*) AS n FROM ai_usage_log
                WHERE username = {ph} AND surface = {ph} AND success = 1
                  AND created_at >= {ph}
                """,
                (
                    username,
                    SURFACE_POST_SUMMARY,
                    time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(time.time() - 86400)),
                ),
            )
            row = c.fetchone()
            return int(row["n"] if hasattr(row, "keys") else row[0]) if row else 0
    except Exception as exc:
        logger.warning("post_summary backstop count failed: %s", exc)
        return 0


# ── Core flow ───────────────────────────────────────────────────────────


def _load_discussion(
    username: str, post_id: int
) -> Tuple[Optional[Tuple[str, int, Optional[int]]], Optional[Tuple[Dict[str, Any], int]]]:
    """Fetch and authorize the post, returning (discussion, reply_count, community_id).

    Membership in the post's community (or its parent) is an authorization
    decision made here, server-side; failures are indistinguishable from a
    missing post so post ids cannot be enumerated.
    """
    with get_db_connection() as conn:
        c = conn.cursor()
        ph = get_sql_placeholder()

        c.execute(
            f"SELECT id, username, content, community_id FROM posts WHERE id = {ph}",
            (post_id,),
        )
        post_raw = c.fetchone()
        if not post_raw:
            return None, _NOT_FOUND

        post_author = post_raw["username"] if hasattr(post_raw, "keys") else post_raw[1]
        post_content = post_raw["content"] if hasattr(post_raw, "keys") else post_raw[2]
        community_id = post_raw["community_id"] if hasattr(post_raw, "keys") else post_raw[3]

        if community_id is not None:
            if not is_app_admin(username) and not user_is_member_of_community(
                c, ph, username, int(community_id)
            ):
                return None, _NOT_FOUND

        c.execute(
            f"""
            SELECT username, content, timestamp
            FROM replies
            WHERE post_id = {ph}
            ORDER BY timestamp ASC
            """,
            (post_id,),
        )
        replies_raw = c.fetchall()

    discussion_parts = [f"Original post by @{post_author}:\n{post_content}"]
    if replies_raw:
        discussion_parts.append("\n\nComments and replies:")
        for reply in replies_raw:
            reply_author = reply["username"] if hasattr(reply, "keys") else reply[0]
            reply_content = reply["content"] if hasattr(reply, "keys") else reply[1]
            discussion_parts.append(f"\n@{reply_author}: {reply_content}")

    full_discussion = "\n".join(discussion_parts)
    if len(full_discussion) > DISCUSSION_CHAR_CAP:
        full_discussion = full_discussion[:DISCUSSION_CHAR_CAP] + "\n\n[Discussion truncated due to length...]"

    return (full_discussion, len(replies_raw), community_id), None


def generate_post_summary(username: str, post_id: int) -> Tuple[Dict[str, Any], int]:
    """Authorize → cache → gate → call Grok → log → cache. Returns (body, status)."""
    config = get_post_summary_config()
    if not config.enabled:
        return {"success": False, "error": "AI service not available"}, 503
    if not XAI_API_KEY:
        return {"success": False, "error": "AI service not available"}, 503

    try:
        loaded, error = _load_discussion(username, post_id)
    except Exception as err:
        logger.error("post_summary load failed for post %s: %s", post_id, err, exc_info=True)
        return {"success": False, "error": "Failed to generate summary"}, 500
    if error:
        return error
    assert loaded is not None
    full_discussion, reply_count, community_id = loaded

    # Cache before the gate: a hit costs nothing, so it isn't gated, isn't
    # debited, and isn't logged. Only generations spend.
    key = _cache_key(post_id, reply_count)
    try:
        cached = _shared_cache.get(key)
    except Exception as exc:
        logger.warning("post_summary cache get failed for %s: %s", key, exc)
        cached = None
    if isinstance(cached, dict) and cached.get("summary"):
        return {
            "success": True,
            "summary": cached["summary"],
            "post_id": post_id,
            "reply_count": reply_count,
            "cached": True,
            "generated_at": cached.get("generated_at"),
        }, 200

    # Gate after authz so a non-member probe never reveals cap state. The
    # gate logs its own log_block row on denial; community_id routes the
    # debit to the Steve Community Package pool when one is active.
    allowed, payload, status, ent = check_steve_access(
        username, SURFACE_POST_SUMMARY, community_id=community_id
    )
    if not allowed and entitlements_enforcement_enabled():
        return payload or {"success": False, "error": "Not available"}, status or 403
    if not allowed:
        logger.info(
            "post_summary soft-block (flag off): user=%s reason=%s",
            username,
            (payload or {}).get("reason"),
        )

    # Per-surface daily backstop, independent of the general Steve caps.
    if _generations_last_24h(username) >= config.calls_per_user_per_24h:
        ai_usage.log_block(
            username,
            surface=SURFACE_POST_SUMMARY,
            reason=errs.REASON_DAILY_CAP,
            community_id=community_id,
        )
        payload, status = errs.build_error(errs.REASON_DAILY_CAP, ent=ent)
        return payload, status

    max_output_tokens = FALLBACK_MAX_OUTPUT_TOKENS
    try:
        cap = ent.get("max_output_tokens_feed")
        if cap:
            max_output_tokens = max(1, int(cap))
    except Exception:
        pass

    from openai import OpenAI

    client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
    started = time.perf_counter()
    try:
        response = client.chat.completions.create(
            model=config.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Please summarize this discussion:\n\n{full_discussion}"},
            ],
            max_tokens=max_output_tokens,
            temperature=0.5,
        )
    except Exception as err:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        ai_usage.log_usage(
            username,
            surface=SURFACE_POST_SUMMARY,
            request_type="post_summary",
            success=False,
            reason_blocked="upstream_error",
            response_time_ms=elapsed_ms,
            community_id=community_id,
            model=config.model,
        )
        logger.error("post_summary upstream call failed for post %s: %s", post_id, err)
        return {"success": False, "error": "Failed to generate summary"}, 500

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    summary = response.choices[0].message.content.strip() if response.choices else None
    tokens_in, tokens_out = response_usage_tokens(response)

    ai_usage.log_usage(
        username,
        surface=SURFACE_POST_SUMMARY,
        request_type="post_summary",
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=estimate_call_cost_usd(tokens_in, tokens_out),
        success=bool(summary),
        response_time_ms=elapsed_ms,
        community_id=community_id,
        model=config.model,
    )

    if not summary:
        return {"success": False, "error": "Failed to generate summary"}, 500

    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        _shared_cache.set(key, {"summary": summary, "generated_at": generated_at}, config.cache_ttl_seconds)
    except Exception as exc:
        logger.warning("post_summary cache set failed for %s: %s", key, exc)

    return {
        "success": True,
        "summary": summary,
        "post_id": post_id,
        "reply_count": reply_count,
        "cached": False,
        "generated_at": generated_at,
    }, 200
