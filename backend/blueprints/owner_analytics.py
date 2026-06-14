"""Owner Dashboard — per-community analytics (read-only).

Thin routes; aggregation lives in :mod:`backend.services.community_analytics`.
Access is a **server-side** decision: only a community's owner, a delegated
admin, or an app admin may read its analytics. Unauthorized callers get the
same non-enumerating 404 as a missing community (hiding UI is never access
control). The member-level inputs never leave the server — only aggregates do.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, session

from backend.services import api_errors

owner_analytics_bp = Blueprint("owner_analytics", __name__)
logger = logging.getLogger(__name__)


def _may_view_analytics(username: str, community_id: int) -> bool:
    """Owner, delegated community admin, or app admin. Consumed read-only from
    the canonical auth service so it inherits any hardening done there."""
    from backend.services.community import can_manage_community, is_community_admin

    return bool(
        can_manage_community(username, community_id)
        or is_community_admin(username, community_id)
    )


@owner_analytics_bp.route(
    "/api/community/<int:community_id>/analytics/overview", methods=["GET"]
)
def analytics_overview(community_id: int):
    """Overview metrics for the Owner Dashboard. Non-enumerating on access."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    if not _may_view_analytics(username, community_id):
        # Same closed door whether the community is missing or simply not the
        # caller's to manage.
        return api_errors.not_found()

    from backend.services.community_analytics import build_overview

    payload = build_overview(community_id)
    if payload is None:
        return api_errors.not_found()
    return jsonify(payload), 200


@owner_analytics_bp.route("/api/owner/communities", methods=["GET"])
def owner_communities():
    """Communities the caller owns or manages, with tier — for the dashboard's
    community switcher. Scoped to the caller by construction (no community id),
    so no per-community gate is needed beyond an authenticated session."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    from backend.services.community_analytics import list_managed_communities

    return jsonify(list_managed_communities(username)), 200


@owner_analytics_bp.route(
    "/api/community/<int:community_id>/analytics/spaces", methods=["GET"]
)
def analytics_spaces(community_id: int):
    """Sub-communities and groups under the community (the Spaces tab)."""
    username = session.get("username")
    if not username:
        return api_errors.auth_required()

    if not _may_view_analytics(username, community_id):
        return api_errors.not_found()

    from backend.services.community_analytics import list_spaces

    return jsonify(list_spaces(community_id)), 200
