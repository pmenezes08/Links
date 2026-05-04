"""Community management routes blueprint."""

from __future__ import annotations

import logging
import os
from functools import lru_cache, wraps
from typing import Any, Dict, List, Optional, Set, Tuple

from flask import (
    Blueprint,
    abort,
    current_app,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)

from backend.services.content_generation.permissions import can_manage_community_jobs
from backend.services import auth_session, community as community_svc
from backend.services import community_group_feed as community_group_feed_svc
from backend.services import community_admin_notifications
from backend.services import community_lifecycle
from backend.services import session_identity
from backend.services.database import get_db_connection, get_sql_placeholder
from redis_cache import (
    CACHE_TTL_USER_PARENT_DASHBOARD,
    cache,
    invalidate_community_cache,
    invalidate_user_cache,
    user_parent_dashboard_cache_key,
)


communities_bp = Blueprint("communities", __name__)
logger = logging.getLogger(__name__)


@communities_bp.after_request
def _no_store_user_scoped_responses(response):
    return auth_session.no_store(response)


def _stripe_client():
    try:
        import stripe  # type: ignore
    except Exception:
        return None
    api_key = os.environ.get("STRIPE_API_KEY") or ""
    if not api_key or api_key == "sk_test_your_stripe_key":
        return None
    stripe.api_key = api_key
    return stripe


@lru_cache(maxsize=1)
def _legacy_community_helpers():
    """Lazy import helpers from the legacy monolith to avoid circular imports.

    ``CommunityMembershipLimitError`` now lives in
    :mod:`backend.services.community`; we import it directly from there
    and keep the shape of this tuple stable for the two call sites
    (``add_member`` and ``add_member_to_subcommunity``).
    """
    from backend.services.community import CommunityMembershipLimitError
    from bodybuilding_app import (  # type: ignore import-not-found
        add_user_to_community,
        is_app_admin,
    )

    return CommunityMembershipLimitError, add_user_to_community, is_app_admin


def _render_member_cap_payload(limit_err, *, session_username: Optional[str] = None):
    """Thin shim around :func:`backend.services.community.render_member_cap_error`
    so both this blueprint and the legacy monolith share a single copy of the
    owner-vs-invitee branching logic.
    """
    from backend.services.community import render_member_cap_error

    return render_member_cap_error(limit_err, session_username=session_username)


def _login_required(view_func):
    """Simple login_required decorator that avoids circular imports."""

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not session_identity.valid_session_username(session):
            try:
                current_app.logger.info(
                    "No username in session for %s, redirecting to login", request.path
                )
            except Exception:
                pass
            if request.path.startswith("/api/") or request.path.startswith("/check_"):
                return jsonify({"success": False, "error": "unauthenticated"}), 401
            return redirect(url_for("auth.login"))
        return view_func(*args, **kwargs)

    return wrapper


@communities_bp.route("/communities")
@_login_required
def communities_list():
    """Main communities page: Desktop -> HTML template; Mobile -> React SPA."""
    username = session["username"]
    try:
        view = (request.args.get("view") or "").lower().strip()
        if view == "html":
            return render_template("communities.html", username=username)
        if view == "react":
            dist_dir = os.path.join(current_app.root_path, "client", "dist")
            return send_from_directory(dist_dir, "index.html")

        ua = request.headers.get("User-Agent", "")
        is_mobile = any(k in ua for k in ["Mobi", "Android", "iPhone", "iPad"])
        if is_mobile:
            dist_dir = os.path.join(current_app.root_path, "client", "dist")
            return send_from_directory(dist_dir, "index.html")
        return render_template("communities.html", username=username)
    except Exception as exc:
        logger.error("Error in communities for %s: %s", username, exc)
        abort(500)


def _row_value(row: Any, key: str, index: int) -> Any:
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key)
    if isinstance(row, (list, tuple)) and len(row) > index:
        return row[index]
    return None


def _collect_delete_affected_usernames(cursor, community_ids: List[int], actor: str) -> List[str]:
    """Return users whose community/dashboard caches must be invalidated."""
    affected = {actor}
    ids = [int(cid) for cid in community_ids if cid]
    if not ids:
        return sorted(u for u in affected if u)

    ph = get_sql_placeholder()
    placeholders = ",".join([ph] * len(ids))

    cursor.execute(
        f"""
        SELECT DISTINCT u.username
        FROM user_communities uc
        JOIN users u ON uc.user_id = u.id
        WHERE uc.community_id IN ({placeholders})
        """,
        tuple(ids),
    )
    for row in cursor.fetchall() or []:
        username = _row_value(row, "username", 0)
        if username:
            affected.add(str(username))

    cursor.execute(
        f"""
        SELECT DISTINCT creator_username
        FROM communities
        WHERE id IN ({placeholders})
        """,
        tuple(ids),
    )
    for row in cursor.fetchall() or []:
        username = _row_value(row, "creator_username", 0)
        if username:
            affected.add(str(username))

    return sorted(u for u in affected if u)


def _invalidate_community_membership_caches(community_id: int, actor: str) -> None:
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            affected = _collect_delete_affected_usernames(c, [community_id], actor)
    except Exception:
        affected = [actor]

    invalidate_community_cache(community_id)
    for username in affected:
        invalidate_user_cache(username)


