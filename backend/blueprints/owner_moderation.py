"""Owner Dashboard — reported-content moderation routes (community-scoped).

Thin routes; logic in :mod:`backend.services.community_moderation`. Same access
rule as the analytics surface: only a community's owner, a delegated admin, or
an app admin may review its reports, enforced server-side with a non-enumerating
404. Posts only for now.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request, session

from backend.services import api_errors

owner_moderation_bp = Blueprint("owner_moderation", __name__)
logger = logging.getLogger(__name__)


def _may_moderate(username: str, community_id: int) -> bool:
    from backend.services.community import can_manage_community, is_community_admin

    return bool(
        can_manage_community(username, community_id)
        or is_community_admin(username, community_id)
    )


@owner_moderation_bp.route("/api/community/<int:community_id>/reports", methods=["GET"])
def community_reports(community_id: int):
    """List reported posts in the community (status filter: pending|reviewed|dismissed|all)."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()
    if not _may_moderate(username, community_id):
        return api_errors.not_found()

    from backend.services.community_moderation import list_reports

    status_filter = request.args.get("status", "pending")
    return jsonify(list_reports(community_id, status_filter)), 200


@owner_moderation_bp.route("/api/community/<int:community_id>/reports/review", methods=["POST"])
def community_report_review(community_id: int):
    """Dismiss or mark-reviewed a report. Body: {report_id, action: dismiss|reviewed}."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()
    if not _may_moderate(username, community_id):
        return api_errors.not_found()

    from backend.services.community_moderation import review_report

    data = request.get_json(silent=True) or {}
    body, status = review_report(community_id, data.get("report_id"), data.get("action", "dismiss"), username)
    return jsonify(body), status


@owner_moderation_bp.route("/api/community/<int:community_id>/reports/remove", methods=["POST"])
def community_report_remove(community_id: int):
    """Remove a reported post (and its replies) and resolve its reports. Body: {post_id}."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()
    if not _may_moderate(username, community_id):
        return api_errors.not_found()

    from backend.services.community_moderation import remove_reported_post

    data = request.get_json(silent=True) or {}
    body, status = remove_reported_post(community_id, data.get("post_id"), username)
    return jsonify(body), status
