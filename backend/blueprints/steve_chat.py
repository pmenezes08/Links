"""User-facing Ask-Steve chat endpoints.

Placeholder blueprint created as part of Wave 4 — the legacy ``/api/ai/steve_reply``
and DM trigger still live in :mod:`bodybuilding_app` but are gated through
:mod:`backend.services.entitlements_gate`. Once those paths are moved over, this
module will host them directly.

For now this blueprint exposes:

* ``GET  /api/steve/chat/preflight``  — client-side helper that returns the
  caller's current entitlement snapshot so the UI can disable the Steve
  button *before* the user types. It's a thin wrapper around
  :mod:`backend.blueprints.me` but scoped to the DM surface so the soft-cap
  thresholds are computed correctly.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, session

from backend.services import ai_usage
from backend.services.entitlements import resolve_entitlements
from backend.services.feature_flags import entitlements_enforcement_enabled


steve_chat_bp = Blueprint("steve_chat", __name__)
logger = logging.getLogger(__name__)


@steve_chat_bp.route("/api/steve/chat/preflight", methods=["GET"])
def steve_chat_preflight():
    """Small read-only endpoint used by the DM chat UI before Steve is called.

    Returns whether the user can currently talk to Steve, what their
    remaining monthly / daily budget is, and the reason + CTA to surface
    if they can't.
    """
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401

    try:
        ent = resolve_entitlements(username)
    except Exception as err:
        logger.exception("steve_chat_preflight resolve failed: %s", err)
        return jsonify({"success": False, "error": "Could not resolve entitlements"}), 500

    monthly_used = ai_usage.monthly_steve_count(username)
    daily_used = ai_usage.daily_count(username)

    cap_monthly = ent.get("steve_uses_per_month")
    cap_daily = ent.get("ai_daily_limit")

    def _remaining(used, cap):
        if cap is None:
            return None
        try:
            return max(0, int(cap) - int(used))
        except Exception:
            return None

    return jsonify({
        "success": True,
        "can_use_steve": bool(ent.get("can_use_steve")),
        "tier": ent.get("tier"),
        "remaining_monthly": _remaining(monthly_used, cap_monthly),
        "remaining_daily": _remaining(daily_used, cap_daily),
        "monthly_cap": cap_monthly,
        "daily_cap": cap_daily,
        "enforcement_enabled": entitlements_enforcement_enabled(),
    })
