"""Disposable / throwaway email domain blocklist.

Purpose
-------
Stop obvious single-use mail services (mailinator, 10minutemail, guerrilla
mail, etc.) from being used to farm free trials. A motivated attacker
with a custom domain will still get through — that's what the other
abuse-prevention layers (device fingerprint, IP throttle, canonical
email) are for. This layer is the cheap, high-precision first check.

Design
------
- **Bundled default list** lives at
  ``backend/data/disposable_email_domains.txt``. Tight + curated — a bad
  list causes false-positive signup rejections, which hurt real users.
- **KB override** on page ``trial-abuse-prevention`` can add more
  domains without a redeploy. We union, never intersect, so the bundled
  minimum is always in effect.
- **KB toggle** ``disposable_email_blocked`` gates enforcement. False
  means we still *compute* the answer (so the admin-web can show "this
  email would have been blocked") but don't reject signup.
- No DB writes. No network. In-process cache of the parsed list;
  ``reload()`` forces a refresh after a KB edit.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import FrozenSet, Optional

logger = logging.getLogger(__name__)


_DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "disposable_email_domains.txt",
)

_lock = threading.Lock()
_cached: Optional[FrozenSet[str]] = None


def _parse_file(path: str) -> FrozenSet[str]:
    out: set[str] = set()
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                out.add(line.lower())
    except OSError as exc:
        logger.warning("Could not read disposable-domains file %s: %s", path, exc)
    return frozenset(out)


def _load_kb_extras() -> FrozenSet[str]:
    """Pull KB-supplied extras, if any, from ``trial-abuse-prevention``.

    The admin-web exposes ``disposable_domains_blocklist_extra`` as a
    newline- or comma-separated string. Graceful on missing fields.
    """
    try:
        from backend.services import knowledge_base as kb
        page = kb.get_page("trial-abuse-prevention")
    except Exception:
        return frozenset()
    if not page:
        return frozenset()
    raw: Optional[str] = None
    for field in page.get("fields") or []:
        if field.get("name") == "disposable_domains_blocklist_extra":
            raw = field.get("value")
            break
    if not raw:
        return frozenset()
    tokens = []
    for chunk in str(raw).replace(",", "\n").splitlines():
        t = chunk.strip().lower()
        if t and not t.startswith("#"):
            tokens.append(t)
    return frozenset(tokens)


def _domains() -> FrozenSet[str]:
    global _cached
    if _cached is not None:
        return _cached
    with _lock:
        if _cached is not None:
            return _cached
        bundled = _parse_file(_DATA_PATH)
        extras = _load_kb_extras()
        _cached = bundled | extras
        return _cached


def reload() -> int:
    """Force-reload from disk + KB. Returns the new domain count.

    Called by the KB update handler so admin edits take effect without
    a redeploy.
    """
    global _cached
    with _lock:
        _cached = None
    return len(_domains())


def is_blocking_enabled() -> bool:
    """Read the KB toggle. Defaults to True (the safer posture).

    If the KB is unreachable we still enforce the bundled list — the cost
    of blocking a legitimate yopmail user during an outage is far lower
    than the cost of letting 10minutemail farm trials.
    """
    try:
        from backend.services import knowledge_base as kb
        page = kb.get_page("trial-abuse-prevention")
    except Exception:
        return True
    if not page:
        return True
    for field in page.get("fields") or []:
        if field.get("name") == "disposable_email_blocked":
            val = field.get("value")
            if isinstance(val, bool):
                return val
            if isinstance(val, str):
                return val.strip().lower() in {"true", "1", "yes", "on"}
            return bool(val)
    return True


def is_disposable(email: str) -> bool:
    """Pure check: is ``email``'s domain on the blocklist?

    Does *not* consult the KB toggle — callers that want enforcement
    should compose ``is_blocking_enabled() and is_disposable(email)``.
    That separation lets admin tools show "would-be-blocked" stats even
    when enforcement is off.
    """
    if not email or "@" not in email:
        return False
    domain = email.rsplit("@", 1)[-1].strip().lower()
    if not domain:
        return False
    return domain in _domains()


def should_block(email: str) -> bool:
    """Single-call helper for signup handlers."""
    return is_blocking_enabled() and is_disposable(email)


def domain_count() -> int:
    """Expose the loaded domain count for admin dashboards / tests."""
    return len(_domains())
