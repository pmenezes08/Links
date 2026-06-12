"""Deterministic fast path for plain name lookups in Steve networking.

Typing a person's name into the Steve tab used to pay the full AI pipeline
(planner Grok call + retrieval + final Grok call, ~7-15s) even though the
answer is a roster row. This module classifies a message as "essentially
just a name lookup" and resolves it deterministically in microseconds, with
NO model call: no ``ai_usage`` cost row (a zero-cost ``networking_name_lookup``
row is logged for analytics only — its distinct request_type keeps it out of
the weekly networking cap, which counts ``networking_match`` /
``networking_auto_match`` rows) and no recommendation recording (a lookup is
not a recommendation).

The classifier is deliberately ULTRA-conservative — a false positive would
silently skip the semantic pipeline. It only triggers on:

- a message that is nothing but roster @handles ("@maria", "@a and @b");
- a "who is X" style template (EN/PT/ES prefixes) whose remainder resolves
  EXACTLY (full-string, case-insensitive) to one member's username, display
  name, or legal name, and uniquely so;
- a bare name (the whole message IS the name) — but only on the FIRST turn
  of a conversation: mid-conversation a bare name is usually an answer to a
  clarifying question and must reach the full pipeline.

No substring or fuzzy resolution here ("find people like Maria" never
matches: "people like maria" is not a member's exact name). Ambiguous names
(shared by several members) fall through so Steve can ask which one.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Sequence

_HANDLE_TOKEN = r"@[a-zA-Z0-9_]{1,30}"
# "@a", "@a @b", "@a, @b", "@a and @b" / "e" (pt) / "y" (es) — nothing else.
_HANDLES_ONLY_RE = re.compile(
    rf"^\s*{_HANDLE_TOKEN}(?:\s*(?:,|and|e|y|&)?\s*{_HANDLE_TOKEN})*\s*[?.!]*\s*$",
    re.IGNORECASE,
)
_HANDLE_RE = re.compile(_HANDLE_TOKEN, re.IGNORECASE)

# Lookup templates: prefix + name + nothing else. Longest-first matching.
_LOOKUP_PREFIXES = (
    # EN
    "do you know", "who is", "who's", "whos", "look up", "lookup",
    "search for", "show me", "find",
    # PT
    "quem é", "quem e", "conheces a", "conheces o", "conheces",
    "procura por", "procura", "procurar", "encontra", "encontrar",
    "mostra-me", "mostra",
    # ES
    "quién es", "quien es", "conoces a", "conoces", "busca a", "busca",
    "buscar", "encuentra", "muéstrame", "muestrame",
)
_MAX_MESSAGE_LEN = 80


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def _identity_maps(
    member_rows: Sequence[Any], member_getter: Callable[[Any, int], Any]
) -> Dict[str, set]:
    """Map normalized username / display name / legal name -> {usernames}.

    Row layout matches the steve_match roster SELECT: 0=username,
    1=display_name, 11=first_name, 12=last_name.
    """
    owners: Dict[str, set] = {}
    for row in member_rows:
        uname = str(member_getter(row, 0) or "")
        if not uname:
            continue
        owners.setdefault(uname.lower(), set()).add(uname)
        display = _norm(str(member_getter(row, 1) or ""))
        if display:
            owners.setdefault(display, set()).add(uname)
        legal = _norm(f"{member_getter(row, 11) or ''} {member_getter(row, 12) or ''}")
        if legal:
            owners.setdefault(legal, set()).add(uname)
    return owners


def _resolve_exact_unique(candidate: str, owners: Dict[str, set]) -> Optional[str]:
    """Full-string, case-insensitive, unique resolution — no substrings."""
    matches = owners.get(_norm(candidate.lstrip("@")))
    if matches and len(matches) == 1:
        return next(iter(matches))
    return None


def try_name_lookup(
    message: str,
    member_rows: Sequence[Any],
    member_getter: Callable[[Any, int], Any],
    *,
    has_history: bool = False,
) -> Optional[Dict[str, List[str]]]:
    """Return ``{"usernames": [...]}`` when *message* is just a name lookup
    that fully resolves against the roster; ``None`` otherwise (full
    pipeline). Never raises."""
    try:
        text = (message or "").strip()
        if not text or len(text) > _MAX_MESSAGE_LEN:
            return None
        owners = _identity_maps(member_rows, member_getter)
        if not owners:
            return None

        # 1) Message is nothing but @handles.
        if _HANDLES_ONLY_RE.match(text):
            resolved = []
            for handle in _HANDLE_RE.findall(text):
                uname = _resolve_exact_unique(handle, owners)
                if not uname:
                    return None  # any unknown handle → full pipeline
                if uname not in resolved:
                    resolved.append(uname)
            return {"usernames": resolved} if resolved else None

        # 2) "who is X" template: strip ONE prefix, remainder must be the name.
        lowered = _norm(text)
        remainder = None
        for prefix in sorted(_LOOKUP_PREFIXES, key=len, reverse=True):
            if lowered.startswith(prefix + " "):
                remainder = text.strip()[len(prefix):].strip()
                break
        if remainder is not None:
            remainder = remainder.strip(" ?.!\"'")
            if remainder:
                uname = _resolve_exact_unique(remainder, owners)
                if uname:
                    return {"usernames": [uname]}
            return None  # had a lookup shape but didn't resolve → full pipeline

        # 3) Bare name — first turn only (mid-conversation a bare name is
        # usually the answer to a clarifying question).
        if not has_history:
            bare = text.strip(" ?.!\"'")
            if bare and not bare.startswith("@"):
                uname = _resolve_exact_unique(bare, owners)
                if uname:
                    return {"usernames": [uname]}
        return None
    except Exception:
        return None
