"""Owner Dashboard — per-community analytics (read-only).

Thin routes; aggregation lives in :mod:`backend.services.community_analytics`.
Access is a **server-side** decision: only a community's owner, a delegated
admin, or an app admin may read its analytics. Unauthorized callers get the
same non-enumerating 404 as a missing community (hiding UI is never access
control). The member-level inputs never leave the server — only aggregates do.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request, session

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


def _viewer_is_owner(username: str, community_id: int) -> bool:
    """Owner/app-admin (full payload) vs delegated admin (owner-only metrics
    withheld). Distinct from _may_view_analytics, which only opens the door."""
    from backend.services.community import can_manage_community

    return bool(can_manage_community(username, community_id))


# Cache-key contract: the payload varies by (community, scope, viewer ROLE) and
# nothing else. If a future change makes it vary by anything more (per-user
# flags, locale-resolved copy, ...), that dimension MUST join the key or the
# feature must be derived client-side — a shared key would leak across viewers.
def _overview_cache_key(community_id: int, scope: str, is_owner: bool) -> str:
    return f"owner:overview:v1:{community_id}:{scope}:{'owner' if is_owner else 'admin'}"


_CACHE_TTL_SECONDS = 300


def _cache_get(key: str):
    try:
        from redis_cache import cache

        return cache.get(key)
    except Exception:  # pragma: no cover - cache is best-effort
        return None


def _cache_set(key: str, value) -> None:
    try:
        from redis_cache import cache

        cache.set(key, value, ttl=_CACHE_TTL_SECONDS)
    except Exception:  # pragma: no cover - cache is best-effort
        pass


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

    # scope = network (this community + all nested sub-communities) | self.
    # Authorization is on the apex (community_id) above, so a network rollup can
    # only ever span the subtree the caller already manages.
    scope = "network" if request.args.get("scope", "network") == "network" else "self"
    is_owner = _viewer_is_owner(username, community_id)

    cache_key = _overview_cache_key(community_id, scope, is_owner)
    cached = _cache_get(cache_key)
    if cached is not None:
        return jsonify(cached), 200

    payload = build_overview(community_id, scope=scope, viewer_is_owner=is_owner)
    if payload is None:
        return api_errors.not_found()
    _cache_set(cache_key, payload)
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

    # Spaces carries counts/bands only (no names, no viewer-varying content),
    # so the key needs no viewer dimension.
    cache_key = f"owner:spaces:v1:{community_id}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return jsonify(cached), 200
    payload = list_spaces(community_id)
    _cache_set(cache_key, payload)
    return jsonify(payload), 200
