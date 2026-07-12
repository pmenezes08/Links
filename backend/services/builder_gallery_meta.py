"""Gallery curation pass for Explore Creations ("Made with Steve").

One cheap, metered LLM call per gallery listing that does two jobs at once:

1. Confirms/fills the creation's sub-category from the closed per-section enum
   in ``builder.BUILDER_CATEGORIES`` (the free keyword classifier at build time
   is the default; this pass only fills or corrects it at the moment a creation
   actually enters the gallery — tiny opt-in volume, so the spend is bounded by
   listings, not builds).
2. Writes ``gallery_hook`` — a one-line, Steve-voiced card hook replacing the
   static "Made with Steve" boilerplate.

Invariants honoured:
- Never a raw vendor call: goes through ``content_generation.llm`` inside a
  ``usage_context``, so the call logs exactly one ``ai_usage`` row
  (surface=``content_gen``, request_type=``builder_gallery_meta``) with real
  tokens/cost. No cron, no batch loop — event-driven at approval time.
- Best-effort by contract: callers (``builder.update_gallery_status``) wrap
  this in try/except; a listing must never fail because curation did.
- An existing category is NEVER overwritten (admin/keyword assignments win);
  the model only fills blanks. An unparseable or out-of-enum answer degrades
  to "untagged", never to a wrong shelf.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, Optional

from backend.services import ai_usage
from backend.services.content_generation import llm
from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

_HOOK_MAX_CHARS = 90
_TIMEOUT_SECONDS = 20.0

_SYSTEM_PROMPT = (
    "You are Steve, C-Point's builder. You are curating the anonymous 'Made with "
    "Steve' gallery. Given a creation's title, kind, and the request it was built "
    "from, reply with STRICT JSON only: {\"category\": <one slug from the allowed "
    "list, or null if genuinely unsure>, \"hook\": <one line, max 90 characters, "
    "that makes a member want to open it>}. The hook is warm, specific and "
    "playful — never salesy, no emoji, no quotes, no exclamation spam, and it "
    "must not mention who built it or any community (creators stay private)."
)


def _first_prompt(prompt_history: Any) -> str:
    """First user ask only — enough signal to classify, nothing sensitive."""
    try:
        parsed = json.loads(prompt_history) if isinstance(prompt_history, str) else prompt_history
        if isinstance(parsed, list) and parsed:
            first = parsed[0]
            if isinstance(first, dict):
                return str(first.get("text") or first.get("prompt") or "")[:600]
            return str(first)[:600]
    except Exception:
        pass
    return ""


def _parse_response(raw: str) -> Dict[str, Any]:
    text = (raw or "").strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def ensure_gallery_meta(creation_id: int) -> Optional[Dict[str, Any]]:
    """Fill missing gallery metadata for an approved creation. Idempotent:
    returns immediately (no model call, no spend) when both category and hook
    already exist."""
    from backend.services import builder  # local import; builder imports us lazily too

    creation = builder.get_creation(int(creation_id))
    if not creation:
        return None
    has_category = bool(creation.get("category"))
    has_hook = bool(creation.get("gallery_hook"))
    if has_category and has_hook:
        return {"category": creation.get("category"), "hook": creation.get("gallery_hook"), "spent": False}

    section = builder._public_kind(creation.get("public_kind") or creation.get("kind"))
    allowed = list(builder.BUILDER_CATEGORIES.get(section) or [])
    owner = str(creation.get("created_by") or "")
    title = str(creation.get("title") or "Untitled")[:200]
    ask = _first_prompt(creation.get("prompt_history"))

    user_prompt = (
        f"Title: {title}\nKind: {section}\n"
        f"Original request: {ask or '(not available)'}\n"
        f"Allowed category slugs: {', '.join(allowed)}\n"
        "JSON:"
    )
    with llm.usage_context(username=owner, request_type="builder_gallery_meta",
                           community_id=creation.get("community_id"),
                           surface=ai_usage.SURFACE_CONTENT_GEN):
        raw = llm.generate_text(_SYSTEM_PROMPT, user_prompt, max_tokens=200,
                                temperature=0.5, caps=None, timeout=_TIMEOUT_SECONDS)
    parsed = _parse_response(raw)

    category = None
    if not has_category:
        slug = str(parsed.get("category") or "").strip().lower()
        category = slug if slug in allowed else None
    hook = None
    if not has_hook:
        hook_text = re.sub(r"\s+", " ", str(parsed.get("hook") or "")).strip().strip('"')
        hook = hook_text[:_HOOK_MAX_CHARS] if hook_text else None

    if not category and not hook:
        return {"category": creation.get("category"), "hook": creation.get("gallery_hook"), "spent": True}

    sets = []
    params: list = []
    ph = get_sql_placeholder()
    if category:
        sets.append(f"category = {ph}")
        params.append(category)
    if hook:
        sets.append(f"gallery_hook = {ph}")
        params.append(hook)
    params.append(int(creation_id))
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"UPDATE creations SET {', '.join(sets)} WHERE id = {ph}", tuple(params))
        conn.commit()
    return {"category": category or creation.get("category"),
            "hook": hook or creation.get("gallery_hook"), "spent": True}
