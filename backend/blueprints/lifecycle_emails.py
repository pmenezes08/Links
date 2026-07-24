"""Lifecycle email HTTP surface — unsubscribe pages + cron dispatch.

Unsubscribe routes are UNAUTHENTICATED by design: the permanent per-user
token (``email_preferences.unsubscribe_token``) is the credential, exactly
like the password-reset token flow. Responses are non-enumerating — an
invalid token renders the same generic "link invalid" page as any other
failure, never "no such user".

``POST /email/unsubscribe`` doubles as the RFC 8058 one-click endpoint
(the ``List-Unsubscribe-Post: List-Unsubscribe=One-Click`` target Gmail /
Yahoo require): a bare 200 for machine callers, a confirmation page for
humans arriving from the landing form.

Cron routes follow docs/cloud-scheduler-cron.md: X-Cron-Secret via
``cron_authed``, ``?dry_run=1`` counters without sends, per-stream
kill-switch env vars checked in the dispatch service.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from backend.services import email_preferences
from backend.services import i18n
from backend.services.cron_auth import cron_authed

logger = logging.getLogger(__name__)

lifecycle_emails_bp = Blueprint("lifecycle_emails", __name__)


# ── Unsubscribe pages ──────────────────────────────────────────────────


def _page(title: str, body: str, form_html: str = "") -> str:
    """Minimal standalone page in the light email-adjacent style."""
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>{title}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#ECEEF2;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ECEEF2;min-height:100vh;">
    <tr><td align="center" style="padding:60px 20px;">
      <table width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;max-width:100%;">
        <tr><td style="padding:34px 30px;text-align:center;">
          <img src="/static/cpoint-logo.png" alt="C-Point" style="max-width:140px;max-height:52px;margin-bottom:18px;" />
          <h1 style="margin:0 0 14px;color:#0F1419;font-size:22px;font-weight:700;">{title}</h1>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#536471;">{body}</p>
          {form_html}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _button_form(action: str, token: str, label: str) -> str:
    return (
        f'<form method="POST" action="{action}" style="margin:0;">'
        f'<input type="hidden" name="t" value="{token}">'
        '<button type="submit" style="display:inline-block;padding:14px 36px;'
        "background-color:#00CEC8;border:2px solid #00CEC8;color:#000000;"
        'font-weight:600;border-radius:8px;font-size:15px;cursor:pointer;">'
        f"{label}</button></form>"
    )


def _token_arg() -> str:
    tok = (request.args.get("t") or request.form.get("t") or "").strip()
    return tok if len(tok) <= 64 else ""


def _locale_for_token_row(row) -> str:
    if not row:
        return i18n.DEFAULT_LOCALE
    try:
        from backend.services.lifecycle_email import user_email_and_locale

        _email, locale = user_email_and_locale(row.get("username") or "")
        return locale
    except Exception:
        return i18n.DEFAULT_LOCALE


def _invalid_page(loc: str) -> str:
    return _page(
        i18n.t("email.unsubscribe_page.invalid_title", loc),
        i18n.t("email.unsubscribe_page.invalid_body", loc),
    )


@lifecycle_emails_bp.route("/email/unsubscribe", methods=["GET"])
def email_unsubscribe_landing():
    """Human landing: confirm button (no state change on GET — mail-client
    link prefetchers must not unsubscribe anyone)."""
    token = _token_arg()
    row = email_preferences.get_by_token(token) if token else None
    loc = _locale_for_token_row(row)
    if not row:
        return _invalid_page(loc), 200
    if int(row.get("lifecycle_optout") or 0):
        return _done_page(loc, token), 200
    return _page(
        i18n.t("email.unsubscribe_page.title", loc),
        i18n.t("email.unsubscribe_page.body", loc),
        _button_form(
            "/email/unsubscribe", token,
            i18n.t("email.unsubscribe_page.confirm_button", loc),
        ),
    ), 200


def _done_page(loc: str, token: str) -> str:
    return _page(
        i18n.t("email.unsubscribe_page.done_title", loc),
        i18n.t("email.unsubscribe_page.done_body", loc),
        _button_form(
            "/email/resubscribe", token,
            i18n.t("email.unsubscribe_page.resubscribe_button", loc),
        ),
    )


def _wants_html() -> bool:
    accept = (request.headers.get("Accept") or "").lower()
    return "text/html" in accept


@lifecycle_emails_bp.route("/email/unsubscribe", methods=["POST"])
def email_unsubscribe_post():
    """State change: lifecycle opt-out. Serves both the landing form and the
    RFC 8058 one-click POST (which sends no Accept: text/html)."""
    token = _token_arg()
    updated = email_preferences.set_lifecycle_optout_by_token(token, True) if token else False
    if not _wants_html():
        # One-click caller: 200 regardless (non-enumerating).
        return jsonify({"success": True}), 200
    row = email_preferences.get_by_token(token) if updated else None
    loc = _locale_for_token_row(row)
    if not row:
        return _invalid_page(loc), 200
    return _done_page(loc, token), 200


@lifecycle_emails_bp.route("/email/resubscribe", methods=["POST"])
def email_resubscribe_post():
    token = _token_arg()
    updated = email_preferences.set_lifecycle_optout_by_token(token, False) if token else False
    row = email_preferences.get_by_token(token) if updated else None
    loc = _locale_for_token_row(row)
    if not row:
        return _invalid_page(loc), 200
    return _page(
        i18n.t("email.unsubscribe_page.resubscribed_title", loc),
        i18n.t("email.unsubscribe_page.resubscribed_body", loc),
    ), 200


# ── Cron dispatch ──────────────────────────────────────────────────────


def _bool_arg(name: str) -> bool:
    return (request.args.get(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def _max_sends_arg() -> int:
    from backend.services.lifecycle_email_dispatch import DEFAULT_MAX_SENDS

    try:
        return int(request.args.get("max_sends") or DEFAULT_MAX_SENDS)
    except (TypeError, ValueError):
        return DEFAULT_MAX_SENDS


@lifecycle_emails_bp.route("/api/cron/email/welcome", methods=["POST"])
def api_cron_email_welcome():
    """Welcome email sweep (every 15–30 min). Owner/member variants."""
    if not cron_authed(request):
        return jsonify({"success": False, "error": "forbidden"}), 403
    try:
        from backend.services.lifecycle_email_dispatch import run_welcome_sweep

        out = run_welcome_sweep(dry_run=_bool_arg("dry_run"), max_sends=_max_sends_arg())
        return jsonify(out), 200 if out.get("success") else 409
    except Exception as exc:
        logger.exception("welcome email sweep: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@lifecycle_emails_bp.route("/api/cron/email/activation-nudges", methods=["POST"])
def api_cron_email_activation_nudges():
    """Daily: no-community nudge + empty-community invite nudge."""
    if not cron_authed(request):
        return jsonify({"success": False, "error": "forbidden"}), 403
    try:
        from backend.services.lifecycle_email_dispatch import run_activation_nudge_sweep

        out = run_activation_nudge_sweep(
            dry_run=_bool_arg("dry_run"), max_sends=_max_sends_arg()
        )
        return jsonify(out), 200 if out.get("success") else 409
    except Exception as exc:
        logger.exception("activation nudge sweep: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@lifecycle_emails_bp.route("/api/cron/email/verification-reminders", methods=["POST"])
def api_cron_email_verification_reminders():
    """Daily: one fresh-token reminder to unverified pending signups."""
    if not cron_authed(request):
        return jsonify({"success": False, "error": "forbidden"}), 403
    try:
        from backend.services.lifecycle_email_dispatch import (
            run_verification_reminder_sweep,
        )

        out = run_verification_reminder_sweep(
            dry_run=_bool_arg("dry_run"), max_sends=_max_sends_arg()
        )
        return jsonify(out), 200 if out.get("success") else 409
    except Exception as exc:
        logger.exception("verification reminder sweep: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500
