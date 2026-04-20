"""Email canonicalisation + KB-driven policy toggle.

Purpose
-------
We need a single answer to "are these two strings the same person?" across
sign-up, password reset, invitations, and abuse-prevention. The naive
``email.lower()`` check leaks these common aliases:

  * ``Foo.Bar@gmail.com`` vs ``foobar@gmail.com``  (Gmail ignores dots)
  * ``foo+spam@gmail.com`` vs ``foo@gmail.com``    (Gmail ignores ``+tag``)
  * ``FOO@GMAIL.COM``       vs ``foo@gmail.com``   (SMTP local-part should
    technically be case-sensitive but no major provider enforces it)

This module produces a **canonical form** we can store alongside the raw
email in ``users.canonical_email`` and enforce uniqueness against. The
raw email is preserved (for display, for sending mail) — the canonical
form is the account-identity key.

The service is intentionally pure: it takes a string, returns a string,
and reads policy toggles from the Knowledge Base. It never touches the
DB. Callers (the signup blueprint, any admin migration) own the write.

Dependent KB fields (page ``trial-abuse-prevention``):

    email_normalization_enabled  : bool  — master toggle. False ⇒
                                           canonical == lowered raw.

If you add a new normalization rule (e.g. strip Outlook ``++`` aliasing),
add it behind a new KB toggle, not a hard-coded branch. That is how we
roll back a bad rule without a deploy.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)


# Providers that treat ``.`` in the local-part as insignificant. Keep tight —
# applying Gmail's rules to every provider would collapse legitimate
# distinct addresses (e.g. at corporate domains that genuinely route
# ``first.last`` vs ``firstlast`` to different mailboxes).
_DOT_INSIGNIFICANT_DOMAINS = frozenset({
    "gmail.com",
    "googlemail.com",
})

# Providers that treat ``+tag`` in the local-part as a subaddress. Gmail,
# Outlook, Fastmail, ProtonMail, and iCloud all do. Most custom domains
# on popular MX providers do too, so we apply ``+`` stripping broadly —
# it is a near-universal convention.
_PLUS_ALIAS_ALWAYS = True

_EMAIL_SHAPE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_well_formed(email: str) -> bool:
    """Loose RFC-ish shape check. Enough to split on ``@`` safely."""
    return bool(email) and bool(_EMAIL_SHAPE.match(email.strip()))


def split_local_domain(email: str) -> Optional[tuple[str, str]]:
    """Return ``(local, domain)`` lower-cased, or ``None`` for malformed input."""
    if not is_well_formed(email):
        return None
    local, _, domain = email.strip().rpartition("@")
    return local.lower(), domain.lower()


def canonical_email(
    email: str,
    *,
    strip_dots_for_gmail: bool = True,
    strip_plus_alias: bool = True,
) -> str:
    """Return the canonical form of ``email``.

    Rules (applied in order):

    1. Trim whitespace and lowercase everything. Always.
    2. If local-part contains ``+``, drop the suffix starting at the first
       ``+`` (gmail/outlook/proton/icloud/fastmail-compatible).
    3. If the domain is a dot-insignificant provider (Gmail), remove all
       ``.`` characters from the local-part.

    Unknown / custom domains only get rule 1 applied. This matches how
    major providers actually route mail and avoids collapsing legitimately
    distinct corporate addresses.

    Malformed input is returned lower-cased and stripped. Callers that
    care about validity should use :func:`is_well_formed` first —
    normalising garbage in does not turn it into a real address, but we
    don't want this function to raise on a bad signup attempt.
    """
    if not email:
        return ""
    cleaned = email.strip().lower()
    parts = split_local_domain(cleaned)
    if parts is None:
        # Not a valid shape — return the cleaned string so callers can
        # still compare two malformed inputs deterministically.
        return cleaned
    local, domain = parts

    if strip_plus_alias and _PLUS_ALIAS_ALWAYS and "+" in local:
        local = local.split("+", 1)[0]

    if strip_dots_for_gmail and domain in _DOT_INSIGNIFICANT_DOMAINS:
        local = local.replace(".", "")

    if not local:
        # A pathological input like "+tag@gmail.com" — fall back to the
        # cleaned form so we don't write an empty local-part to the DB.
        return cleaned

    return f"{local}@{domain}"


# ── KB integration ──────────────────────────────────────────────────────


def is_normalization_enabled() -> bool:
    """Read the KB toggle. Defaults to True if the KB is unreachable.

    We default-ON deliberately: disabling normalization re-opens the
    dot/alias bypass that lets one human run multiple "free trials", so
    the safer fallback when the KB fetch fails is to keep normalizing.
    """
    try:
        from backend.services import knowledge_base as kb
        page = kb.get_page("trial-abuse-prevention")
    except Exception:
        return True
    if not page:
        return True
    for field in page.get("fields") or []:
        if field.get("name") == "email_normalization_enabled":
            val = field.get("value")
            if isinstance(val, bool):
                return val
            if isinstance(val, str):
                return val.strip().lower() in {"true", "1", "yes", "on"}
            return bool(val)
    return True


def canonicalize_with_policy(email: str) -> str:
    """Public entry point used by callers outside this module.

    Respects the KB toggle — if normalization is disabled, returns just
    the lowered + trimmed email so ``users.canonical_email`` still
    supports a ``UNIQUE`` constraint without the aggressive collapses.
    """
    cleaned = (email or "").strip().lower()
    if not is_normalization_enabled():
        return cleaned
    return canonical_email(cleaned)
