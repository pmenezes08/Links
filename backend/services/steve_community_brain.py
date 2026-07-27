"""Community Brain v1 — the writer + recall layer behind Steve's community memory.

Product goal (founder, 2026-07): Steve should feel like a person with
superpowers — he knows everything that happened in a community, but mentions
only what serves the current message ("total recall, selective expression").

This module provides the three pieces the 2026-07 review found missing:

1. **Writer** — ``refresh_all`` / ``synthesize_and_store``: a cron-driven
   synthesis that distills recent community activity (posts, comments, events,
   polls, links) into the compact ``steve_community_memory/{root_id}``
   Firestore doc that ``steve_community_memory.get_compact_community_memory``
   reads. Before this, that reader had NO writer anywhere in the repo — any
   populated doc would have been frozen forever.
2. **Freshness contract** — every doc is stamped ``updatedAt`` (UTC ISO) and
   ``sourceLatestPostTs``; the reader refuses stale docs, so memory silently
   degrades to *no memory*, never to *frozen memory*. Topics/signals are
   synthesized over a rolling window so last quarter's hot topic fades.
3. **Recall retrieval** — ``try_recall_context``: when the current message
   explicitly reaches backwards ("didn't we discuss…", "lembras-te…"), a
   lexical search over the community's own posts/replies (MySQL is already the
   full index — no embedding spend) returns dated snippets Steve can cite.

Cost guardrails (hard-learned; see the 2026-07 cron retry incident):
- One LLM call per community per run, metered via ``llm.usage_context`` →
  one real-token ``ai_usage`` row (``content_gen`` surface, request_type
  ``community_brain_refresh``).
- No retries anywhere: a failed synthesis logs and moves on.
- A run refreshes at most ``max_communities_per_run`` roots, skips roots with
  no new posts since the stored ``sourceLatestPostTs``, and skips roots below
  ``min_new_posts`` recent posts.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

logger = logging.getLogger(__name__)

FIRESTORE_COLLECTION = "steve_community_memory"
GENERATOR_TAG = "community_brain_v1"

_STOPWORDS = frozenset(
    """the this that with have from what when where will your about there their
    would could should than then them they were been being does did doing very
    just also into over under after before because while these those and for
    you are was not can how who
    uma umas uns não sim para com como mais este esta isto isso esse essa
    aquele aquela pelo pela quando onde porque quem qual quais foram será
    sobre entre muito muita depois antes ainda também tinha temos estão está
    """.split()
)

# Recall-phrase verbs are navigation words, not content terms — they would
# otherwise pollute the lexical search query.
_RECALL_VERB_WORDS = frozenset(
    """remember discussed mentioned decide decided agree agreed talked
    lembras lembraste falamos discutimos dissemos decidimos combinamos""".split()
)

# Explicit backward-reference phrasing only (EN + PT). Deliberately tight —
# an over-eager recall gate would re-create the loop-back behaviour the
# 2026-07 review removed.
_RECALL_RE = re.compile(
    r"(\bremember\b|\bdiscussed\b|\btalked about\b|\bmentioned (?:before|earlier)\b"
    r"|\blast (?:time|week|month)\b|\ba while (?:ago|back)\b"
    r"|\bwhen did we\b|\bwhat did we (?:say|decide|agree)\b|\bdid we (?:already|ever)\b"
    r"|\bearlier (?:thread|post|discussion)\b"
    r"|\blembras?(?:-te)?\b|\bfal[aá]mos\b|\bdiscutimos\b|\bdissemos\b|\bdecidimos\b"
    r"|\bcombin[aá]mos\b|\bda [uú]ltima vez\b|\bh[aá] (?:umas? )?(?:semanas?|meses?|dias?)\b"
    r"|\bj[aá] (?:fal[aá]mos|discutimos|decidimos)\b)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class BrainConfig:
    enabled: bool = True
    window_days: int = 30
    freshness_days: int = 14
    max_communities_per_run: int = 10
    min_new_posts: int = 3
    max_output_tokens: int = 600
    card_max_chars: int = 900


def get_brain_config() -> BrainConfig:
    """KB-backed Brain config (community-tiers page, ``community_brain`` group)."""
    defaults = BrainConfig()
    try:
        from backend.services import knowledge_base

        page = knowledge_base.get_page("community-tiers") or {}
        f = {
            str(field.get("name")): field.get("value")
            for field in page.get("fields") or []
            if field.get("name")
        }
    except Exception as exc:
        logger.warning("Community Brain KB config load failed, using defaults: %s", exc)
        return defaults

    def _int(name: str, default: int, minimum: int = 0) -> int:
        try:
            return max(minimum, int(f.get(name)))
        except (TypeError, ValueError):
            return default

    def _bool(name: str, default: bool) -> bool:
        raw = f.get(name)
        if raw is None:
            return default
        if isinstance(raw, bool):
            return raw
        return str(raw).strip().lower() in ("1", "true", "yes", "on")

    return BrainConfig(
        enabled=_bool("community_brain_enabled", defaults.enabled),
        window_days=_int("community_brain_window_days", defaults.window_days, 1),
        freshness_days=_int("community_brain_freshness_days", defaults.freshness_days, 1),
        max_communities_per_run=_int(
            "community_brain_max_communities_per_run", defaults.max_communities_per_run, 1
        ),
        min_new_posts=_int("community_brain_min_new_posts", defaults.min_new_posts, 1),
        max_output_tokens=_int("community_brain_max_output_tokens", defaults.max_output_tokens, 100),
        card_max_chars=_int("community_brain_card_max_chars", defaults.card_max_chars, 200),
    )


# ── Candidate discovery ─────────────────────────────────────────────────


def list_refresh_candidates(
    cursor: Any,
    ph: str,
    *,
    window_days: int,
    min_new_posts: int,
    limit: int,
) -> List[dict]:
    """Root communities with enough recent posts, busiest first.

    Returns ``[{"root_id": int, "post_count": int}]``. Sub-community activity
    rolls up to the root, matching the reader's root-scoped doc.
    """
    from backend.services import community as community_svc

    cutoff = (datetime.utcnow() - timedelta(days=window_days)).strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute(
        f"""
        SELECT community_id, COUNT(*) AS n
        FROM posts
        WHERE community_id IS NOT NULL AND timestamp >= {ph}
        GROUP BY community_id
        """,
        (cutoff,),
    )
    per_root: dict[int, int] = {}
    for row in cursor.fetchall() or []:
        cid = row["community_id"] if hasattr(row, "keys") else row[0]
        n = row["n"] if hasattr(row, "keys") else row[1]
        if not cid:
            continue
        try:
            root_id, _ = community_svc.resolve_root_community_id(int(cid))
        except Exception:
            root_id = int(cid)
        per_root[root_id] = per_root.get(root_id, 0) + int(n or 0)
    ranked = sorted(per_root.items(), key=lambda kv: kv[1], reverse=True)
    return [
        {"root_id": rid, "post_count": n}
        for rid, n in ranked
        if n >= min_new_posts
    ][: max(0, int(limit))]


# ── Activity gathering ──────────────────────────────────────────────────


def _tree_ids(cursor: Any, root_id: int) -> List[int]:
    try:
        from backend.services.community import get_descendant_community_ids

        ids = [int(root_id)] + [int(i) for i in get_descendant_community_ids(cursor, int(root_id))]
        return sorted(set(ids))
    except Exception:
        return [int(root_id)]


def _rows(cursor: Any) -> List[Any]:
    try:
        return list(cursor.fetchall() or [])
    except Exception:
        return []


def _val(row: Any, key: str, idx: int) -> Any:
    try:
        if hasattr(row, "keys") and key in row.keys():
            return row[key]
    except Exception:
        pass
    try:
        return row[idx]
    except Exception:
        return None


def gather_activity(
    cursor: Any,
    ph: str,
    *,
    root_id: int,
    window_days: int,
) -> dict:
    """Collect the synthesis inputs for one root community (defensive per section)."""
    tree = _tree_ids(cursor, root_id)
    in_clause = ", ".join([ph] * len(tree))
    cutoff = (datetime.utcnow() - timedelta(days=window_days)).strftime("%Y-%m-%d %H:%M:%S")
    activity: dict = {
        "root_id": int(root_id),
        "community_name": "",
        "posts": [],
        "replies": [],
        "events": [],
        "polls": [],
        "links": [],
        "latest_post_ts": "",
    }

    try:
        cursor.execute(f"SELECT name FROM communities WHERE id = {ph}", (int(root_id),))
        row = cursor.fetchone()
        if row:
            activity["community_name"] = str(_val(row, "name", 0) or "")
    except Exception as exc:
        logger.debug("Brain: community name fetch failed for %s: %s", root_id, exc)

    try:
        cursor.execute(
            f"""
            SELECT id, username, content, timestamp
            FROM posts
            WHERE community_id IN ({in_clause}) AND timestamp >= {ph}
            ORDER BY timestamp DESC
            LIMIT 40
            """,
            (*tree, cutoff),
        )
        for row in _rows(cursor):
            content = str(_val(row, "content", 2) or "").strip()
            if not content:
                continue
            ts = str(_val(row, "timestamp", 3) or "")
            activity["posts"].append(
                {
                    "id": int(_val(row, "id", 0) or 0),
                    "username": str(_val(row, "username", 1) or ""),
                    "content": content[:400],
                    "timestamp": ts,
                }
            )
            if ts > activity["latest_post_ts"]:
                activity["latest_post_ts"] = ts
    except Exception as exc:
        logger.warning("Brain: posts fetch failed for %s: %s", root_id, exc)

    post_ids = [p["id"] for p in activity["posts"] if p["id"]]
    if post_ids:
        try:
            reply_in = ", ".join([ph] * len(post_ids))
            cursor.execute(
                f"""
                SELECT post_id, username, content, timestamp
                FROM replies
                WHERE post_id IN ({reply_in})
                ORDER BY timestamp DESC
                LIMIT 80
                """,
                tuple(post_ids),
            )
            for row in _rows(cursor):
                content = str(_val(row, "content", 2) or "").strip()
                if not content:
                    continue
                activity["replies"].append(
                    {
                        "post_id": int(_val(row, "post_id", 0) or 0),
                        "username": str(_val(row, "username", 1) or ""),
                        "content": content[:200],
                    }
                )
        except Exception as exc:
            logger.warning("Brain: replies fetch failed for %s: %s", root_id, exc)

    try:
        cursor.execute(
            f"""
            SELECT title, date, start_time, description
            FROM calendar_events
            WHERE community_id IN ({in_clause}) AND date >= CURDATE()
            ORDER BY date ASC
            LIMIT 10
            """,
            tuple(tree),
        )
        for row in _rows(cursor):
            activity["events"].append(
                {
                    "title": str(_val(row, "title", 0) or ""),
                    "date": str(_val(row, "date", 1) or ""),
                    "start_time": str(_val(row, "start_time", 2) or ""),
                    "description": str(_val(row, "description", 3) or "")[:120],
                }
            )
    except Exception as exc:
        logger.debug("Brain: events fetch failed for %s: %s", root_id, exc)

    try:
        cursor.execute(
            f"""
            SELECT p.question
            FROM polls p JOIN posts po ON p.post_id = po.id
            WHERE po.community_id IN ({in_clause}) AND p.is_active = 1
            ORDER BY po.timestamp DESC
            LIMIT 5
            """,
            tuple(tree),
        )
        activity["polls"] = [str(_val(r, "question", 0) or "") for r in _rows(cursor)]
    except Exception as exc:
        logger.debug("Brain: polls fetch failed for %s: %s", root_id, exc)

    try:
        cursor.execute(
            f"""
            SELECT url, description
            FROM useful_links
            WHERE community_id IN ({in_clause})
            ORDER BY created_at DESC
            LIMIT 5
            """,
            tuple(tree),
        )
        activity["links"] = [
            {"url": str(_val(r, "url", 0) or ""), "description": str(_val(r, "description", 1) or "")}
            for r in _rows(cursor)
        ]
    except Exception as exc:
        logger.debug("Brain: links fetch failed for %s: %s", root_id, exc)

    return activity


# ── Synthesis ───────────────────────────────────────────────────────────


def build_synthesis_prompt(activity: dict, *, window_days: int) -> tuple[str, str]:
    """(system, user) prompts for the compact-memory synthesis call."""
    system = (
        "You distill a community's recent activity into a compact memory card for Steve, "
        "a member of C-Point with extra reach. Write in the community's dominant language. "
        "Be concrete and neutral — no marketing tone, no invented facts, no personal data "
        "beyond what members posted themselves.\n"
        "Return ONLY a JSON object with exactly these keys:\n"
        '{"currentSummary": "2-3 sentences on what this community is focused on right now",\n'
        ' "topics": ["up to 6 short recurring-topic phrases from the window"],\n'
        ' "activeDecisions": ["up to 4 open questions or decisions being made, empty list if none"],\n'
        ' "recentSignals": ["up to 4 notable recent happenings (a popular thread, a milestone, a new initiative)"],\n'
        ' "upcomingEventsSummary": "one sentence on upcoming events, empty string if none"}\n'
        f"Everything must come from the last {window_days} days of activity provided. "
        "If there is too little activity to say anything meaningful, return the JSON with "
        "empty values instead of padding."
    )
    lines: List[str] = [f"Community: {activity.get('community_name') or activity.get('root_id')}"]
    posts = activity.get("posts") or []
    replies_by_post: dict[int, List[str]] = {}
    for r in activity.get("replies") or []:
        replies_by_post.setdefault(r["post_id"], []).append(f"{r['username']}: {r['content']}")
    if posts:
        lines.append("\nRecent posts (newest first):")
        for p in posts:
            lines.append(f"- [{p['timestamp']}] {p['username']}: {p['content']}")
            for reply_line in replies_by_post.get(p["id"], [])[:4]:
                lines.append(f"    · {reply_line}")
    events = activity.get("events") or []
    if events:
        lines.append("\nUpcoming events:")
        for e in events:
            lines.append(f"- {e['title']} on {e['date']}" + (f" at {e['start_time']}" if e.get("start_time") else ""))
    polls = [p for p in activity.get("polls") or [] if p]
    if polls:
        lines.append("\nActive polls:")
        lines.extend(f"- {q}" for q in polls)
    return system, "\n".join(lines)


def parse_synthesis_json(raw: str) -> Optional[dict]:
    """Extract and validate the synthesis JSON. None on any mismatch (no retry)."""
    text = (raw or "").strip()
    if not text:
        return None
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    out = {
        "currentSummary": str(data.get("currentSummary") or "").strip(),
        "topics": [str(t).strip() for t in (data.get("topics") or []) if str(t).strip()][:6],
        "activeDecisions": [str(t).strip() for t in (data.get("activeDecisions") or []) if str(t).strip()][:4],
        "recentSignals": [str(t).strip() for t in (data.get("recentSignals") or []) if str(t).strip()][:4],
        "upcomingEventsSummary": str(data.get("upcomingEventsSummary") or "").strip(),
    }
    if not out["currentSummary"] and not out["topics"] and not out["recentSignals"]:
        return None
    return out


def synthesize_and_store(
    cursor: Any,
    ph: str,
    *,
    root_id: int,
    config: Optional[BrainConfig] = None,
) -> bool:
    """One synthesis + Firestore write for one root community. Never retries."""
    cfg = config or get_brain_config()
    activity = gather_activity(cursor, ph, root_id=root_id, window_days=cfg.window_days)
    if len(activity.get("posts") or []) < 1:
        return False

    from backend.services.content_generation import llm

    system, user = build_synthesis_prompt(activity, window_days=cfg.window_days)
    try:
        with llm.usage_context(
            username="steve",
            request_type="community_brain_refresh",
            community_id=int(root_id),
        ):
            raw = llm.generate_text(
                system,
                user,
                max_tokens=cfg.max_output_tokens,
                temperature=0.3,
                caps=None,
            )
    except Exception as exc:
        logger.warning("Brain synthesis LLM call failed for root %s: %s", root_id, exc)
        return False

    data = parse_synthesis_json(raw)
    if not data:
        logger.warning("Brain synthesis returned unusable JSON for root %s", root_id)
        return False

    try:
        from backend.services.firestore_writes import USE_FIRESTORE_WRITES, _get_client

        if not USE_FIRESTORE_WRITES:
            return False
        fs = _get_client()
        fs.collection(FIRESTORE_COLLECTION).document(str(int(root_id))).set(
            {
                **data,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "windowDays": int(cfg.window_days),
                "sourceLatestPostTs": activity.get("latest_post_ts") or "",
                "generatedBy": GENERATOR_TAG,
            }
        )
        return True
    except Exception as exc:
        logger.warning("Brain Firestore write failed for root %s: %s", root_id, exc)
        return False


def _stored_source_ts(root_id: int) -> str:
    try:
        from backend.services.firestore_reads import USE_FIRESTORE_READS, _get_client

        if not USE_FIRESTORE_READS:
            return ""
        doc = _get_client().collection(FIRESTORE_COLLECTION).document(str(int(root_id))).get()
        if doc.exists:
            return str((doc.to_dict() or {}).get("sourceLatestPostTs") or "")
    except Exception:
        pass
    return ""


def refresh_all(*, max_communities: Optional[int] = None) -> dict:
    """Cron entry point: refresh the busiest active root communities.

    Skips roots whose stored ``sourceLatestPostTs`` already covers the latest
    post (idempotent — a rerun without new activity spends nothing).
    """
    cfg = get_brain_config()
    summary = {"enabled": cfg.enabled, "checked": 0, "refreshed": 0, "skipped": 0}
    if not cfg.enabled:
        return summary
    limit = max(1, int(max_communities or cfg.max_communities_per_run))

    from backend.services.database import USE_MYSQL, get_db_connection

    ph = "%s" if USE_MYSQL else "?"
    with get_db_connection() as conn:
        cursor = conn.cursor()
        candidates = list_refresh_candidates(
            cursor,
            ph,
            window_days=cfg.window_days,
            min_new_posts=cfg.min_new_posts,
            limit=limit,
        )
        for cand in candidates:
            root_id = cand["root_id"]
            summary["checked"] += 1
            try:
                activity_probe = _stored_source_ts(root_id)
                cursor.execute(
                    f"SELECT MAX(timestamp) AS ts FROM posts WHERE community_id = {ph}",
                    (int(root_id),),
                )
                row = cursor.fetchone()
                latest_root_ts = str(_val(row, "ts", 0) or "") if row else ""
                # Sub-community posts also count; the cheap root-only probe is
                # only used to skip clearly-idle roots, never to force work.
                if activity_probe and latest_root_ts and activity_probe >= latest_root_ts:
                    tree_latest = _latest_tree_post_ts(cursor, ph, root_id)
                    if not tree_latest or activity_probe >= tree_latest:
                        summary["skipped"] += 1
                        continue
                if synthesize_and_store(cursor, ph, root_id=root_id, config=cfg):
                    summary["refreshed"] += 1
                else:
                    summary["skipped"] += 1
            except Exception as exc:
                logger.warning("Brain refresh failed for root %s (no retry): %s", root_id, exc)
                summary["skipped"] += 1
    return summary


def _latest_tree_post_ts(cursor: Any, ph: str, root_id: int) -> str:
    try:
        tree = _tree_ids(cursor, root_id)
        in_clause = ", ".join([ph] * len(tree))
        cursor.execute(
            f"SELECT MAX(timestamp) AS ts FROM posts WHERE community_id IN ({in_clause})",
            tuple(tree),
        )
        row = cursor.fetchone()
        return str(_val(row, "ts", 0) or "") if row else ""
    except Exception:
        return ""


# ── Recall retrieval (Layer 3) ──────────────────────────────────────────


def is_recall_question(user_message: str) -> bool:
    return bool(_RECALL_RE.search(user_message or ""))


def extract_recall_terms(user_message: str, *, max_terms: int = 6) -> List[str]:
    """Content-bearing search terms from the current message."""
    text = re.sub(r"(?i)@\s*steve\b", "", user_message or "")
    words = re.findall(r"[\wÀ-ž]{4,}", text)
    terms: List[str] = []
    seen = set()
    for word in words:
        lowered = word.lower()
        if (
            lowered in _STOPWORDS
            or lowered in seen
            or lowered in _RECALL_VERB_WORDS
            or _RECALL_RE.search(word)
        ):
            continue
        seen.add(lowered)
        terms.append(lowered)
        if len(terms) >= max_terms:
            break
    return terms


def try_recall_context(
    cursor: Any,
    ph: str,
    *,
    community_id: int,
    user_message: str,
    limit: int = 4,
    max_chars: int = 1200,
) -> str:
    """Dated snippets from older threads when the user explicitly reaches back.

    Lexical search over this community tree's own posts/replies. Returns ""
    unless the message contains explicit backward-reference phrasing AND at
    least one content term matches. Community-scoped by construction — never
    searches outside the tree.
    """
    if not is_recall_question(user_message):
        return ""
    terms = extract_recall_terms(user_message)
    if not terms:
        return ""
    try:
        from backend.services import community as community_svc

        root_id, _ = community_svc.resolve_root_community_id(int(community_id))
    except Exception:
        root_id = int(community_id)
    tree = _tree_ids(cursor, root_id)
    in_clause = ", ".join([ph] * len(tree))
    like_clauses = " OR ".join(["content LIKE " + ph] * len(terms))
    like_params = tuple(f"%{t}%" for t in terms)

    snippets: List[str] = []
    try:
        cursor.execute(
            f"""
            SELECT username, content, timestamp
            FROM posts
            WHERE community_id IN ({in_clause}) AND ({like_clauses})
            ORDER BY timestamp DESC
            LIMIT {int(limit)}
            """,
            (*tree, *like_params),
        )
        for row in _rows(cursor):
            content = str(_val(row, "content", 1) or "").strip()
            if content:
                snippets.append(
                    f"- [{str(_val(row, 'timestamp', 2) or '')[:10]}] post by "
                    f"{_val(row, 'username', 0)}: {content[:220]}"
                )
    except Exception as exc:
        logger.debug("Brain recall posts search failed: %s", exc)
    try:
        cursor.execute(
            f"""
            SELECT r.username, r.content, r.timestamp
            FROM replies r JOIN posts po ON r.post_id = po.id
            WHERE po.community_id IN ({in_clause}) AND ({like_clauses.replace('content LIKE', 'r.content LIKE')})
            ORDER BY r.timestamp DESC
            LIMIT {int(limit)}
            """,
            (*tree, *like_params),
        )
        for row in _rows(cursor):
            content = str(_val(row, "content", 1) or "").strip()
            if content:
                snippets.append(
                    f"- [{str(_val(row, 'timestamp', 2) or '')[:10]}] comment by "
                    f"{_val(row, 'username', 0)}: {content[:220]}"
                )
    except Exception as exc:
        logger.debug("Brain recall replies search failed: %s", exc)

    if not snippets:
        return ""
    block = (
        "Community recall (older threads in this community matching the current question — "
        "cite dates when you use them; ignore anything irrelevant):\n" + "\n".join(snippets[: limit * 2])
    )
    return block[:max_chars]