def _delete_community_tree(
    *,
    community_id: int,
    actor_username: str,
    enforce_descendant_ownership: bool,
    confirm_active_subscription: bool = False,
    stripe_mod: Any = None,
) -> Tuple[Dict[str, Any], int]:
    """Delete a community tree in a single transaction."""
    if not community_id:
        return {"success": False, "error": "community_id required"}, 400

    if not community_svc.can_manage_community(actor_username, community_id):
        return {
            "success": False,
            "error": "Only the community owner can delete this community",
        }, 403

    deleted_ids: List[int] = []
    affected_usernames: List[str] = [actor_username]
    deleted_contexts: List[Dict[str, Any]] = []

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(f"SELECT id FROM communities WHERE id = {ph}", (community_id,))
            if not c.fetchone():
                return {"success": False, "error": "Community not found"}, 404

            descendant_ids = community_svc.get_descendant_community_ids(c, community_id)
            affected_usernames = _collect_delete_affected_usernames(
                c,
                descendant_ids,
                actor_username,
            )

            active_billing = [
                payload
                for cid in descendant_ids
                if (payload := community_lifecycle.active_subscription_delete_payload(cid))
            ]
            if active_billing and not confirm_active_subscription:
                return {
                    "success": False,
                    "error": (
                        "This community has an active subscription. Confirm deletion "
                        "to schedule cancellation at the end of the current billing period."
                    ),
                    "reason": "active_subscription_requires_confirmation",
                    "subscriptions": active_billing,
                }, 409

            if community_svc.is_app_admin(actor_username):
                deleted_contexts = [
                    context
                    for cid in descendant_ids
                    if (context := community_admin_notifications.get_community_context(cid))
                ]

            try:
                if active_billing:
                    for billing_payload in active_billing:
                        community_lifecycle.cancel_subscription_at_period_end(
                            stripe_mod,
                            int(billing_payload["community_id"]),
                        )

                for cid in descendant_ids:
                    if (
                        enforce_descendant_ownership
                        and not community_svc.can_manage_community(actor_username, cid)
                    ):
                        conn.rollback()
                        return {
                            "success": False,
                            "error": "Cannot delete: nested community owned by another user",
                            "blocking_id": cid,
                        }, 403

                    deleted = community_svc.delete_community_cascade(c, cid)
                    if deleted != 1:
                        conn.rollback()
                        return {
                            "success": False,
                            "error": f"Community {cid} not removed (rowcount={deleted})",
                        }, 500
                    deleted_ids.append(cid)

                conn.commit()
            except community_lifecycle.CommunityLifecycleActionError as exc:
                conn.rollback()
                return {
                    "success": False,
                    "error": str(exc),
                    "reason": exc.reason,
                }, exc.status_code
            except Exception as exc:
                conn.rollback()
                logger.exception("delete_community failed")
                return {"success": False, "error": str(exc)}, 500
    except Exception as exc:
        logger.exception("delete_community setup failed")
        return {"success": False, "error": str(exc)}, 500

    for cid in deleted_ids:
        invalidate_community_cache(cid)
    for username in affected_usernames:
        invalidate_user_cache(username)
    for context in deleted_contexts:
        community_admin_notifications.notify_owner_of_admin_action(
            community_id=int(context["community_id"]),
            action="deleted",
            actor_username=actor_username,
            extra=context,
        )

    return {
        "success": True,
        "message": "Community deleted successfully",
        "deleted_ids": deleted_ids,
    }, 200


@communities_bp.route("/delete_community", methods=["POST"])
@_login_required
def delete_community():
    community_id = request.form.get("community_id", type=int)
    confirm_active_subscription = str(
        request.form.get("confirm_active_subscription") or ""
    ).strip().lower() in {"1", "true", "yes"}
    payload, status = _delete_community_tree(
        community_id=community_id or 0,
        actor_username=session.get("username", ""),
        enforce_descendant_ownership=True,
        confirm_active_subscription=confirm_active_subscription,
        stripe_mod=_stripe_client() if confirm_active_subscription else None,
    )
    return jsonify(payload), status


@communities_bp.route("/api/admin/delete_community", methods=["POST"])
@_login_required
def admin_delete_community():
    username = session.get("username", "")
    if not community_svc.is_app_admin(username):
        return jsonify({"success": False, "error": "Unauthorized"}), 403

    data = request.get_json(silent=True) or {}
    try:
        community_id = int(data.get("community_id") or 0)
    except (TypeError, ValueError):
        community_id = 0

    payload, status = _delete_community_tree(
        community_id=community_id,
        actor_username=username,
        enforce_descendant_ownership=False,
        confirm_active_subscription=bool(data.get("confirm_active_subscription")),
        stripe_mod=_stripe_client() if data.get("confirm_active_subscription") else None,
    )
    return jsonify(payload), status


@communities_bp.route("/api/communities/<int:community_id>/freeze", methods=["POST"])
@_login_required
def freeze_community(community_id: int):
    username = session.get("username", "")
    data = request.get_json(silent=True) or {}
    try:
        state = community_lifecycle.set_freeze_state(
            community_id,
            frozen=True,
            actor_username=username,
            reason=str(data.get("reason") or "").strip() or None,
        )
    except community_lifecycle.CommunityLifecycleActionError as exc:
        return jsonify({"success": False, "error": str(exc), "reason": exc.reason}), exc.status_code
    _invalidate_community_membership_caches(community_id, username)
    if community_svc.is_app_admin(username):
        community_admin_notifications.notify_owner_of_admin_action(
            community_id=community_id,
            action="frozen",
            actor_username=username,
        )
    return jsonify({"success": True, "community_id": community_id, **state})


@communities_bp.route("/api/communities/<int:community_id>/unfreeze", methods=["POST"])
@_login_required
def unfreeze_community(community_id: int):
    username = session.get("username", "")
    try:
        state = community_lifecycle.set_freeze_state(
            community_id,
            frozen=False,
            actor_username=username,
        )
    except community_lifecycle.CommunityLifecycleActionError as exc:
        return jsonify({"success": False, "error": str(exc), "reason": exc.reason}), exc.status_code
    _invalidate_community_membership_caches(community_id, username)
    if community_svc.is_app_admin(username):
        community_admin_notifications.notify_owner_of_admin_action(
            community_id=community_id,
            action="unfrozen",
            actor_username=username,
        )
    return jsonify({"success": True, "community_id": community_id, **state})


@communities_bp.route("/api/user_communities_hierarchical", methods=["GET"])
@_login_required
def user_communities_hierarchical():
    """Return the signed-in user's communities as a parent/child tree."""
    username = session.get("username", "")
    try:
        payload = _load_user_communities_hierarchy(str(username))
        return jsonify(payload)
    except Exception as exc:
        logger.exception("user_communities_hierarchical failed for %s", username)
        return jsonify({"success": False, "error": str(exc)}), 500


@communities_bp.route("/api/user_parent_community", methods=["GET"])
@_login_required
def api_user_parent_community():
    """Top-level parent communities for the dashboard, enriched.

    Each entry includes ``member_count``, ``last_activity``, ``is_owner``,
    ``is_admin``, and ``unread_posts_count`` (rollup across descendants).
    App admins receive every top-level parent community.
    """
    username = session.get("username") or ""
    bypass_cache = bool(request.args.get("_nocache") or request.args.get("refresh"))
    cache_key = user_parent_dashboard_cache_key(username) if username else None

    if cache_key and not bypass_cache:
        cached = cache.get(cache_key)
        if cached:
            resp = jsonify(cached)
            resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return resp

    try:
        communities_list = community_svc.get_user_dashboard_communities(username)
    except Exception as exc:
        logger.error("api_user_parent_community for %s: %s", username, exc)
        return jsonify({"success": False, "error": str(exc)}), 500

    response_payload = {
        "success": True,
        "communities": communities_list,
        "parentCommunity": communities_list[0] if communities_list else None,
    }

    if cache_key and not bypass_cache:
        try:
            # Shorter TTL: payload includes volatile unread counts.
            cache.set(cache_key, response_payload, CACHE_TTL_USER_PARENT_DASHBOARD)
        except Exception:
            pass

    resp = jsonify(response_payload)
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


