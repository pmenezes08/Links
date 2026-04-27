"""Email copy/rendering for community invitations."""

from __future__ import annotations

from typing import Iterable, Tuple


def _nested_sections(names: Iterable[str], heading: str) -> Tuple[str, str]:
    names = [name for name in names if name]
    if not names:
        return "", ""
    items = "".join(f"<li style='margin-bottom: 6px;'>{name}</li>" for name in names)
    html = (
        "<div style=\"margin: 24px 0; padding: 18px; background-color: rgba(77, 182, 172, 0.08); "
        "border: 1px solid rgba(77, 182, 172, 0.35); border-radius: 12px;\">"
        "<div style=\"font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; "
        f"color: #4db6ac; margin-bottom: 10px;\">{heading}</div>"
        f"<ul style=\"margin: 0; padding-left: 20px; color: #d0d0d0; font-size: 14px; line-height: 1.55;\">{items}</ul>"
        "</div>"
    )
    text = f"\n{heading}:\n" + "".join(f"- {name}\n" for name in names)
    return html, text


def render_existing_user_added_email(
    *,
    inviter_username: str,
    community_name: str,
    nested_names: Iterable[str],
    logo_url: str,
) -> Tuple[str, str]:
    nested_html, nested_text = _nested_sections(nested_names, "You're also joining")
    html = f"""
    <!DOCTYPE html>
    <html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#000;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#000;">
        <tr><td align="center" style="padding:40px 20px;">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a;border-radius:12px;overflow:hidden;max-width:100%;">
            <tr><td style="background:linear-gradient(135deg,#4db6ac 0%,#26a69a 100%);padding:30px;text-align:center;">
              <img src="{logo_url}" alt="C-Point" style="max-width:160px;max-height:60px;margin-bottom:12px;" />
              <h1 style="margin:0;color:#000;font-size:28px;font-weight:700;">You've Been Added!</h1>
            </td></tr>
            <tr><td style="padding:40px 30px;color:#fff;">
              <p style="margin:0 0 20px;font-size:16px;line-height:1.6;"><strong>{inviter_username}</strong> has added you to <strong style="color:#4db6ac;">{community_name}</strong> on C-Point.</p>
              {nested_html}
              <p style="margin:0 0 30px;font-size:16px;line-height:1.6;color:#b0b0b0;">You can now access this community and start connecting with other members.</p>
              <p style="text-align:center;"><a href="https://www.c-point.co/login" style="display:inline-block;padding:16px 40px;background-color:#4db6ac;color:#000;text-decoration:none;font-weight:600;border-radius:8px;">Go to C-Point</a></p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
    """
    text = f"""You've Been Added to {community_name}

{inviter_username} has added you to {community_name} on C-Point.{nested_text}

Go to C-Point: https://www.c-point.co/login
"""
    return html, text


def render_new_user_invite_email(
    *,
    inviter_username: str,
    community_name: str,
    invite_url: str,
    nested_names: Iterable[str],
    logo_url: str,
) -> Tuple[str, str]:
    nested_html, nested_text = _nested_sections(nested_names, "You'll also join")
    html = f"""
    <!DOCTYPE html>
    <html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#000;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#000;">
        <tr><td align="center" style="padding:40px 20px;">
          <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a1a1a;border-radius:12px;overflow:hidden;max-width:100%;">
            <tr><td style="background:linear-gradient(135deg,#4db6ac 0%,#26a69a 100%);padding:30px;text-align:center;">
              <img src="{logo_url}" alt="C-Point" style="max-width:160px;max-height:60px;margin-bottom:12px;" />
              <h1 style="margin:0;color:#000;font-size:28px;font-weight:700;">Welcome to C-Point</h1>
            </td></tr>
            <tr><td style="padding:40px 30px;color:#fff;">
              <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">You have been invited to join <strong style="color:#4db6ac;">{community_name}</strong> by <strong>{inviter_username}</strong>.</p>
              {nested_html}
              <p style="text-align:center;"><a href="{invite_url}" style="display:inline-block;padding:16px 40px;background-color:#4db6ac;color:#000;text-decoration:none;font-weight:600;border-radius:8px;">Join {community_name}</a></p>
              <p style="font-size:13px;word-break:break-all;color:#4db6ac;">{invite_url}</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
    """
    text = f"""Welcome to C-Point

You have been invited to join {community_name} by {inviter_username}.{nested_text}

Join here: {invite_url}
"""
    return html, text
