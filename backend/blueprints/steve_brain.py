"""Cron endpoint for the Steve Community Brain refresh.

POST /api/cron/steve-community-brain — synthesizes compact community memory
(``steve_community_memory/{root_id}`` in Firestore) for the busiest active
root communities. Protected by the platform-standard ``X-Cron-Secret`` header
(``CRON_SHARED_SECRET``); see docs/cloud-scheduler-cron.md.

Cost profile: at most ``community_brain_max_communities_per_run`` metered
LLM calls per invocation (KB-configurable, default 10), no retries, and
idle communities are skipped via ``sourceLatestPostTs`` idempotence — a
rerun without new activity spends nothing.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

logger = logging.getLogger(__name__)

steve_brain_bp = Blueprint("steve_brain", __name__)


@steve_brain_bp.route("/api/cron/steve-community-brain", methods=["POST"])
def cron_steve_community_brain():
    from backend.services.cron_auth import cron_authed

    if not cron_authed(request):
        return jsonify({"success": False, "error": "unauthorized"}), 401

    max_communities = None
    try:
        payload = request.get_json(silent=True) or {}
        if payload.get("max_communities") is not None:
            max_communities = max(1, min(50, int(payload["max_communities"])))
    except Exception:
        max_communities = None

    try:
        from backend.services.steve_community_brain import refresh_all

        summary = refresh_all(max_communities=max_communities)
        logger.info("Community Brain refresh: %s", summary)
        return jsonify({"success": True, **summary})
    except Exception as exc:
        logger.error("Community Brain refresh failed: %s", exc, exc_info=True)
        return jsonify({"success": False, "error": "refresh_failed"}), 500
