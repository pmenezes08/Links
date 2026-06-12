"""Embedding index maintenance routes (cron-only).

The profile embedding index snapshot in R2 (see
``backend.services.embedding_index_snapshot``) is refreshed on a schedule so
cold Cloud Run instances boot from recent data. Auth is via the shared
``X-Cron-Secret`` header, not a session — Cloud Scheduler invokes this
(docs/cloud-scheduler-cron.md).
"""

from __future__ import annotations

import logging
import os

from flask import Blueprint, jsonify, request

embedding_index_bp = Blueprint("embedding_index", __name__)
logger = logging.getLogger(__name__)


def _cron_authed() -> bool:
    expected = os.environ.get("CRON_SHARED_SECRET") or ""
    if not expected:
        return False
    return (request.headers.get("X-Cron-Secret") or "") == expected


@embedding_index_bp.route("/api/cron/refresh_embedding_index", methods=["POST"])
def api_cron_refresh_embedding_index():
    """Rebuild the in-memory profile index from live Firestore and rewrite
    the R2 snapshot future cold starts will boot from."""
    if not _cron_authed():
        return jsonify({"success": False, "error": "Unauthorized"}), 403
    from backend.services.embedding_index_snapshot import (
        refresh_index_from_firestore_and_snapshot,
    )
    result = refresh_index_from_firestore_and_snapshot()
    logger.info("cron refresh_embedding_index: %s", result)
    return jsonify({"success": True, **result})
