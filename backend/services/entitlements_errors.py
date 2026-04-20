"""Shared JSON error contract for entitlements denials.

Every gated Steve / Whisper / content-gen code path returns the *same*
JSON shape when it blocks a call, so the frontend has one error handler
rather than a dozen surface-specific ones::

    {
        "success": False,
        "error": "entitlements_error",
        "reason": "monthly_steve_cap",
        "message": "You've used all 100 Steve calls this month.",
        "cta": {
            "type": "upgrade" | "wait" | "manage" | "open_url",
            "label": "Upgrade to Premium",
            "url": "/settings/membership"
        },
        "usage": {
            "monthly_steve_used": 100,
            "monthly_steve_cap": 100,
            "resets_at_monthly": "2026-05-01T00:00:00Z"
        }
    }

Copy templates can be overridden from the KB (``credits-entitlements``
page, field ``cta_copy_templates``) so they're editable without a deploy.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Tuple

from backend.services import knowledge_base as kb


logger = logging.getLogger(__name__)


# ─── Reason enum ───────────────────────────────────────────────────────
# Keep these strings stable — the frontend switches on them.

REASON_PREMIUM_REQUIRED = "premium_required"
REASON_DAILY_CAP = "daily_cap"
REASON_MONTHLY_STEVE_CAP = "monthly_steve_cap"
REASON_MONTHLY_WHISPER_CAP = "monthly_whisper_cap"
REASON_COMMUNITY_POOL_EXHAUSTED = "community_pool_exhausted"
REASON_RPM_EXCEEDED = "rpm_exceeded"
REASON_HPM_EXCEEDED = "hpm_exceeded"
REASON_SPECIAL_TECHNICAL_CAP = "special_technical_cap"
REASON_COMMUNITY_SUSPENDED = "community_suspended"
REASON_GRACE_EXPIRED = "grace_expired"


ALL_REASONS = (
    REASON_PREMIUM_REQUIRED,
    REASON_DAILY_CAP,
    REASON_MONTHLY_STEVE_CAP,
    REASON_MONTHLY_WHISPER_CAP,
    REASON_COMMUNITY_POOL_EXHAUSTED,
    REASON_RPM_EXCEEDED,
    REASON_HPM_EXCEEDED,
    REASON_SPECIAL_TECHNICAL_CAP,
    REASON_COMMUNITY_SUSPENDED,
    REASON_GRACE_EXPIRED,
)


# ─── Default copy (fallback when KB has no override) ───────────────────

_DEFAULT_TEMPLATES: Dict[str, Dict[str, Any]] = {
    REASON_PREMIUM_REQUIRED: {
        "http_status": 402,
        "message": (
            "Steve is a Premium feature. Upgrade to unlock "
            "{steve_uses_per_month} Steve calls per month."
        ),
        "cta": {
            "type": "upgrade",
            "label": "Upgrade to Premium",
            "url": "/settings/membership",
        },
    },
    REASON_DAILY_CAP: {
        "http_status": 429,
        "message": (
            "You've hit today's Steve limit of {ai_daily_limit} calls. "
            "It resets at {resets_at_daily}."
        ),
        "cta": {
            "type": "wait",
            "label": "See my usage",
            "url": "/settings/membership/ai-usage",
        },
    },
    REASON_MONTHLY_STEVE_CAP: {
        "http_status": 429,
        "message": (
            "You've used all {steve_uses_per_month} Steve calls for this "
            "month. Your allowance resets on {resets_at_monthly}."
        ),
        "cta": {
            "type": "manage",
            "label": "See my usage",
            "url": "/settings/membership/ai-usage",
        },
    },
    REASON_MONTHLY_WHISPER_CAP: {
        "http_status": 429,
        "message": (
            "You've used all {whisper_minutes_per_month} minutes of voice "
            "summaries this month. Resets on {resets_at_monthly}."
        ),
        "cta": {
            "type": "manage",
            "label": "See my usage",
            "url": "/settings/membership/ai-usage",
        },
    },
    REASON_COMMUNITY_POOL_EXHAUSTED: {
        "http_status": 429,
        "message": (
            "This community's shared Steve pool is empty for this month. "
            "Premium members can still use their personal allowance."
        ),
        "cta": {
            "type": "upgrade",
            "label": "Upgrade to Premium",
            "url": "/settings/membership",
        },
    },
    REASON_RPM_EXCEEDED: {
        "http_status": 429,
        "message": "You're sending requests too fast — slow down for a moment and try again.",
        "cta": {
            "type": "wait",
            "label": "OK",
            "url": None,
        },
    },
    REASON_HPM_EXCEEDED: {
        "http_status": 429,
        "message": "You've hit the hourly rate limit. Try again in a little while.",
        "cta": {
            "type": "wait",
            "label": "OK",
            "url": None,
        },
    },
    REASON_SPECIAL_TECHNICAL_CAP: {
        "http_status": 429,
        "message": (
            "You've hit a technical safety cap. This protects the platform "
            "against runaway usage — it'll clear shortly."
        ),
        "cta": {
            "type": "wait",
            "label": "See my usage",
            "url": "/settings/membership/ai-usage",
        },
    },
    REASON_COMMUNITY_SUSPENDED: {
        "http_status": 403,
        "message": (
            "This community is currently suspended. Steve features are "
            "paused until the community is reinstated."
        ),
        "cta": {
            "type": "manage",
            "label": "Contact support",
            "url": "/support",
        },
    },
    REASON_GRACE_EXPIRED: {
        "http_status": 402,
        "message": (
            "Your Enterprise seat has ended. Subscribe to Premium to keep "
            "using Steve."
        ),
        "cta": {
            "type": "upgrade",
            "label": "Subscribe to Premium",
            "url": "/settings/membership",
        },
    },
}


def _kb_templates() -> Dict[str, Dict[str, Any]]:
    """Load KB-overridden templates, keyed by reason. Empty on any failure."""
    try:
        page = kb.get_page("credits-entitlements")
    except Exception:
        return {}
    if not page:
        return {}
    for f in page.get("fields") or []:
        if f.get("name") == "cta_copy_templates":
            val = f.get("value")
            if isinstance(val, list):
                out: Dict[str, Dict[str, Any]] = {}
                for row in val:
                    if not isinstance(row, dict):
                        continue
                    reason = row.get("reason")
                    if reason in ALL_REASONS:
                        out[reason] = {
                            k: v for k, v in row.items() if k != "reason"
                        }
                return out
            if isinstance(val, dict):
                return {k: v for k, v in val.items() if k in ALL_REASONS}
    return {}


def _format_template(template: str, context: Dict[str, Any]) -> str:
    """str.format_map that ignores missing keys instead of raising."""
    class _SafeDict(dict):
        def __missing__(self, key):  # noqa: D401
            return "{" + key + "}"
    try:
        return template.format_map(_SafeDict(context))
    except Exception:
        return template


def build_error(
    reason: str,
    *,
    ent: Optional[Dict[str, Any]] = None,
    usage: Optional[Dict[str, Any]] = None,
    overrides: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], int]:
    """Return the shared error JSON shape + HTTP status for ``reason``.

    Call like::

        payload, status = build_error(REASON_MONTHLY_STEVE_CAP,
                                      ent=ent, usage=usage)
        return jsonify(payload), status

    The function never raises — unknown reasons fall back to a generic
    "limit reached" payload.
    """
    ent = ent or {}
    usage = usage or {}
    overrides = overrides or {}

    kb_templates = _kb_templates()
    base = dict(_DEFAULT_TEMPLATES.get(reason) or {
        "http_status": 429,
        "message": "You've reached a usage limit.",
        "cta": {"type": "manage", "label": "See my usage", "url": "/settings/membership/ai-usage"},
    })

    kb_override = kb_templates.get(reason) or {}
    base.update(kb_override)
    base.update(overrides)

    context: Dict[str, Any] = {**ent, **usage}
    message = _format_template(str(base.get("message") or ""), context)

    cta = base.get("cta") or {}
    if isinstance(cta, dict):
        cta = {
            "type": cta.get("type"),
            "label": _format_template(str(cta.get("label") or ""), context) if cta.get("label") else None,
            "url": cta.get("url"),
        }
    else:
        cta = {"type": "manage", "label": str(cta), "url": None}

    try:
        status = int(base.get("http_status") or 429)
    except Exception:
        status = 429

    payload: Dict[str, Any] = {
        "success": False,
        "error": "entitlements_error",
        "reason": reason,
        "message": message,
        "cta": cta,
        "usage": {
            "monthly_steve_used": usage.get("monthly_steve_used"),
            "monthly_steve_cap": usage.get("monthly_steve_cap") if usage else ent.get("steve_uses_per_month"),
            "daily_used": usage.get("daily_used"),
            "daily_cap": usage.get("daily_cap") if usage else ent.get("ai_daily_limit"),
            "whisper_minutes_used": usage.get("whisper_minutes_used"),
            "whisper_minutes_cap": usage.get("whisper_minutes_cap") if usage else ent.get("whisper_minutes_per_month"),
            "resets_at_monthly": usage.get("resets_at_monthly"),
            "resets_at_daily": usage.get("resets_at_daily"),
        },
        "tier": ent.get("tier"),
    }
    return payload, status


def entitlements_error(
    reason: str,
    ent: Optional[Dict[str, Any]] = None,
    **extra: Any,
) -> Tuple[Dict[str, Any], int]:
    """Convenience alias for :func:`build_error` used in legacy call-sites.

    Accepts ``usage=...`` and ``overrides=...`` as kwargs; anything else is
    merged into ``overrides`` for one-off tweaks.
    """
    usage = extra.pop("usage", None)
    overrides = extra.pop("overrides", None)
    if extra:
        overrides = {**(overrides or {}), **extra}
    return build_error(reason, ent=ent, usage=usage, overrides=overrides)
