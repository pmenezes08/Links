"""Community management routes blueprint."""

from __future__ import annotations

import logging
import os
from functools import lru_cache, wraps

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

from backend.services.database import get_db_connection, get_sql_placeholder


communities_bp = Blueprint("communities", __name__)
logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _legacy_community_helpers():
    """Lazy import helpers from the legacy monolith to avoid circular imports."""
    from bodybuilding_app import (  # type: ignore import-not-found
        CommunityMembershipLimitError,
        add_user_to_community,
        is_app_admin,
    )

    return CommunityMembershipLimitError, add_user_to_community, is_app_admin


def _login_required(view_func):
    """Simple login_required decorator that avoids circular imports."""

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            try:
                current_app.logger.info(
                    "No username in session for %s, redirecting to login", request.path
                )
            except Exception:
                pass
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
                add_user_to_community_fn(c, new_member["id"], community_id_int, role="member")
            except CommunityMembershipLimitError as limit_err:
                return jsonify({"success": False, "error": str(limit_err)}), 403
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
        return jsonify({"success": True})
    except Exception as exc:
        logger.error("Error removing community member for %s: %s", username, exc)
        return jsonify({"success": False, "error": str(exc)}), 500
