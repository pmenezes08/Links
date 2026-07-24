"""Rendering for lifecycle emails (welcome, activation nudges, verification reminder).

Same conventions as :mod:`backend.services.community_invite_emails` — the
established LIGHT email shell (white card on #ECEEF2, ``color-scheme: light
only``; email is deliberately light even though the app canvas is black),
copy keyed off ``email.*`` in the JSON catalogs, callers pass the resolved
recipient locale.

Every lifecycle render embeds :data:`lifecycle_email.FOOTER_PLACEHOLDER`
inside the card; :func:`backend.services.lifecycle_email.send` substitutes
the recipient's tokenized unsubscribe/legal footer. The verification
reminder is transactional (no footer slot) and is sent directly via
:mod:`transactional_email` by the dispatch cron.

Each render function returns ``(subject, html, text)``. One CTA per email —
no secondary buttons (brand rule).
"""

from __future__ import annotations

from typing import Optional, Tuple

from backend.services import i18n
from backend.services.lifecycle_email import FOOTER_PLACEHOLDER, FOOTER_TEXT_PLACEHOLDER


def _shell(
    *,
    heading: str,
    body_html: str,
    cta_label: str,
    cta_url: str,
    logo_url: str,
    with_footer_slot: bool = True,
) -> str:
    footer_slot = f"{FOOTER_PLACEHOLDER}" if with_footer_slot else ""
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="color-scheme" content="light only">
      <meta name="supported-color-schemes" content="light only">
    </head>
    <body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#ECEEF2;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ECEEF2;">
        <tr><td align="center" style="padding:40px 20px;">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;max-width:100%;">
            <tr><td style="background:#ffffff;padding:30px 30px 22px;text-align:center;border-bottom:1px solid #E5E9EF;">
              <img src="{logo_url}" alt="C-Point" style="max-width:160px;max-height:60px;margin-bottom:12px;" />
              <h1 style="margin:0;color:#0F1419;font-size:26px;font-weight:700;">{heading}</h1>
            </td></tr>
            <tr><td style="padding:34px 30px;color:#0F1419;">
              {body_html}
              <p style="text-align:center;margin:0;"><a href="{cta_url}" style="display:inline-block;padding:16px 40px;background-color:#00CEC8;border:2px solid #00CEC8;color:#000000;text-decoration:none;font-weight:600;border-radius:8px;">{cta_label}</a></p>
            </td></tr>
            {footer_slot}
          </table>
        </td></tr>
      </table>
    </body></html>
    """


def _moments_card(heading: str, items: list[str]) -> Tuple[str, str]:
    """The turquoise walkthrough card — same visual as invite nested_sections."""
    lis = "".join(f"<li style='margin-bottom: 6px;'>{item}</li>" for item in items)
    html = (
        "<div style=\"margin: 0 0 24px; padding: 18px; background-color: rgba(0, 206, 200, 0.08); "
        "border: 1px solid rgba(0, 206, 200, 0.35); border-radius: 12px;\">"
        "<div style=\"font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; "
        f"color: #00CEC8; margin-bottom: 10px;\">{heading}</div>"
        f"<ul style=\"margin: 0; padding-left: 20px; color: #0F1419; font-size: 14px; line-height: 1.55;\">{lis}</ul>"
        "</div>"
    )
    text = f"\n{heading}:\n" + "".join(f"- {item}\n" for item in items)
    return html, text


def _lead_p(text: str) -> str:
    return f'<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#0F1419;">{text}</p>'


def _secondary_p(text: str) -> str:
    return f'<p style="margin:0 0 26px;font-size:14px;line-height:1.6;color:#536471;">{text}</p>'


def render_welcome_owner(
    *, logo_url: str, cta_url: str, locale: Optional[str] = None
) -> Tuple[str, str, str]:
    loc = i18n.normalize_locale(locale)
    subject = i18n.t("email.welcome_owner.subject", loc)
    heading = i18n.t("email.welcome_owner.heading", loc)
    lead = i18n.t("email.welcome_owner.lead", loc)
    moments_heading = i18n.t("email.welcome_owner.moments_heading", loc)
    moments = [
        i18n.t("email.welcome_owner.moment_create", loc),
        i18n.t("email.welcome_owner.moment_invite", loc),
        i18n.t("email.welcome_owner.moment_steve", loc),
    ]
    platforms = i18n.t("email.welcome_owner.platforms", loc)
    cta = i18n.t("email.welcome_owner.cta", loc)
    card_html, card_text = _moments_card(moments_heading, moments)
    body_html = _lead_p(lead) + card_html + _secondary_p(platforms)
    html = _shell(
        heading=heading, body_html=body_html, cta_label=cta, cta_url=cta_url,
        logo_url=logo_url,
    )
    text = (
        f"{heading}\n\n{lead}\n{card_text}\n{platforms}\n\n{cta}: {cta_url}\n"
        f"{FOOTER_TEXT_PLACEHOLDER}"
    )
    return subject, html, text


def render_welcome_member(
    *, community_name: str, logo_url: str, cta_url: str, locale: Optional[str] = None
) -> Tuple[str, str, str]:
    loc = i18n.normalize_locale(locale)
    subject = i18n.t("email.welcome_member.subject", loc, community=community_name)
    heading = i18n.t("email.welcome_member.heading", loc)
    lead = i18n.t("email.welcome_member.lead", loc, community=community_name)
    platforms = i18n.t("email.welcome_owner.platforms", loc)
    cta = i18n.t("email.welcome_member.cta", loc, community=community_name)
    body_html = _lead_p(lead) + _secondary_p(platforms)
    html = _shell(
        heading=heading, body_html=body_html, cta_label=cta, cta_url=cta_url,
        logo_url=logo_url,
    )
    text = (
        f"{heading}\n\n{lead}\n{platforms}\n\n{cta}: {cta_url}\n"
        f"{FOOTER_TEXT_PLACEHOLDER}"
    )
    return subject, html, text


def render_no_community_nudge(
    *, logo_url: str, cta_url: str, locale: Optional[str] = None
) -> Tuple[str, str, str]:
    loc = i18n.normalize_locale(locale)
    subject = i18n.t("email.no_community_nudge.subject", loc)
    heading = i18n.t("email.no_community_nudge.heading", loc)
    lead = i18n.t("email.no_community_nudge.lead", loc)
    secondary = i18n.t("email.no_community_nudge.secondary", loc)
    cta = i18n.t("email.no_community_nudge.cta", loc)
    body_html = _lead_p(lead) + _secondary_p(secondary)
    html = _shell(
        heading=heading, body_html=body_html, cta_label=cta, cta_url=cta_url,
        logo_url=logo_url,
    )
    text = (
        f"{heading}\n\n{lead}\n{secondary}\n\n{cta}: {cta_url}\n"
        f"{FOOTER_TEXT_PLACEHOLDER}"
    )
    return subject, html, text


def render_empty_community_nudge(
    *, community_name: str, logo_url: str, cta_url: str, locale: Optional[str] = None
) -> Tuple[str, str, str]:
    loc = i18n.normalize_locale(locale)
    subject = i18n.t("email.empty_community_nudge.subject", loc, community=community_name)
    heading = i18n.t("email.empty_community_nudge.heading", loc, community=community_name)
    lead = i18n.t("email.empty_community_nudge.lead", loc, community=community_name)
    secondary = i18n.t("email.empty_community_nudge.secondary", loc)
    cta = i18n.t("email.empty_community_nudge.cta", loc, community=community_name)
    body_html = _lead_p(lead) + _secondary_p(secondary)
    html = _shell(
        heading=heading, body_html=body_html, cta_label=cta, cta_url=cta_url,
        logo_url=logo_url,
    )
    text = (
        f"{heading}\n\n{lead}\n{secondary}\n\n{cta}: {cta_url}\n"
        f"{FOOTER_TEXT_PLACEHOLDER}"
    )
    return subject, html, text


def render_verification_reminder(
    *, verify_url: str, logo_url: str, locale: Optional[str] = None
) -> Tuple[str, str, str]:
    """Transactional (account completion the user started) — no footer slot,
    sent directly via transactional_email, capped at once per address."""
    loc = i18n.normalize_locale(locale)
    subject = i18n.t("email.verification_reminder.subject", loc)
    heading = i18n.t("email.verification_reminder.heading", loc)
    lead = i18n.t("email.verification_reminder.lead", loc)
    ignore_note = i18n.t("email.verification_reminder.ignore_note", loc)
    cta = i18n.t("email.verification_reminder.cta", loc)
    body_html = _lead_p(lead) + _secondary_p(ignore_note)
    html = _shell(
        heading=heading, body_html=body_html, cta_label=cta, cta_url=verify_url,
        logo_url=logo_url, with_footer_slot=False,
    )
    text = f"{heading}\n\n{lead}\n{ignore_note}\n\n{cta}: {verify_url}\n"
    return subject, html, text
