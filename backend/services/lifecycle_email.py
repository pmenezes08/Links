"""Lifecycle email chokepoint — the ONLY sanctioned path for non-transactional mail.

Classification (see docs/PRODUCT_JOURNEYS.md § Lifecycle email):

* **transactional** — password reset, signup verification, community invites,
  billing. Never suppressed; callers keep using
  :func:`backend.services.transactional_email.send` directly.
* **lifecycle** — welcome, activation nudges, digests. Send-by-default but
  suppressible; every send goes through :func:`send` here, which checks
  :mod:`backend.services.email_preferences`, appends the localized
  unsubscribe/legal footer, and attaches RFC 8058 one-click headers
  (``List-Unsubscribe`` + ``List-Unsubscribe-Post`` — a Gmail/Yahoo
  bulk-sender requirement).
* **marketing** — broadcasts/announcements. Explicit opt-in
  (``marketing_optin``); not built yet, but the category is enforced here
  so it can never inherit lifecycle's send-by-default.

Kill switch: real sends require ``LIFECYCLE_EMAIL_ENABLED`` (off by default —
staging shares the prod DB, same doctrine as OWNER_PULSE_ENABLED).

Templates embed the literal placeholder ``{{unsubscribe_footer}}`` (via
:data:`FOOTER_PLACEHOLDER`); this module substitutes the recipient's
tokenized footer at send time so no template can forget it.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services import i18n
from backend.services import email_preferences
from backend.services import transactional_email
from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

CATEGORY_LIFECYCLE = "lifecycle"
CATEGORY_MARKETING = "marketing"

FOOTER_PLACEHOLDER = "<!--UNSUBSCRIBE_FOOTER-->"
FOOTER_TEXT_PLACEHOLDER = "[[UNSUBSCRIBE_FOOTER]]"


def _enabled() -> bool:
    return (os.environ.get("LIFECYCLE_EMAIL_ENABLED") or "").strip().lower() in {
        "1", "true", "yes", "on",
    }


def public_base_url() -> str:
    return (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/") or "https://www.c-point.co"


def unsubscribe_url(token: str) -> str:
    return f"{public_base_url()}/email/unsubscribe?t={token}"


def user_email_and_locale(username: str) -> tuple[Optional[str], str]:
    """Recipient address + best-known locale for email rendering.

    Locale chain: explicit ``preferred_locale`` → ``signup_locale`` (the
    Accept-Language guess captured when the users row was created) → ``en``.
    ``signup_locale`` is email-only on purpose: it must not leak into the
    in-app resolution chain, where headers still win for undecided users.
    """
    ph = get_sql_placeholder()
    row = None
    n_cols = 0
    # Progressive fallback: locale columns are added lazily by
    # backend.services.user_locale; environments that predate them must
    # still resolve the address.
    for cols in ("email, preferred_locale, signup_locale", "email, preferred_locale", "email"):
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute(
                    f"SELECT {cols} FROM users WHERE username = {ph}", (username,)
                )
                row = c.fetchone()
            n_cols = cols.count(",") + 1
            break
        except Exception:
            continue
    if row is None:
        if n_cols == 0:
            logger.warning("user_email_and_locale lookup failed for %s", username)
        return None, i18n.DEFAULT_LOCALE

    def _val(key, idx):
        if hasattr(row, "keys"):
            return row[key] if key in row.keys() else None
        return row[idx] if len(row) > idx else None

    email = _val("email", 0)
    preferred = _val("preferred_locale", 1) if n_cols >= 2 else None
    signup = _val("signup_locale", 2) if n_cols >= 3 else None
    locale = i18n.match_locale(preferred) or i18n.match_locale(signup) or i18n.DEFAULT_LOCALE
    return (str(email).strip() if email else None), locale


def render_footer(locale: str, token: str) -> tuple[str, str]:
    """(html, text) unsubscribe + legal footer in the recipient's locale.

    The physical postal address is a CAN-SPAM requirement for lifecycle /
    marketing mail; it comes from ``EMAIL_LEGAL_ADDRESS`` (set before prod).
    """
    loc = i18n.normalize_locale(locale)
    reason = i18n.t("email.footer.reason", loc)
    unsub_label = i18n.t("email.footer.unsubscribe_label", loc)
    url = unsubscribe_url(token)
    legal_address = (os.environ.get("EMAIL_LEGAL_ADDRESS") or "").strip()
    legal_line = f"C-Point · {legal_address}" if legal_address else "C-Point · c-point.co"
    html = (
        '<tr><td style="padding:18px 30px 26px;border-top:1px solid #E5E9EF;">'
        '<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#536471;">'
        f'{reason} <a href="{url}" style="color:#536471;text-decoration:underline;">{unsub_label}</a>'
        "</p>"
        f'<p style="margin:0;font-size:12px;line-height:1.6;color:#8A94A6;">{legal_line}</p>'
        "</td></tr>"
    )
    text = f"\n--\n{reason} {unsub_label}: {url}\n{legal_line}\n"
    return html, text


def send(
    username: str,
    *,
    kind: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    category: str = CATEGORY_LIFECYCLE,
) -> str:
    """Send one lifecycle/marketing email to ``username``.

    Returns a status string for cron counters:
    ``"sent" | "disabled" | "suppressed" | "no_email" | "error"``.
    """
    if category not in (CATEGORY_LIFECYCLE, CATEGORY_MARKETING):
        raise ValueError(f"lifecycle_email.send got non-lifecycle category {category!r}")
    if not _enabled():
        return "disabled"

    email, _locale = user_email_and_locale(username)
    if not email:
        return "no_email"
    if not email_preferences.may_send(username, category=category):
        return "suppressed"
    prefs = email_preferences.get_or_create(username, email)
    if not prefs:
        return "error"
    # Re-check on the fresh row: get_or_create may have surfaced a
    # concurrent opt-out the earlier read missed.
    if int(prefs.get("hard_suppressed") or 0):
        return "suppressed"
    if category == CATEGORY_LIFECYCLE and int(prefs.get("lifecycle_optout") or 0):
        return "suppressed"
    if category == CATEGORY_MARKETING and not int(prefs.get("marketing_optin") or 0):
        return "suppressed"

    token = prefs["unsubscribe_token"]
    footer_html, footer_text = render_footer(_locale, token)
    if FOOTER_PLACEHOLDER in html:
        html = html.replace(FOOTER_PLACEHOLDER, footer_html)
    else:
        # A lifecycle template without the footer slot is a template bug —
        # append rather than send footerless mail.
        logger.error("lifecycle template %r missing footer placeholder", kind)
        html = html + footer_html
    if text:
        if FOOTER_TEXT_PLACEHOLDER in text:
            text = text.replace(FOOTER_TEXT_PLACEHOLDER, footer_text)
        else:
            text = text + footer_text

    headers = {
        "List-Unsubscribe": f"<{unsubscribe_url(token)}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }
    ok = transactional_email.send(email, subject, html, text=text, headers=headers)
    if not ok:
        return "error"
    try:
        from backend.services import retention_events

        retention_events.record_event(
            username,
            event_type="lifecycle_email_sent",
            source="server",
            detail=str(kind)[:64],
        )
    except Exception:
        logger.warning("lifecycle send instrumentation failed for %s", username, exc_info=True)
    return "sent"