@communities_bp.route("/api/community_group_feed/<int:parent_id>", methods=["GET"])
@_login_required
def api_community_group_feed(parent_id: int):
    """Unread posts for a parent community and all descendants (no post_views row for viewer)."""
    username = session.get("username")
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()

            descendant_ids = community_svc.get_descendant_community_ids(c, parent_id) or []
            if not descendant_ids:
                return jsonify({"success": True, "posts": [], "username": username})

            placeholders = ",".join([ph] * len(descendant_ids))
            c.execute(
                f"SELECT id, name FROM communities WHERE id IN ({placeholders})",
                tuple(descendant_ids),
            )
            name_rows = c.fetchall()

            if not name_rows:
                return jsonify({"success": True, "posts": [], "username": username})

            name_map: Dict[int, Any] = {}
            for r in name_rows:
                cid = r["id"] if hasattr(r, "keys") else r[0]
                cname = r["name"] if hasattr(r, "keys") else r[1]
                name_map[cid] = cname

            if parent_id not in name_map:
                return jsonify({"success": True, "posts": [], "username": username})

            community_ids = [cid for cid in descendant_ids if cid in name_map]

            if not community_ids:
                return jsonify({"success": True, "posts": [], "username": username})

            placeholders = ",".join([ph for _ in community_ids])

            c.execute(
                f"""
                SELECT DISTINCT p.id, p.username, p.content, p.community_id,
                       p.timestamp, p.image_path, p.video_path,
                       p.audio_path, p.audio_summary
                FROM posts p
                WHERE p.community_id IN ({placeholders})
                  AND LOWER(p.username) <> LOWER({ph})
                  AND NOT EXISTS (
                    SELECT 1 FROM post_views pv
                    WHERE pv.post_id = p.id AND LOWER(pv.username) = LOWER({ph})
                  )
                  AND EXISTS (
                    SELECT 1 FROM user_communities uc
                    JOIN users u ON u.id = uc.user_id
                    WHERE LOWER(u.username) = LOWER({ph}) AND uc.community_id IN ({placeholders})
                  )
                ORDER BY p.timestamp DESC
                LIMIT 200
            """,
                tuple(community_ids) + (username, username, username) + tuple(community_ids),
            )

            rows = c.fetchall()

            if not rows:
                return jsonify({"success": True, "posts": [], "username": username})

            posts = community_group_feed_svc.build_group_feed_post_dicts(
                c, rows, username, ph, name_map
            )

            logger.info(
                "Community group feed: parent_id=%s, returning %s posts",
                parent_id,
                len(posts),
            )
            return jsonify({"success": True, "posts": posts, "username": username})

    except Exception as e:
        logger.error("Error in community_group_feed for parent %s: %s", parent_id, e)
        return jsonify({"success": False, "error": "Failed to load timeline"}), 500


@communities_bp.route("/api/dashboard_unread_feed", methods=["GET"])
@_login_required
def api_dashboard_unread_feed():
    """Dashboard feed: unread and/or recent (48h) posts across parent network(s).

    Query:
      mode=unread (default) | recent48h
      parent_id=<int> optional root dashboard community; omit for all networks.
    """
    username = session.get("username")
    mode_raw = (request.args.get("mode") or "unread").strip().lower()
    mode = "recent48h" if mode_raw in ("recent48h", "recent", "48h") else "unread"
    parent_filter = request.args.get("parent_id", type=int)

    try:
        parents = community_svc.get_user_dashboard_communities(username or "")
        if not parents:
            return jsonify({"success": True, "posts": [], "username": username})

        allowed_parent_ids: Set[int] = set()
        for p in parents:
            try:
                pid = int(p.get("id") or 0)
            except (TypeError, ValueError):
                continue
            if pid:
                allowed_parent_ids.add(pid)

        if parent_filter is not None and parent_filter not in allowed_parent_ids:
            return (
                jsonify({"success": False, "error": "Invalid community filter"}),
                403,
            )

        parents_to_expand = (
            [p for p in parents if int(p.get("id") or 0) == parent_filter]
            if parent_filter is not None
            else parents
        )

        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            all_cids: Set[int] = set()
            for p in parents_to_expand:
                try:
                    pid = int(p.get("id") or 0)
                except (TypeError, ValueError):
                    continue
                if pid:
                    for cid in community_svc.get_descendant_community_ids(c, pid) or []:
                        all_cids.add(int(cid))
            community_ids = sorted(all_cids)
            if not community_ids:
                return jsonify({"success": True, "posts": [], "username": username})
            placeholders = ",".join([ph] * len(community_ids))
            c.execute(
                f"SELECT id, name FROM communities WHERE id IN ({placeholders})",
                tuple(community_ids),
            )
            name_map: Dict[int, Any] = {}
            for r in c.fetchall() or []:
                cid = r["id"] if hasattr(r, "keys") else r[0]
                cname = r["name"] if hasattr(r, "keys") else r[1]
                name_map[cid] = cname
            community_ids = [cid for cid in community_ids if cid in name_map]
            if not community_ids:
                return jsonify({"success": True, "posts": [], "username": username})
            ph_in = ",".join([ph for _ in community_ids])

            unread_clause = ""
            time_clause = ""
            if mode == "unread":
                unread_clause = f"""
                  AND NOT EXISTS (
                    SELECT 1 FROM post_views pv
                    WHERE pv.post_id = p.id AND LOWER(pv.username) = LOWER({ph})
                  )
                """
            else:
                time_clause = """
                  AND p.timestamp >= (UTC_TIMESTAMP() - INTERVAL 48 HOUR)
                """

            sql = f"""
                SELECT DISTINCT p.id, p.username, p.content, p.community_id,
                       p.timestamp, p.image_path, p.video_path,
                       p.audio_path, p.audio_summary
                FROM posts p
                WHERE p.community_id IN ({ph_in})
                  AND LOWER(p.username) <> LOWER({ph})
                  {unread_clause}
                  {time_clause}
                  AND EXISTS (
                    SELECT 1 FROM user_communities uc
                    JOIN users u ON u.id = uc.user_id
                    WHERE LOWER(u.username) = LOWER({ph}) AND uc.community_id IN ({ph_in})
                  )
                ORDER BY p.timestamp DESC
                LIMIT 200
            """
            if mode == "unread":
                query_params = tuple(community_ids) + (username, username, username) + tuple(
                    community_ids
                )
            else:
                query_params = tuple(community_ids) + (username, username) + tuple(community_ids)

            c.execute(sql, query_params)
            rows = c.fetchall()
            if not rows:
                return jsonify({"success": True, "posts": [], "username": username})
            posts = community_group_feed_svc.build_group_feed_post_dicts(
                c, rows, username, ph, name_map
            )
            logger.info(
                "dashboard_unread_feed mode=%s parent=%s: returning %s posts for %s",
                mode,
                parent_filter,
                len(posts),
                username,
            )
            return jsonify({"success": True, "posts": posts, "username": username})
    except Exception as e:
        logger.error("Error in dashboard_unread_feed: %s", e)
        return jsonify({"success": False, "error": "Failed to load feed"}), 500


