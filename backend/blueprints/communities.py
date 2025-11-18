"""Community management routes blueprint."""

from __future__ import annotations

import logging
import os
from functools import wraps

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

from bodybuilding_app import (
    CommunityMembershipLimitError,
    add_user_to_community,
    get_db_connection,
    get_sql_placeholder,
    is_app_admin,
)


communities_bp = Blueprint("communities", __name__)
logger = logging.getLogger(__name__)


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

            c.execute("SELECT creator_username, name FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            if not community:
                return jsonify({"success": False, "error": "Community not found"}), 404
            creator_username = community["creator_username"] if hasattr(community, "keys") else community[0]

            c.execute(
                """
                SELECT DISTINCT
                    u.username,
                    up.profile_picture,
                    c.creator_username,
                    COALESCE(uc.role, 'member') AS role,
                    CASE WHEN c.creator_username = u.username THEN 1 ELSE 0 END AS is_creator
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                LEFT JOIN user_profiles up ON up.username = u.username
                JOIN communities c ON c.id = uc.community_id
                WHERE uc.community_id = ?
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
                    if (uc_role or "").lower() in ("admin", "owner"):
                        current_user_role = uc_role.lower()

                if current_user_role == "member":
                    c.execute(
                        "SELECT 1 FROM community_admins WHERE community_id = ? AND LOWER(username) = LOWER(?)",
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
                add_user_to_community(c, new_member["id"], community_id_int, role="member")
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

            is_app_admin_user = is_app_admin(username)
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

@communities_bp.route('/create_community', methods=['POST'])
@_login_required
def create_community():
    """Create a new community"""
    try:
        username = session.get('username')
        logger.info(f"=== CREATE COMMUNITY REQUEST from {username} ===")
        
        # Log all form data for debugging
        logger.info(f"Form data: {dict(request.form)}")
        
        is_app_admin_user = is_app_admin(username)
        subscription_value = 'free'
        is_premium_user = False
        is_free_creator = False
        is_business_admin_creating_sub = False
        requested_type = request.form.get('type')
        raw_parent_value = request.form.get('parent_community_id', None)

                parent_community_id_check = normalize_parent_value(raw_parent_value)
        
        # Enforce verified email
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT email_verified FROM users WHERE username=?", (username,))
            row = c.fetchone()
            verified = False
            if row is not None:
                verified = bool(row['email_verified'] if hasattr(row, 'keys') else row[0])
            if not verified:
                return jsonify({'success': False, 'error': 'please verify your email'}), 403
            # Enforce subscription: only premium users (or admin) can create communities
            # Exception: Business community admins can create sub-communities without premium
            try:
                c.execute("SELECT subscription FROM users WHERE username=?", (username,))
                sub_row = c.fetchone()
                subscription = (sub_row['subscription'] if hasattr(sub_row,'keys') else (sub_row[0] if sub_row else 'free'))
            except Exception:
                subscription = 'free'
            subscription_value = normalize_subscription(subscription)
            is_premium_user = subscription_value == 'premium'
            
            # Check if this is a Business sub-community creation by a parent admin
            community_type_check = (requested_type or '').strip().lower()
            
            if parent_community_id_check is not None and community_type_check == 'business':
                # Check if user is admin of parent Business community (using same connection/cursor)
                try:
                    placeholder_check = get_sql_placeholder()
                    c.execute(f"SELECT type, creator_username FROM communities WHERE id = {placeholder_check}", (parent_community_id_check,))
                    parent_check = c.fetchone()
                    if parent_check:
                        parent_type_check = parent_check['type'] if hasattr(parent_check, 'keys') else parent_check[0]
                        parent_creator_check = parent_check['creator_username'] if hasattr(parent_check, 'keys') else parent_check[1]
                        
                        if parent_type_check.lower() == 'business':
                            # Check if owner
                            if username == parent_creator_check:
                                is_business_admin_creating_sub = True
                            else:
                                # Check if admin
                                c.execute(f"""
                                    SELECT role FROM user_communities
                                    WHERE user_id = (SELECT id FROM users WHERE username = {placeholder_check})
                                    AND community_id = {placeholder_check}
                                """, (username, parent_community_id_check))
                                role_check = c.fetchone()
                                if role_check:
                                    user_role_check = role_check['role'] if hasattr(role_check, 'keys') else role_check[0]
                                    if user_role_check == 'admin':
                                        is_business_admin_creating_sub = True
                except Exception as bypass_err:
                    logger.warning(f"Error checking Business admin bypass: {bypass_err}")
            
            raw_type = str(requested_type or '').strip().lower() or 'general'

            # Determine if user should be treated as free-plan creator
            parent_is_none = parent_community_id_check is None
            if not is_app_admin_user:
                if not is_premium_user:
                    if parent_is_none:
                        is_free_creator = True
                        raw_type = 'general'
        
        name = request.form.get('name')
        description = request.form.get('description', '')
        location = request.form.get('location', '')
        template = request.form.get('template', 'default')
        background_color = request.form.get('background_color', '#2d3839')
        text_color = request.form.get('text_color', '#ffffff')
        accent_color = request.form.get('accent_color', '#4db6ac')
        card_color = request.form.get('card_color', '#1a2526')
        parent_community_id = parent_community_id_check
        parent_community_id_value: Optional[int] = None
        if parent_community_id is not None:
            try:
                parent_community_id_value = int(str(parent_community_id))
            except (TypeError, ValueError):
                return jsonify({'success': False, 'error': 'Invalid parent community specified'}), 400
        
        if not name:
            return jsonify({'success': False, 'error': 'Name is required'}), 400
        
        # Business communities can only be created by app admin (parent) or parent community admins (sub-communities)
        normalized_type = raw_type
        if normalized_type == 'business':
            if parent_community_id is not None:
                # Check if user is admin of parent Business community
                try:
                    with get_db_connection() as conn:
                        c_check = conn.cursor()
                        placeholder = get_sql_placeholder()
                        
                        # Check parent community type
                        c_check.execute(f"SELECT type, creator_username FROM communities WHERE id = {placeholder}", (parent_community_id,))
                        parent_info = c_check.fetchone()
                        if not parent_info:
                            return jsonify({'success': False, 'error': 'Parent community not found'}), 404
                        
                        parent_type = parent_info['type'] if hasattr(parent_info, 'keys') else parent_info[0]
                        parent_creator = parent_info['creator_username'] if hasattr(parent_info, 'keys') else parent_info[1]
                        
                        if parent_type.lower() != 'business':
                            return jsonify({'success': False, 'error': 'Business sub-communities can only be created under Business parent communities'}), 403
                        
                        # Check if user is owner
                        if username == parent_creator or is_app_admin(username):
                            # Owner or app admin - allowed
                            logger.info(f"Business sub-community creation allowed: {username} is owner/admin of parent {parent_community_id}")
                        else:
                            # Check if user is admin of parent community
                            logger.info(f"Checking if {username} is admin of parent community {parent_community_id}")
                            c_check.execute(f"""
                                SELECT role FROM user_communities
                                WHERE user_id = (SELECT id FROM users WHERE username = {placeholder})
                                AND community_id = {placeholder}
                            """, (username, parent_community_id))
                            user_role_row = c_check.fetchone()
                            user_role = user_role_row['role'] if (user_role_row and hasattr(user_role_row, 'keys')) else (user_role_row[0] if user_role_row else None)
                            
                            logger.info(f"User {username} role in parent {parent_community_id}: {user_role}")
                            
                            if user_role != 'admin':
                                logger.warning(f"Permission denied: {username} has role '{user_role}' (not 'admin') in parent {parent_community_id}")
                                return jsonify({'success': False, 'error': f'Only parent community admins can create Business sub-communities. Your role: {user_role}'}), 403
                            
                            logger.info(f"Business sub-community creation allowed: {username} is admin of parent {parent_community_id}")
                except Exception as e:
                    logger.error(f"Error checking parent community permissions: {e}")
                    return jsonify({'success': False, 'error': f'Permission check failed: {str(e)}'}), 500
            else:
                # Creating parent Business community - only app admin
                if not is_app_admin(username):
                    return jsonify({'success': False, 'error': 'Only app admin can create Business communities'}), 403
        
        # Generate a dummy join_code to satisfy database UNIQUE constraint
        # (Not used for joining anymore, but column still exists)
        import random
        import string
        join_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        
        # Handle background image
        background_path = None
        if 'background_file' in request.files:
            file = request.files['background_file']
            if file.filename != '':
                background_path = save_uploaded_file(file, 'community_backgrounds')
                if not background_path:
                    return jsonify({'success': False, 'error': 'Invalid background image file type. Allowed: png, jpg, jpeg, gif, webp'}), 400
        
        # Use URL if no file uploaded
        if not background_path:
            background_url = request.form.get('background_url', '').strip()
            if background_url:
                background_path = background_url
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Apply free-plan community limits before creation
            parent_id_int = parent_community_id_value
            if is_free_creator:
                if parent_id_int is None:
                    if USE_MYSQL:
                        c.execute("""
                            SELECT COUNT(*) FROM communities 
                            WHERE creator_username = %s AND (parent_community_id IS NULL OR parent_community_id = '')
                        """, (username,))
                    else:
                        c.execute("""
                            SELECT COUNT(*) FROM communities 
                            WHERE creator_username = ? AND (parent_community_id IS NULL OR parent_community_id = '')
                        """, (username,))
                    parent_count = get_scalar_result(c.fetchone(), column_index=0) or 0
                    try:
                        parent_count = int(parent_count)
                    except Exception:
                        parent_count = 0
                    if parent_count >= 2:
                        return jsonify({'success': False, 'error': 'Free plan allows up to 2 parent communities. Upgrade to create more communities.'}), 403
                else:
                    parent_info = get_community_basic(c, parent_id_int)
                    if not parent_info:
                        return jsonify({'success': False, 'error': 'Parent community not found'}), 404
                    ancestors = get_community_ancestors(c, parent_id_int)
                    depth = len(ancestors)
                    top_info = ancestors[-1] if ancestors else parent_info
                    top_creator = top_info.get('creator_username')
                    if top_creator != username:
                        return jsonify({'success': False, 'error': 'Free plan sub-communities must be created under your own parent communities.'}), 403
                    is_free_creator = True
                    if depth > 2:
                        return jsonify({'success': False, 'error': 'Free plan communities support only one nested level.'}), 403
                    child_placeholder = get_sql_placeholder()
                    if parent_info.get('parent_community_id') is None:
                        c.execute(f"SELECT COUNT(*) FROM communities WHERE parent_community_id = {child_placeholder}", (parent_id_int,))
                        child_count = get_scalar_result(c.fetchone(), column_index=0) or 0
                        try:
                            child_count = int(child_count)
                        except Exception:
                            child_count = 0
                        if child_count >= 3:
                            return jsonify({'success': False, 'error': 'Free plan parent communities can have up to 3 sub-communities.'}), 403
                    else:
                        c.execute(f"SELECT COUNT(*) FROM communities WHERE parent_community_id = {child_placeholder}", (parent_id_int,))
                        nested_count = get_scalar_result(c.fetchone(), column_index=0) or 0
                        try:
                            nested_count = int(nested_count)
                        except Exception:
                            nested_count = 0
                        if nested_count >= 1:
                            return jsonify({'success': False, 'error': 'Free plan sub-communities can have only one nested community.'}), 403

            # If creating a sub-community, enforce premium-only for creators as well
            # (Already enforced above for community creation, but keep guard explicit)
            placeholders = ', '.join([get_sql_placeholder()] * 14)
            c.execute(f"""
                INSERT INTO communities (name, type, creator_username, join_code, created_at, description, location, background_path, template, background_color, text_color, accent_color, card_color, parent_community_id)
                VALUES ({placeholders})
            """, (name, normalized_type, username, join_code, datetime.now().strftime('%m.%d.%y %H:%M'), description, location, background_path, template, background_color, text_color, accent_color, card_color, parent_id_int))
            
            community_id = c.lastrowid
            
            # Get user's ID and add creator as owner
            c.execute(f"SELECT id FROM users WHERE username = {get_sql_placeholder()}", (username,))
            user_row = c.fetchone()
            if user_row:
                user_id = user_row[0] if not hasattr(user_row, 'keys') else user_row['id']
                try:
                    add_user_to_community(c, user_id, community_id, role='owner')
                except CommunityMembershipLimitError as limit_err:
                    conn.rollback()
                    return jsonify({'success': False, 'error': str(limit_err)}), 403
            
            # Ensure admin is also a member of every community
            c.execute("SELECT id FROM users WHERE username = 'admin'")
            admin_row = c.fetchone()
            if admin_row:
                admin_id = admin_row['id'] if hasattr(admin_row, 'keys') else admin_row[0]
                c.execute(f"SELECT 1 FROM user_communities WHERE user_id={get_sql_placeholder()} AND community_id={get_sql_placeholder()}", (admin_id, community_id))
                if not c.fetchone():
                    try:
                        add_user_to_community(c, admin_id, community_id, role=None)
                    except CommunityMembershipLimitError as limit_err:
                        conn.rollback()
                        return jsonify({'success': False, 'error': str(limit_err)}), 403
            
            conn.commit()
            
            return jsonify({
                'success': True, 
                'community_id': community_id,
                'message': f'Community "{name}" created successfully!'
            })
            
    except Exception as e:
        logger.error(f"Error creating community: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'success': False, 'error': f'Failed to create community: {str(e)}'}), 500
    except Exception as outer_err:
        logger.error(f"Outer error in create_community: {outer_err}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'success': False, 'error': f'Server error: {str(outer_err)}'}), 500
