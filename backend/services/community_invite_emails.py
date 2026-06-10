"""Email copy / rendering for community invitations.

Recipient-locale aware. Each render function accepts a ``locale`` arg;
callers (community_invites etc.) resolve the recipient's
``preferred_locale`` once via ``backend.services.notification_copy.recipient_locale``
and pass it in. Default is English so legacy call sites that omit the
argument keep their current behaviour.

The HTML shell (table layout, brand colours, CTA pill) stays a single
template â€” only the user-facing text is keyed off ``email.*`` in the
JSON catalogs.
"""

from __future__ import annotations

from typing import Iterable, Optional, Tuple

from backend.services import i18n


def _nested_sections(names: Iterable[str], heading: str) -> Tuple[str, str]:
    names = [name for name in names if name]
    if not names:
        return "", ""
    items = "".join(f"<li style='margin-bottom: 6px;'>{name}</li>" for name in names)
    html = (
        "<div style=\"margin: 24px 0; padding: 18px; background-color: rgba(0, 206, 200, 0.08); "
        "border: 1px solid rgba(0, 206, 200, 0.35); border-radius: 12px;\">"
        "<div style=\"font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; "
        f"color: #00CEC8; margin-bottom: 10px;\">{heading}</div>"
        f"<ul style=\"margin: 0; padding-left: 20px; color: #d0d0d0; font-size: 14px; line-height: 1.55;\">{items}</ul>"
        "</div>"
    )
    text = f"\n{heading}:\n" + "".join(f"- {name}\n" for name in names)
    return html, text


def invite_subject(*, kind: str, inviter_username: str, community_name: str, locale: Optional[str] = None) -> str:
    """Return the localized email subject. ``kind`` is ``existing`` or ``new``."""
    loc = i18n.normalize_locale(locale)
    key = (
        "email.invite_existing_user.subject"
        if kind == "existing"
        else "email.invite_new_user.subject"
    )
    return i18n.t(key, loc, inviter=inviter_username, community=community_name)


def render_existing_user_added_email(
    *,
    inviter_username: str,
    community_name: str,
    nested_names: Iterable[str],
    logo_url: str,
    locale: Optional[str] = None,
) -> Tuple[str, str]:
    loc = i18n.normalize_locale(locale)
    nested_html, nested_text = _nested_sections(
        nested_names,
        i18n.t("email.invite_existing_user.nested_heading", loc),
    )
    heading = i18n.t("email.invite_existing_user.heading", loc)
    lead_html = i18n.t(
        "email.invite_existing_user.lead_html", loc,
        inviter=inviter_username, community=community_name,
    )
    lead_text = i18n.t(
        "email.invite_existing_user.lead_text", loc,
        inviter=inviter_username, community=community_name,
    )
    secondary = i18n.t("email.invite_existing_user.secondary", loc)
    cta = i18n.t("email.common.go_to_c_point", loc)

    html = f"""
    <!DOCTYPE html>
    <html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#000;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#000;">
        <tr><td align="center" style="padding:40px 20px;">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a;border-radius:12px;overflow:hidden;max-width:100%;">
            <tr><td style="background:#ffffff;padding:30px;text-align:center;">
              <img src="{logo_url}" alt="C-Point" style="max-width:160px;max-height:60px;margin-bottom:12px;" />
              <h1 style="margin:0;color:#0F1419;font-size:28px;font-weight:700;">{heading}</h1>
            </td></tr>
            <tr><td style="padding:40px 30px;color:#fff;">
              <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">{lead_html}</p>
              {nested_html}
              <p style="margin:0 0 30px;font-size:16px;line-height:1.6;color:#b0b0b0;">{secondary}</p>
              <p style="text-align:center;"><a href="https://www.c-point.co/login" style="display:inline-block;padding:16px 40px;background-color:#00CEC8;color:#000;text-decoration:none;font-weight:600;border-radius:8px;">{cta}</a></p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
    """
    text = f"""{heading}

{lead_text}{nested_text}

{cta}: https://www.c-point.co/login
"""
    return html, text


def render_new_user_invite_email(
    *,
    inviter_username: str,
    community_name: str,
    invite_url: str,
    nested_names: Iterable[str],
    logo_url: str,
    expires_at: Optional[str] = None,
    locale: Optional[str] = None,
) -> Tuple[str, str]:
    loc = i18n.normalize_locale(locale)
    nested_html, nested_text = _nested_sections(
        nested_names,
        i18n.t("email.invite_new_user.nested_heading", loc),
    )
    heading = i18n.t("email.invite_new_user.heading", loc)
    lead_html = i18n.t(
        "email.invite_new_user.lead_html", loc,
        inviter=inviter_username, community=community_name,
    )
    lead_text = i18n.t(
        "email.invite_new_user.lead_text", loc,
        inviter=inviter_username, community=community_name,
    )
    cta = i18n.t("email.invite_new_user.cta", loc, community=community_name)
    expiry_html = (
        f'<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#b0b0b0;">This invitation is valid until {expires_at}.</p>'
        if expires_at else ""
    )
    expiry_text = f"\nThis invitation is valid until {expires_at}.\n" if expires_at else ""

    html = f"""
    <!DOCTYPE html>
    <html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#000;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#000;">
        <tr><td align="center" style="padding:40px 20px;">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a;border-radius:12px;overflow:hidden;max-width:100%;">
            <tr><td style="background:#ffffff;padding:30px;text-align:center;">
              <img src="{logo_url}" alt="C-Point" style="max-width:160px;max-height:60px;margin-bottom:12px;" />
              <h1 style="margin:0;color:#0F1419;font-size:28px;font-weight:700;">{heading}</h1>
            </td></tr>
            <tr><td style="padding:40px 30px;color:#fff;">
              <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">{lead_html}</p>
              {nested_html}
              {expiry_html}
              <p style="text-align:center;"><a href="{invite_url}" style="display:inline-block;padding:16px 40px;background-color:#00CEC8;color:#000;text-decoration:none;font-weight:600;border-radius:8px;">{cta}</a></p>
              <p style="font-size:13px;word-break:break-all;color:#00CEC8;">{invite_url}</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
    """
    text = f"""{heading}

{lead_text}{nested_text}{expiry_text}

{cta}: {invite_url}
"""
    return html, text