def _collect_tree_community_ids(nodes: List[Dict[str, Any]]) -> List[int]:
    out: List[int] = []
    for n in nodes:
        out.append(int(n["id"]))
        children = n.get("children") or []
        if children:
            out.extend(_collect_tree_community_ids(children))
    return out


def _annotate_unread_on_community_tree(
    cursor: Any,
    nodes: List[Dict[str, Any]],
    username: str,
) -> None:
    if not nodes:
        return
    ids = _collect_tree_community_ids(nodes)
    if not ids:
        return
    unread_map = community_svc.count_unread_posts_by_community_ids(cursor, ids, username)

    def walk(items: List[Dict[str, Any]]) -> None:
        for n in items:
            cid = int(n["id"])
            n["unread_posts_count"] = int(unread_map.get(cid, 0))
            ch = n.get("children") or []
            if ch:
                walk(ch)

    walk(nodes)


def _load_user_communities_hierarchy(username: str) -> Dict[str, Any]:
    ph = get_sql_placeholder()
    is_app_admin_user = community_svc.is_app_admin(username)
    with get_db_connection() as conn:
        c = conn.cursor()
        if is_app_admin_user:
            c.execute(
                """
                SELECT DISTINCT c.id, c.name, c.type, c.parent_community_id,
                       c.creator_username, pc.name AS parent_name, NULL AS role,
                       COALESCE(c.is_frozen, 0) AS is_frozen
                FROM communities c
                LEFT JOIN communities pc ON c.parent_community_id = pc.id
                ORDER BY CASE WHEN c.parent_community_id IS NULL THEN 0 ELSE 1 END,
                         COALESCE(pc.name, c.name), c.name
                """
            )
            communities = c.fetchall() or []
        else:
            c.execute(
                f"""
                SELECT DISTINCT c.id, c.name, c.type, c.parent_community_id,
                       c.creator_username, pc.name AS parent_name, uc.role,
                       COALESCE(c.is_frozen, 0) AS is_frozen
                FROM communities c
                LEFT JOIN users u ON LOWER(u.username) = LOWER({ph})
                LEFT JOIN user_communities uc ON c.id = uc.community_id AND uc.user_id = u.id
                LEFT JOIN communities pc ON c.parent_community_id = pc.id
                WHERE uc.user_id IS NOT NULL
                   OR LOWER(c.creator_username) = LOWER({ph})
                ORDER BY CASE WHEN c.parent_community_id IS NULL THEN 0 ELSE 1 END,
                         COALESCE(pc.name, c.name), c.name
                """,
                (username, username),
            )
            direct_rows = c.fetchall() or []
            accessible_ids = {_row_value(row, "id", 0) for row in direct_rows}
            admin_ids = [
                _row_value(row, "id", 0)
                for row in direct_rows
                if _can_see_descendants(username, row)
            ]
            if admin_ids:
                c.execute("SELECT id, parent_community_id FROM communities")
                all_rows = c.fetchall() or []
                children_by_parent: Dict[int, List[int]] = {}
                for row in all_rows:
                    cid = _row_value(row, "id", 0)
                    parent_id = _row_value(row, "parent_community_id", 1)
                    if cid is not None and parent_id is not None:
                        children_by_parent.setdefault(int(parent_id), []).append(int(cid))
                for root_id in admin_ids:
                    _collect_descendants(int(root_id), children_by_parent, accessible_ids)

            if not accessible_ids:
                return {
                    "success": True,
                    "username": username,
                    "is_app_admin": is_app_admin_user,
                    "communities": [],
                }

            ids = sorted(int(x) for x in accessible_ids if x is not None)
            placeholders = ",".join([ph] * len(ids))
            c.execute(
                f"""
                SELECT DISTINCT c.id, c.name, c.type, c.parent_community_id,
                       c.creator_username, pc.name AS parent_name, uc.role,
                       COALESCE(c.is_frozen, 0) AS is_frozen
                FROM communities c
                LEFT JOIN communities pc ON c.parent_community_id = pc.id
                LEFT JOIN users current_u ON LOWER(current_u.username) = LOWER({ph})
                LEFT JOIN user_communities uc
                  ON uc.community_id = c.id AND uc.user_id = current_u.id
                WHERE c.id IN ({placeholders})
                ORDER BY CASE WHEN c.parent_community_id IS NULL THEN 0 ELSE 1 END,
                         COALESCE(pc.name, c.name), c.name
                """,
                tuple([username] + ids),
            )
            communities = c.fetchall() or []

        result = _build_community_tree(c, communities)
        _annotate_unread_on_community_tree(c, result, username)

    return {
        "success": True,
        "username": username,
        "is_app_admin": is_app_admin_user,
        "communities": result,
    }


def _can_see_descendants(username: str, row: Any) -> bool:
    creator = str(_row_value(row, "creator_username", 4) or "").strip().lower()
    role = str(_row_value(row, "role", 6) or "").strip().lower()
    return username.strip().lower() == creator or role in {"admin", "owner"}


def _collect_descendants(root_id: int, children_by_parent: Dict[int, List[int]], out: set) -> None:
    for child_id in children_by_parent.get(root_id, []):
        if child_id in out:
            continue
        out.add(child_id)
        _collect_descendants(child_id, children_by_parent, out)


