"""Owner upgrade-prompt endpoints (thin routes — logic in the service).

Feeds the owner upgrade surface ("Grow your community"): the client asks
whether to show the pitch and with what evidence; the server decides.
Tier cards keep coming from ``GET /api/kb/pricing`` and dashboard stats
from the analytics overview — this endpoint adds only what neither has:
eligibility, the frequency window, dismissal, blocked-Steve demand, and
trial truth for the CTA label.

Access is non-enumerating: a non-owner (including delegated admins, who
can't act on billing) gets the same 404 as a missing community.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request, session

from backend.services import api_errors, owner_upgrade_prompt

owner_upgrade_bp = Blueprint("owner_upgrade", __name__)
logger = logging.getLogger(__name__)


def _int_arg(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


@owner_upgrade_bp.route("/api/owner/upgrade_prompt", methods=["GET"])
def get_upgrade_prompt():
    """Eligibility + evidence for the owner upgrade surface."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()
    community_id = _int_arg(request.args.get("community_id"))
    if not community_id:
        return jsonify({"success": False, "error": "community_id is required",
                        "reason": "missing_params"}), 400

    state = owner_upgrade_prompt.get_state(username, community_id)
    if state is None:
        # Missing community and not-your-community answer identically.
        return api_errors.not_found()
    return jsonify({"success": True, **state})


@owner_upgrade_bp.route("/api/owner/upgrade_prompt/dismiss", methods=["POST"])
def dismiss_upgrade_prompt():
    """Durable "don't show again" for this community's upgrade prompt."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()
    data = request.get_json(silent=True) or {}
    community_id = _int_arg(data.get("community_id"))
    if not community_id:
        return jsonify({"success": False, "error": "community_id is required",
                        "reason": "missing_params"}), 400

    result = owner_upgrade_prompt.dismiss(username, community_id)
    if result is None:
        return api_errors.not_found()
    return jsonify({"success": True, "dismissed": True})
