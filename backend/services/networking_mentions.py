"""Mention hygiene for Steve networking replies.

The networking prompts instruct the model to refer to members ONLY by
@username; the name a user sees next to a handle is resolved from the
database at render time (client-side, keyed by username), never taken from
model prose. These helpers enforce the handle layer server-side:

- ``inject_member_mentions``: rewrite ``**bold name**`` markers the model
  still emits into ``@username`` mentions — only when the name identifies
  exactly ONE roster member. The legacy map was last-write-wins on duplicate
  display names, which could attach the wrong handle; ambiguous names are
  now left untouched rather than guessed.
- ``sanitize_response_mentions``: strip ``@`` from handles not in the
  roster so the client never links to fake profiles.
- ``extract_recommended_usernames``: which roster members the reply
  actually mentioned (analytics / recommendation recording).
- ``find_name_mismatches`` / ``log_name_mismatches``: log-only detector for
  the hallucination class where a reply pairs one member's full name with a
  different member's handle in the same sentence. Detection only — a
  sentence may legitimately name two members, so occurrences are logged to
  make hallucination frequency observable, never rewritten silently.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

_HANDLE_RE = re.compile(r"@([a-zA-Z0-9_]{1,30})\b")
_BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
_PAREN_RE = re.compile(r"^(.+?)\s*\(([^)]+)\)$")
_SENTENCE_SPLIT_RE = re.compile(r"[.!?\n]+")


def _unique_name_map(member_names: Sequence[Tuple[str, str]]) -> Dict[str, str]:
    """Map lowercased username/display name -> username, keeping only names
    that identify exactly one roster member. Usernames are unique by schema;
    display names may collide, in which case they map to nobody."""
    owners: Dict[str, set] = {}
    for uname, dname in member_names:
        if not uname:
            continue
        owners.setdefault(uname.lower(), set()).add(uname)
        if dname and dname.lower() != uname.lower():
            owners.setdefault(dname.lower(), set()).add(uname)
    return {
        name: next(iter(unames))
        for name, unames in owners.items()
        if len(unames) == 1
    }


def sanitize_response_mentions(text: str, member_names: Sequence[Tuple[str, str]]) -> str:
    """Strip @ from handles not in the community roster so the client does not link to fake profiles."""
    if not text or not member_names:
        return text
    valid = {u.lower() for u, _ in member_names}

    def _repl(m):
        handle = m.group(1)
        if handle.lower() in valid:
            return m.group(0)
        return handle

    return _HANDLE_RE.sub(_repl, text)


def extract_recommended_usernames(text: str, member_names: Sequence[Tuple[str, str]]) -> List[str]:
    """Extract the list of @usernames that Steve actually recommended in his response."""
    if not text or not member_names:
        return []
    valid = {u.lower(): u for u, _d in member_names}
    found = set()
    for m in re.finditer(r"@(\w+)", text):
        uname = m.group(1)
        if uname.lower() in valid:
            found.add(valid[uname.lower()])
    return list(found)


def inject_member_mentions(text: str, member_names: Sequence[Tuple[str, str]]) -> str:
    """Replace **username** or **display_name** bold markers with @username mentions.

    Handles patterns Grok commonly produces:
        **@jh1987**  |  **Jonas**  |  **@jh1987 (Jonas)**  |  **Jonas (jh1987)**

    A display name shared by several roster members is never mapped — the
    bold text is left as-is instead of guessing which member was meant.
    """
    if not text or not member_names:
        return text
    name_to_username = _unique_name_map(member_names)

    def _replace_bold(match):
        raw = match.group(1).strip()
        name = raw.lstrip("@")
        lower = name.lower()
        if lower in name_to_username:
            return f"@{name_to_username[lower]}"
        # Handle "@username (DisplayName)" or "DisplayName (username)"
        paren_match = _PAREN_RE.match(name)
        if paren_match:
            part1 = paren_match.group(1).strip().lstrip("@")
            part2 = paren_match.group(2).strip().lstrip("@")
            if part1.lower() in name_to_username:
                return f"@{name_to_username[part1.lower()]}"
            if part2.lower() in name_to_username:
                return f"@{name_to_username[part2.lower()]}"
        return match.group(0)

    return _BOLD_RE.sub(_replace_bold, text)


def _full_name_owner_map(
    member_identities: Sequence[Tuple[str, str, str]],
) -> Dict[str, str]:
    """Map lowercased FULL names (display/legal, two+ tokens) -> username,
    only when the name identifies exactly one member. Single-token names are
    skipped: they appear in normal prose too often to flag reliably."""
    owners: Dict[str, set] = {}
    for identity in member_identities:
        uname = identity[0]
        if not uname:
            continue
        for name in identity[1:]:
            name = (name or "").strip()
            if name and " " in name and name.lower() != uname.lower():
                owners.setdefault(name.lower(), set()).add(uname)
    return {
        name: next(iter(unames))
        for name, unames in owners.items()
        if len(unames) == 1
    }


def find_name_mismatches(
    text: str,
    member_identities: Sequence[Tuple[str, str, str]],
) -> List[Dict[str, Any]]:
    """Detect sentences that pair a roster member's full name with a DIFFERENT
    member's handle (and the name owner's own handle is absent).

    ``member_identities`` is ``(username, display_name, legal_name)`` per
    roster member. Returns one record per (sentence, name) hit:
    ``{"name", "name_owner", "handles_in_sentence", "sentence"}``.
    """
    if not text or not member_identities:
        return []
    name_owner = _full_name_owner_map(member_identities)
    if not name_owner:
        return []
    roster_handles = {i[0].lower() for i in member_identities if i[0]}

    mismatches: List[Dict[str, Any]] = []
    for sentence in _SENTENCE_SPLIT_RE.split(text):
        if not sentence.strip():
            continue
        handles = {
            h.lower()
            for h in _HANDLE_RE.findall(sentence)
            if h.lower() in roster_handles
        }
        if not handles:
            continue
        lowered = sentence.lower()
        for name, owner in name_owner.items():
            owner_l = owner.lower()
            if owner_l in handles:
                continue
            if re.search(r"(?<!\w)" + re.escape(name) + r"(?!\w)", lowered):
                mismatches.append(
                    {
                        "name": name,
                        "name_owner": owner,
                        "handles_in_sentence": sorted(handles),
                        "sentence": sentence.strip()[:200],
                    }
                )
    return mismatches


def log_name_mismatches(
    text: str,
    member_identities: Sequence[Tuple[str, str, str]],
    *,
    context: str = "",
    username: str = "",
    community_id: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Log-only guardrail: record every name/handle mismatch in a final reply.

    Never raises and never modifies the text — the render path resolves names
    by username from the DB, so a logged mismatch is observability, not a
    user-facing bug anymore.
    """
    try:
        mismatches = find_name_mismatches(text, member_identities)
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("networking name-mismatch detection failed (%s): %s", context, e)
        return []
    if mismatches:
        logger.warning(
            "networking name-mismatch detected context=%s user=%s community=%s count=%d details=%s",
            context,
            username,
            community_id,
            len(mismatches),
            mismatches,
        )
    return mismatches