def _build_community_tree(cursor: Any, rows: List[Any]) -> List[Dict[str, Any]]:
    all_by_id: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        cid = int(_row_value(row, "id", 0))
        all_by_id[cid] = {
            "id": cid,
            "name": _row_value(row, "name", 1),
            "type": _row_value(row, "type", 2),
            "parent_community_id": _row_value(row, "parent_community_id", 3),
            "creator_username": _row_value(row, "creator_username", 4),
            "role": _row_value(row, "role", 6),
            "is_frozen": bool(_row_value(row, "is_frozen", 7)),
            "children": [],
        }

    already_child = set()
    roots: Dict[int, Dict[str, Any]] = {}
    for cid, data in list(all_by_id.items()):
        parent_id = data.get("parent_community_id")
        if parent_id and int(parent_id) in all_by_id:
            parent = all_by_id[int(parent_id)]
            if cid not in already_child:
                parent["children"].append(data)
                already_child.add(cid)
        elif parent_id:
            parent = _placeholder_parent(cursor, int(parent_id))
            if parent:
                parent["children"].append(data)
                roots[parent["id"]] = parent
                already_child.add(cid)
        else:
            roots[cid] = data

    return list(roots.values())


def _placeholder_parent(cursor: Any, parent_id: int) -> Optional[Dict[str, Any]]:
    ph = get_sql_placeholder()
    cursor.execute(
        f"""
        SELECT id, name, type, creator_username, COALESCE(is_frozen, 0) AS is_frozen
        FROM communities
        WHERE id = {ph}
        """,
        (parent_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    return {
        "id": int(_row_value(row, "id", 0)),
        "name": _row_value(row, "name", 1),
        "type": _row_value(row, "type", 2),
        "creator_username": _row_value(row, "creator_username", 3),
        "is_frozen": bool(_row_value(row, "is_frozen", 4)),
        "parent_community_id": None,
        "children": [],
        "is_parent_only": True,
    }


@communities_bp.route("/get_community_members", methods=["POST"])
@_login_required
def get_community_members():
    """Return member list, roles, and current-user role for a community."""
    username = session["username"]
    community_id = request.form.get("community_id")
    if not community_id:
        return jsonify({"success": False, "error": "No community ID specified"}), 400

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            placeholder = get_sql_placeholder()
            c.execute(
                f"""
                SELECT 1 FROM user_communities uc
                INNER JOIN users u ON uc.user_id = u.id
                WHERE uc.community_id = {placeholder} AND LOWER(u.username) = LOWER({placeholder})
                """,
                (community_id, username),
            )
            if not c.fetchone():
                return jsonify({"success": False, "error": "Not a member of this community"}), 403

            c.execute(f"SELECT creator_username, name FROM communities WHERE id = {placeholder}", (community_id,))
            community = c.fetchone()
            if not community:
                return jsonify({"success": False, "error": "Community not found"}), 404
            creator_username = community["creator_username"] if hasattr(community, "keys") else community[0]

            c.execute(
                f"""
                SELECT
                    u.username,
                    up.profile_picture,
                    c.creator_username,
                    COALESCE(uc.role, 'member') AS role,
                    CASE WHEN c.creator_username = u.username THEN 1 ELSE 0 END AS is_creator
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                LEFT JOIN user_profiles up ON up.username = u.username
                JOIN communities c ON c.id = uc.community_id
                WHERE uc.community_id = {placeholder}
                GROUP BY u.username, up.profile_picture, c.creator_username, uc.role
                ORDER BY
                    CASE WHEN c.creator_username = u.username THEN 0 ELSE 1 END,
                    CASE
                        WHEN COALESCE(uc.role, 'member') = 'admin' THEN 0
                        WHEN COALESCE(uc.role, 'member') = 'owner' THEN 1
                        ELSE 2
                    END,
                    u.username
                """,
                (community_id,),
            )

            members = []
            for row in c.fetchall():
                username_val = row["username"] if hasattr(row, "keys") else row[0]
                profile_picture_val = row["profile_picture"] if hasattr(row, "keys") else row[1]
                role_val = row["role"] if hasattr(row, "keys") else row[3]
                is_creator_val = row["is_creator"] if hasattr(row, "keys") else row[4]

                if str(username_val).lower() == "admin":
                    continue
                members.append(
                    {
                        "username": username_val,
                        "profile_picture": profile_picture_val,
                        "role": role_val,
                        "is_creator": bool(is_creator_val),
                        "is_current_user": username_val == username,
                    }
                )

            current_user_role = "member"
            if username and creator_username and username.lower() == creator_username.lower():
                current_user_role = "owner"
            elif str(username).lower() == "admin":
                current_user_role = "app_admin"
            else:
                c.execute(
                    f"""
                    SELECT uc.role
                    FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    WHERE LOWER(u.username) = LOWER({placeholder}) AND uc.community_id = {placeholder}
                    """,
                    (username, community_id),
                )
                row = c.fetchone()
                if row:
                    uc_role = row["role"] if hasattr(row, "keys") else (row[0] if row else None)
                    normalized_uc_role = (uc_role or "").strip().lower()
                    if normalized_uc_role == "owner":
                        current_user_role = "owner"
                    elif normalized_uc_role in {"admin", "moderator", "manager", "parent_admin"}:
                        current_user_role = "admin"

                if current_user_role == "member":
                    c.execute(
                        f"SELECT 1 FROM community_admins WHERE community_id = {placeholder} AND LOWER(username) = LOWER({placeholder})",
                        (community_id, username),
                    )
                    if c.fetchone():
                        current_user_role = "admin"

        return jsonify(
            {
                "success": True,
                "members": members,
                "current_user_role": current_user_role,
                "community_name": community["name"] if hasattr(community, "keys") else community[1],
                "can_manage_content_generation": can_manage_community_jobs(username, int(community_id)),
            }
        )
    except Exception as exc:
        logger.error("Error getting community members for %s: %s", username, exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@communities_bp.route("/add_community_member", methods=["POST"])
@_login_required
def add_community_member():
    username = session["username"]
    community_id = request.form.get("community_id")
    new_member_username = request.form.get("username")
    CommunityMembershipLimitError, add_user_to_community_fn, _ = _legacy_community_helpers()
    if not community_id or not new_member_username:
        return jsonify({"success": False, "error": "Missing required parameters"}), 400
    try:
        community_id_int = int(community_id)
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "Invalid community ID"}), 400

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id_int,))
            community = c.fetchone()
            if not community:
                return jsonify({"success": False, "error": "Community not found"}), 404

            creator_username = community["creator_username"] if hasattr(community, "keys") else community[0]
            if username not in (creator_username, "admin"):
                return jsonify({"success": False, "error": "Only community owner or admin can add members"}), 403

            c.execute("SELECT id FROM users WHERE username = ?", (new_member_username,))
            new_member = c.fetchone()
            if not new_member:
                return jsonify({"success": False, "error": "User not found"}), 404

            c.execute(
                """
                SELECT 1 FROM user_communities uc
                INNER JOIN users u ON uc.user_id = u.id
                WHERE uc.community_id = ? AND LOWER(u.username) = LOWER(?)
                """,
                (community_id_int, new_member_username),
            )
            if c.fetchone():
                return jsonify({"success": False, "error": "User is already a member"}), 400

            try:
                add_user_to_community_fn(c, new_member["id"], community_id_int, role="member", username=new_member_username)
            except CommunityMembershipLimitError as limit_err:
                conn.commit()  # persist the owner notification fired from the helper
                payload, status = _render_member_cap_payload(limit_err, session_username=username)
                return jsonify(payload), status
            conn.commit()
        return jsonify({"success": True})
    except Exception as exc:
        logger.error("Error adding community member for %s: %s", username, exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@communities_bp.route("/update_member_role", methods=["POST"])
@_login_required
def update_member_role():
    """Update a member's role (make admin, remove admin, transfer ownership)."""
    username = session["username"]
    community_id = request.form.get("community_id")
    target_username = request.form.get("target_username")
    new_role = request.form.get("new_role")
    _, _, is_app_admin_fn = _legacy_community_helpers()

    if not all([community_id, target_username, new_role]):
        return jsonify({"success": False, "error": "Missing required parameters"}), 400

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            c.execute("SELECT creator_username, type, parent_community_id FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            if not community:
                return jsonify({"success": False, "error": "Community not found"}), 404

            current_owner = community["creator_username"] if hasattr(community, "keys") else community[0]
            community_type = community["type"] if hasattr(community, "keys") else community[1]
            parent_community_id = community["parent_community_id"] if hasattr(community, "keys") else community[2]

            is_app_admin_user = is_app_admin_fn(username)
            is_owner = username == current_owner

            c.execute(
                """
                SELECT role FROM user_communities
                WHERE user_id = (SELECT id FROM users WHERE username = ?) AND community_id = ?
                """,
                (username, community_id),
            )
            current_user_role_row = c.fetchone()
            is_community_admin = current_user_role_row and (
                current_user_role_row["role"] == "admin"
                if hasattr(current_user_role_row, "keys")
                else current_user_role_row[0] == "admin"
            )

            is_parent_admin = False
            if community_type and community_type.lower() == "business" and parent_community_id:
                c.execute(
                    """
                    SELECT c.creator_username, uc.role
                    FROM communities c
                    LEFT JOIN user_communities uc ON c.id = uc.community_id
                        AND uc.user_id = (SELECT id FROM users WHERE username = ?)
                    WHERE c.id = ?
                    """,
                   (username, parent_community_id),
                )
                parent_info = c.fetchone()
                if parent_info:
                    parent_owner = parent_info["creator_username"] if hasattr(parent_info, "keys") else parent_info[0]
                    parent_user_role = parent_info["role"] if hasattr(parent_info, "keys") else parent_info[1]
                    is_parent_admin = username == parent_owner or parent_user_role == "admin"

            if new_role == "owner":
                if not is_app_admin_user:
                    return jsonify({"success": False, "error": "Only app admin can transfer ownership"}), 403

                c.execute("UPDATE communities SET creator_username = ? WHERE id = ?", (target_username, community_id))
                c.execute(
                    """
                    INSERT INTO user_communities (user_id, community_id, role, joined_at)
                    VALUES ((SELECT id FROM users WHERE username = ?), ?, 'owner', NOW())
                    ON DUPLICATE KEY UPDATE role = 'owner'
                    """,
                    (target_username, community_id),
                )

                if current_owner not in ("admin", target_username):
                    c.execute(
                        """
                        INSERT INTO user_communities (user_id, community_id, role, joined_at)
                        VALUES ((SELECT id FROM users WHERE username = ?), ?, 'admin', NOW())
                        ON DUPLICATE KEY UPDATE role = 'admin'
                        """,
                        (current_owner, community_id),
                    )

            elif new_role == "admin":
                if not (is_owner or is_app_admin_user or is_parent_admin):
                    return jsonify({"success": False, "error": "Only owner, app admin, or parent community admin can appoint admins"}), 403
                if target_username == current_owner:
                    return jsonify({"success": False, "error": "Owner cannot be made an admin"}), 400

                c.execute(
                    """
                    INSERT INTO user_communities (user_id, community_id, role, joined_at)
                    VALUES ((SELECT id FROM users WHERE username = ?), ?, 'admin', NOW())
                    ON DUPLICATE KEY UPDATE role = 'admin'
                    """,
                    (target_username, community_id),
                )

            elif new_role == "member":
                if not (is_owner or is_app_admin_user or is_parent_admin):
                    return jsonify({"success": False, "error": "Only owner, app admin, or parent community admin can remove admins"}), 403

                c.execute(
                    """
                    INSERT INTO user_communities (user_id, community_id, role, joined_at)
                    VALUES ((SELECT id FROM users WHERE username = ?), ?, 'member', NOW())
                    ON DUPLICATE KEY UPDATE role = 'member'
                    """,
                    (target_username, community_id),
                )

                c.execute(
                    """
                    SELECT id, parent_community_id
                    FROM communities
                    WHERE creator_username = ?
                    """,
                    (target_username,),
                )
                all_owned = c.fetchall()

                def get_all_descendant_ids(parent_id, all_comms_list):
                    descendants = []
                    for comm in all_comms_list:
                        pid = comm["parent_community_id"] if hasattr(comm, "keys") else comm[1]
                        if pid == parent_id:
                            cid = comm["id"] if hasattr(comm, "keys") else comm[0]
                            descendants.append(cid)
                            descendants.extend(get_all_descendant_ids(cid, all_comms_list))
                    return descendants

                descendant_ids = get_all_descendant_ids(community_id, all_owned)

                for sub_id in descendant_ids:
                    c.execute(
                        """
                        UPDATE user_communities
                        SET role = 'admin'
                        WHERE user_id = (SELECT id FROM users WHERE username = ?)
                        AND community_id = ?
                        AND role = 'owner'
                        """,
                        (target_username, sub_id),
                    )
                    if c.rowcount > 0:
                        logger.info(
                            "Demoted %s from owner to admin in sub-community %s (lost parent admin rights)",
                            target_username,
                            sub_id,
                        )

            else:
                return jsonify({"success": False, "error": "Invalid role specified"}), 400

            conn.commit()
            return jsonify({"success": True, "message": "Role updated successfully"})

    except Exception as exc:
        logger.error("Error updating member role: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@communities_bp.route("/remove_community_member", methods=["POST"])
@_login_required
def remove_community_member():
    username = session["username"]
    community_id = request.form.get("community_id")
    member_username = request.form.get("username")
    if not community_id or not member_username:
        return jsonify({"success": False, "error": "Missing required parameters"}), 400

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            if not community:
                return jsonify({"success": False, "error": "Community not found"}), 404

            creator_username = community["creator_username"] if hasattr(community, "keys") else community[0]
            if username not in (creator_username, "admin"):
                return jsonify({"success": False, "error": "Only community owner or admin can remove members"}), 403

            if member_username == creator_username:
                return jsonify({"success": False, "error": "Cannot remove community owner"}), 400

            c.execute("SELECT id FROM users WHERE username = ?", (member_username,))
            member = c.fetchone()
            if not member:
                return jsonify({"success": False, "error": "User not found"}), 404

            c.execute(
                "DELETE FROM user_communities WHERE community_id = ? AND user_id = ?",
                (community_id, member["id"]),
            )
            conn.commit()

        # Auto-unfreeze if the community was frozen due to subscription
        # expiration and removing this member brought it within the
        # Free-tier cap. Best-effort — never block the removal.
        try:
            from backend.services import community_lifecycle as _lifecycle
            from backend.services import subscription_audit as _audit
            if _lifecycle.maybe_auto_unfreeze(int(community_id)):
                _audit.log(
                    username=username or "",
                    action="community_auto_unfrozen_member_removed",
                    source="remove_community_member",
                    metadata={
                        "community_id": int(community_id),
                        "removed_member": member_username,
                    },
                )
        except Exception:
            logger.warning("[FREEZE] auto-unfreeze hook failed (non-fatal)", exc_info=True)

        return jsonify({"success": True})
    except Exception as exc:
        logger.error("Error removing community member for %s: %s", username, exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@communities_bp.route("/api/member/accessible_subcommunities", methods=["POST"])
@_login_required
def get_accessible_subcommunities():
    """
    Get sub-communities where an admin can add a specific member.
    Respects admin access levels:
    - Parent community admin: can add to any descendant
    - Sub-community admin: can only add to descendants of that sub-community
    Returns only communities where the target member is NOT already a member.
    """
    username = session["username"]
    data = request.get_json() or {}
    community_id = data.get("community_id")
    target_username = data.get("target_username")
    _, _, is_app_admin_fn = _legacy_community_helpers()

    if not community_id or not target_username:
        return jsonify({"success": False, "error": "Missing required parameters"}), 400

    try:
        community_id = int(community_id)
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "Invalid community_id"}), 400

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get target user's ID
            c.execute("SELECT id FROM users WHERE username = ?", (target_username,))
            target_user = c.fetchone()
            if not target_user:
                return jsonify({"success": False, "error": "User not found"}), 404
            target_user_id = target_user["id"] if hasattr(target_user, "keys") else target_user[0]
            
            # Get all communities where the target is already a member
            c.execute("SELECT community_id FROM user_communities WHERE user_id = ?", (target_user_id,))
            member_of = {row["community_id"] if hasattr(row, "keys") else row[0] for row in c.fetchall()}
            
            # Find all communities where the current user is admin/owner
            admin_communities = set()
            is_global_admin = is_app_admin_fn(username)
            
            if is_global_admin:
                # App admin can access everything
                c.execute("SELECT id FROM communities WHERE is_active = 1")
                admin_communities = {row["id"] if hasattr(row, "keys") else row[0] for row in c.fetchall()}
            else:
                # Get communities where user is admin or owner
                c.execute("""
                    SELECT uc.community_id, uc.role, c.creator_username
                    FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    JOIN communities c ON uc.community_id = c.id
                    WHERE u.username = ? AND c.is_active = 1
                """, (username,))
                for row in c.fetchall():
                    cid = row["community_id"] if hasattr(row, "keys") else row[0]
                    role = row["role"] if hasattr(row, "keys") else row[1]
                    creator = row["creator_username"] if hasattr(row, "keys") else row[2]
                    if role in ("admin", "owner") or username == creator:
                        admin_communities.add(cid)
            
            if not admin_communities:
                return jsonify({"success": False, "error": "You don't have admin access"}), 403
            
            # Get all descendant communities of communities where user is admin
            accessible_communities = set()
            for admin_cid in admin_communities:
                # Get all descendants
                descendants = _get_descendant_communities(c, admin_cid)
                accessible_communities.update(descendants)
            
            # Also include the communities they're admin of
            accessible_communities.update(admin_communities)
            
            # Filter to only descendants of the current community being viewed
            current_descendants = _get_descendant_communities(c, community_id)
            # Don't include the current community itself, only its children
            if community_id in current_descendants:
                current_descendants.remove(community_id)
            
            # Intersection: accessible AND descendants of current community AND not already a member
            available_communities = accessible_communities & current_descendants - member_of
            
            if not available_communities:
                return jsonify({"success": True, "subcommunities": []})
            
            # Get community details
            placeholders = ",".join(["?" for _ in available_communities])
            c.execute(f"""
                SELECT id, name, parent_community_id 
                FROM communities 
                WHERE id IN ({placeholders}) AND is_active = 1
                ORDER BY name
            """, tuple(available_communities))
            
            subcommunities = []
            for row in c.fetchall():
                subcommunities.append({
                    "id": row["id"] if hasattr(row, "keys") else row[0],
                    "name": row["name"] if hasattr(row, "keys") else row[1],
                    "parent_community_id": row["parent_community_id"] if hasattr(row, "keys") else row[2],
                })
            
            return jsonify({"success": True, "subcommunities": subcommunities})
            
    except Exception as exc:
        logger.error("Error getting accessible subcommunities: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


@communities_bp.route("/api/member/add_to_subcommunity", methods=["POST"])
@_login_required
def add_member_to_subcommunity():
    """
    Add a member to a sub-community.
    Validates that the current user has admin access to the target sub-community.
    """
    username = session["username"]
    data = request.get_json() or {}
    target_username = data.get("target_username")
    target_community_id = data.get("target_community_id")
    source_community_id = data.get("source_community_id")  # The community page we're on
    CommunityMembershipLimitError, add_user_to_community_fn, is_app_admin_fn = _legacy_community_helpers()

    if not target_username or not target_community_id:
        return jsonify({"success": False, "error": "Missing required parameters"}), 400

    try:
        target_community_id = int(target_community_id)
        if source_community_id:
            source_community_id = int(source_community_id)
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "Invalid community_id"}), 400

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get target user
            c.execute("SELECT id FROM users WHERE username = ?", (target_username,))
            target_user = c.fetchone()
            if not target_user:
                return jsonify({"success": False, "error": "User not found"}), 404
            target_user_id = target_user["id"] if hasattr(target_user, "keys") else target_user[0]
            
            # Check if user is already a member
            c.execute(
                "SELECT 1 FROM user_communities WHERE user_id = ? AND community_id = ?",
                (target_user_id, target_community_id)
            )
            if c.fetchone():
                return jsonify({"success": False, "error": "User is already a member of this community"}), 400
            
            # Verify admin has access to the target community
            is_global_admin = is_app_admin_fn(username)
            has_access = False
            
            if is_global_admin:
                has_access = True
            else:
                # Check if user is admin of target community or any of its ancestors
                c.execute("""
                    SELECT uc.role, c.creator_username
                    FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    JOIN communities c ON uc.community_id = c.id
                    WHERE u.username = ? AND c.id = ?
                """, (username, target_community_id))
                row = c.fetchone()
                if row:
                    role = row["role"] if hasattr(row, "keys") else row[0]
                    creator = row["creator_username"] if hasattr(row, "keys") else row[1]
                    if role in ("admin", "owner") or username == creator:
                        has_access = True
                
                if not has_access:
                    # Check ancestors
                    ancestors = _get_ancestor_communities(c, target_community_id)
                    for anc_id in ancestors:
                        c.execute("""
                            SELECT uc.role, c.creator_username
                            FROM user_communities uc
                            JOIN users u ON uc.user_id = u.id
                            JOIN communities c ON uc.community_id = c.id
                            WHERE u.username = ? AND c.id = ?
                        """, (username, anc_id))
                        row = c.fetchone()
                        if row:
                            role = row["role"] if hasattr(row, "keys") else row[0]
                            creator = row["creator_username"] if hasattr(row, "keys") else row[1]
                            if role in ("admin", "owner") or username == creator:
                                has_access = True
                                break
            
            if not has_access:
                return jsonify({"success": False, "error": "You don't have admin access to this community"}), 403
            
            # Add user to community
            try:
                add_user_to_community_fn(c, target_user_id, target_community_id, role="member", username=target_username)
                conn.commit()
            except CommunityMembershipLimitError as limit_err:
                conn.commit()  # persist the owner notification fired from the helper
                payload, status = _render_member_cap_payload(limit_err, session_username=username)
                return jsonify(payload), status
            
            # Get community name for response
            c.execute("SELECT name FROM communities WHERE id = ?", (target_community_id,))
            comm_row = c.fetchone()
            community_name = comm_row["name"] if comm_row and hasattr(comm_row, "keys") else (comm_row[0] if comm_row else "the community")
            
            return jsonify({
                "success": True, 
                "message": f"{target_username} has been added to {community_name}"
            })
            
    except Exception as exc:
        logger.error("Error adding member to subcommunity: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500


def _get_descendant_communities(cursor, community_id: int) -> set:
    """Get all descendant community IDs including the given community."""
    descendants = {community_id}
    queue = [community_id]
    
    while queue:
        current_id = queue.pop(0)
        cursor.execute("SELECT id FROM communities WHERE parent_community_id = ? AND is_active = 1", (current_id,))
        for row in cursor.fetchall():
            child_id = row["id"] if hasattr(row, "keys") else row[0]
            if child_id not in descendants:
                descendants.add(child_id)
                queue.append(child_id)
    
    return descendants


def _get_ancestor_communities(cursor, community_id: int) -> list:
    """Get all ancestor community IDs (parent chain)."""
    ancestors = []
    cursor.execute("SELECT parent_community_id FROM communities WHERE id = ?", (community_id,))
    row = cursor.fetchone()
    
    while row:
        parent_id = row["parent_community_id"] if hasattr(row, "keys") else row[0]
        if not parent_id or parent_id in ancestors:
            break
        ancestors.append(parent_id)
        cursor.execute("SELECT parent_community_id FROM communities WHERE id = ?", (parent_id,))
        row = cursor.fetchone()
    
    return ancestors


# ---------------------------------------------------------------------------
# Cron endpoint — community-lifecycle dispatcher
#
# Wired from Cloud Scheduler (see docs/cloud-scheduler-cron.md). Runs once a
# day and delegates to :mod:`backend.services.community_lifecycle`. Auth is
# the shared ``X-Cron-Secret`` header, not a session cookie — Cloud
# Scheduler has no browser context.
# ---------------------------------------------------------------------------


def _cron_authed() -> bool:
    expected = os.environ.get("CRON_SHARED_SECRET") or ""
    if not expected:
        return False
    provided = request.headers.get("X-Cron-Secret") or ""
    return provided == expected


@communities_bp.route("/api/cron/communities/lifecycle-dispatch", methods=["POST"])
def cron_community_lifecycle_dispatch():
    """Fire due Free-community lifecycle warnings (pre-archive + purge).

    Query params:
      ``dry_run`` (``1``/``true``/``yes``) — preview what would send
      without writing dedup rows or calling the email / in-app APIs.
      Useful for one-off verification after a KB threshold change.
    """
    if not _cron_authed():
        return jsonify({"success": False, "error": "forbidden"}), 403

    raw = (request.args.get("dry_run") or "").strip().lower()
    dry_run = raw in {"1", "true", "yes", "on"}

    from backend.services import community_lifecycle

    try:
        result = community_lifecycle.dispatch_due_notifications(dry_run=dry_run)
        return jsonify({"success": True, **result})
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("community_lifecycle dispatch failed: %s", exc)
        return jsonify({"success": False, "error": "dispatch_failed"}), 500


@communities_bp.route(
    "/api/communities/<int:community_id>/republish_welcome_post",
    methods=["POST"],
)
@_login_required
def republish_welcome_post(community_id: int):
    """Re-publish Steve's community welcome post.

    Owner / admin / app-admin only. Idempotent: a no-op when a live welcome
    post already exists. See ``docs/STEVE_COMMUNITY_WELCOME.md``.
    """
    username = session["username"]

    from backend.services.community import is_community_admin, is_community_owner
    from backend.services.steve_community_welcome import publish_welcome_post

    _, _, is_app_admin = _legacy_community_helpers()
    if not (
        is_app_admin(username)
        or is_community_owner(username, community_id)
        or is_community_admin(username, community_id)
    ):
        return jsonify({"success": False, "error": "forbidden"}), 403

    try:
        post_id = publish_welcome_post(community_id)
    except Exception as exc:
        logger.exception(
            "republish_welcome_post failed for community %s: %s",
            community_id, exc,
        )
        return jsonify({"success": False, "error": "republish_failed"}), 500

    if post_id is None:
        # Either community not found, owner is in skip-list, or insert hit a
        # benign error (already logged inside the service).
        return jsonify({"success": False, "error": "not_published"}), 200

    return jsonify({"success": True, "post_id": post_id})
