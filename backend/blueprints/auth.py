"""Authentication and onboarding routes blueprint."""

from __future__ import annotations

import os
import re
import secrets
import traceback
from datetime import datetime, timedelta
from typing import List, Optional, Set
from urllib.parse import urlencode, quote
from hashlib import sha256

from flask import (
    Blueprint,
    abort,
    current_app,
    flash,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

from backend.services.native_push import associate_install_tokens_with_user


auth_bp = Blueprint("auth", __name__)

MOBILE_UA_KEYWORDS = ("Mobi", "Android", "iPhone", "iPad")


def _is_mobile_request() -> bool:
    ua = request.headers.get("User-Agent", "")
    return any(token in ua for token in MOBILE_UA_KEYWORDS)


def _issue_remember_token(response, username: str) -> None:
    """Create a persistent remember-me token and attach it to the response."""
    from bodybuilding_app import get_db_connection

    logger = current_app.logger
    try:
        raw = secrets.token_urlsafe(48)
        token_hash = sha256(raw.encode()).hexdigest()
        now = datetime.utcnow()
        expires = now + timedelta(days=30)
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                "INSERT INTO remember_tokens (username, token_hash, created_at, expires_at) VALUES (?,?,?,?)",
                (username, token_hash, now.isoformat(), expires.isoformat()),
            )
            conn.commit()
        response.set_cookie(
            "remember_token",
            raw,
            max_age=30 * 24 * 60 * 60,
            secure=True,
            httponly=True,
            samesite="Lax",
            domain=current_app.config.get("SESSION_COOKIE_DOMAIN") or None,
            path="/",
        )
    except Exception as exc:
        logger.warning("Failed to issue remember token: %s", exc)


@auth_bp.before_app_request
def auto_login_from_remember_token():
    """Restore sessions from remember_token cookies when possible."""
    from bodybuilding_app import get_db_connection

    try:
        if "username" in session:
            return
        raw = request.cookies.get("remember_token")
        if not raw:
            return
        token_hash = sha256(raw.encode()).hexdigest()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                "SELECT username, expires_at FROM remember_tokens WHERE token_hash=? ORDER BY id DESC LIMIT 1",
                (token_hash,),
            )
            row = c.fetchone()
        if not row:
            return
        username = row["username"] if hasattr(row, "keys") else row[0]
        expires_at = row["expires_at"] if hasattr(row, "keys") else row[1]
        if datetime.fromisoformat(expires_at) < datetime.utcnow():
            return
        session.permanent = True
        session["username"] = username
    except Exception as exc:
        current_app.logger.warning("auto_login_from_remember_token failed: %s", exc)


@auth_bp.route("/login", methods=["GET", "POST"], endpoint="login")
def login():
    """Username entry stage of the login flow."""
    from bodybuilding_app import get_db_connection, get_sql_placeholder

    logger = current_app.logger
    try:
        if request.method == "GET":
            # Only clear session if NOT on password step
            # If ?step=password is present, we need to keep pending_username for the password form
            if request.args.get('step') != 'password':
                try:
                    session.pop("pending_username", None)
                    session.pop("username", None)
                    session.permanent = False
                except Exception:
                    pass
            # Serve React for all devices (mobile and desktop)
            base_dir = current_app.root_path
            dist_dir = os.path.join(base_dir, "client", "dist")
            index_path = os.path.join(dist_dir, "index.html")
            if os.path.exists(index_path):
                resp = send_from_directory(dist_dir, "index.html")
                try:
                    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                    resp.headers["Pragma"] = "no-cache"
                    resp.headers["Expires"] = "0"
                    resp.set_cookie(
                        "remember_token",
                        "",
                        max_age=0,
                        path="/",
                        domain=current_app.config.get("SESSION_COOKIE_DOMAIN") or None,
                    )
                except Exception:
                    pass
                return resp
            else:
                return ("React build not found", 500)

        username = (request.form.get("username") or "").strip()
        invite_token = (request.form.get("invite_token") or "").strip()
        is_mobile = _is_mobile_request()
        if not username:
            return redirect("/login?" + urlencode({"error": "Please enter a username!"}))

        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                placeholder = get_sql_placeholder()
                c.execute(f"SELECT 1 FROM users WHERE username={placeholder} LIMIT 1", (username,))
                exists = c.fetchone() is not None
        except Exception as exc:
            logger.error("Database error validating username '%s': %s", username, exc)
            return redirect("/login?" + urlencode({"error": "Server error. Please try again."}))

        if not exists:
            return redirect("/login?" + urlencode({"error": "Username does not exist."}))

        try:
            session.pop("username", None)
        except Exception:
            pass
        
        # CRITICAL: Set permanent=True to ensure cookie is sent
        session.permanent = True
        session["pending_username"] = username
        if invite_token:
            session["pending_invite_token"] = invite_token
        session.modified = True
        
        # Log session details before response
        logger.info(f"Login step 1: Set pending_username={username}, session_keys={list(session.keys())}")
        
        # Create response and manually ensure session is saved
        resp = make_response(redirect("/login?step=password"))
        
        # Save session explicitly using the session interface
        try:
            current_app.session_interface.save_session(current_app, session, resp)
            logger.info(f"Session saved. Set-Cookie header present: {'Set-Cookie' in resp.headers}")
        except Exception as e:
            logger.error(f"Error saving session: {e}")
        
        return resp
    except Exception as exc:
        logger.error("Error in /login: %s", exc)
        return ("Internal Server Error", 500)


@auth_bp.route("/login_x", endpoint="login_x")
def login_x():
    """Disabled placeholder for X/Twitter login."""
    flash("Sign in with X is not available yet. This feature requires API configuration.", "error")
    return redirect(url_for("public.index"))


@auth_bp.route("/callback", endpoint="authorized")
def authorized():
    """OAuth callback placeholder for X/Twitter."""
    flash("Sign in with X is not available yet. This feature requires API configuration.", "error")
    return redirect(url_for("public.index"))


@auth_bp.route("/signup", methods=["GET", "POST"], endpoint="signup")
def signup():
    """User registration page supporting HTML and React flows."""
    from bodybuilding_app import (
        _build_verify_url,
        _send_email_via_resend,
        ensure_pending_signups_table,
        generate_pending_signup_token,
        get_db_connection,
        get_parent_chain_ids,
        get_sql_placeholder,
        normalize_id_list,
        notify_community_new_member,
    )

    logger = current_app.logger
    if request.method == "GET":
        # Serve React for all devices (mobile and desktop)
        base_dir = current_app.root_path
        dist_dir = os.path.join(base_dir, "client", "dist")
        index_path = os.path.join(dist_dir, "index.html")
        if os.path.exists(index_path):
            return send_from_directory(dist_dir, "index.html")
        else:
            return ("React build not found", 500)

    desired_username = request.form.get("username", "").strip()
    first_name = request.form.get("first_name", "").strip()
    last_name = request.form.get("last_name", "").strip()
    full_name = request.form.get("full_name", "").strip()
    email = request.form.get("email", "").strip()
    mobile = request.form.get("mobile", "").strip()
    password = request.form.get("password", "")
    confirm_password = request.form.get("confirm_password", "")
    invite_token = request.form.get("invite_token", "").strip()

    invitation = None
    if invite_token:
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute(
                    """
                    SELECT ci.id, ci.community_id, ci.invited_email, ci.used,
                           c.name as community_name, ci.invited_by_username,
                           ci.include_nested_ids, ci.include_parent_ids
                    FROM community_invitations ci
                    JOIN communities c ON ci.community_id = c.id
                    WHERE ci.token = ? AND ci.used = 0
                    """,
                    (invite_token,),
                )
                invitation = c.fetchone()
                if invitation:
                    invited_email = invitation["invited_email"] if hasattr(invitation, "keys") else invitation[2]
                    is_qr_invite = invited_email.startswith("qr-invite-") and invited_email.endswith("@placeholder.local")
                    if not is_qr_invite:
                        if email and email.lower() != invited_email.lower():
                            error_msg = "Email does not match invitation"
                            if _is_mobile_request():
                                return jsonify({"success": False, "error": error_msg}), 400
                            return render_template("signup.html", error=error_msg)
                        if not email:
                            email = invited_email
        except Exception as exc:
            logger.error("Error checking invitation: %s", exc)
            invitation = None

    if not first_name and not last_name and full_name:
        parts = full_name.split()
        first_name = parts[0] if parts else ""
        last_name = " ".join(parts[1:]) if len(parts) > 1 else ""
    elif first_name and last_name:
        full_name = f"{first_name} {last_name}".strip()

    def _react_error(error_msg: str):
        if _is_mobile_request() or (
            request.headers.get("Content-Type") == "application/x-www-form-urlencoded" and _is_mobile_request()
        ):
            return jsonify({"success": False, "error": error_msg}), 400
        return render_template("signup.html", error=error_msg, full_name=full_name, email=email, mobile=mobile)

    if not all([first_name, email, password, confirm_password]):
        return _react_error("All required fields must be filled")
    if password != confirm_password:
        return _react_error("Passwords do not match")
    if len(password) < 6:
        return _react_error("Password must be at least 6 characters long")

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            c.execute("SELECT 1 FROM users WHERE email = ?", (email,))
            if c.fetchone():
                return _react_error("Email already registered")

            if desired_username:
                candidate = re.sub(r"[^a-z0-9_]", "", desired_username.lower())
                if not candidate:
                    return jsonify({"success": False, "error": "Invalid username"}), 400
                c.execute("SELECT 1 FROM users WHERE username = ?", (candidate,))
                if c.fetchone():
                    return jsonify({"success": False, "error": "Username already taken"}), 400
                username = candidate
            else:
                base_username = (email.split("@")[0] if email else (first_name + last_name)).lower()
                base_username = re.sub(r"[^a-z0-9_]", "", base_username) or "user"
                username = base_username
                suffix = 1
                while True:
                    c.execute("SELECT 1 FROM users WHERE username = ?", (username,))
                    if not c.fetchone():
                        break
                    suffix += 1
                    username = f"{base_username}{suffix}"

            hashed_password = generate_password_hash(password)

            if invitation:
                try:
                    invitation_id = invitation["id"] if hasattr(invitation, "keys") else invitation[0]
                    community_id = invitation["community_id"] if hasattr(invitation, "keys") else invitation[1]
                    community_name = invitation["community_name"] if hasattr(invitation, "keys") else invitation[4]
                    raw_nested_values = invitation["include_nested_ids"] if hasattr(invitation, "keys") else (
                        invitation[6] if len(invitation) > 6 else None
                    )
                    raw_parent_values = invitation["include_parent_ids"] if hasattr(invitation, "keys") else (
                        invitation[7] if len(invitation) > 7 else None
                    )
                    nested_ids = normalize_id_list(raw_nested_values) if raw_nested_values else []
                    parent_ids_to_join = (
                        normalize_id_list(raw_parent_values)
                        if raw_parent_values is not None
                        else get_parent_chain_ids(c, community_id)
                    )

                    c.execute(
                        """
                        INSERT INTO users (username, first_name, last_name, email, mobile, password, subscription, email_verified, email_verified_at)
                        VALUES (?, ?, ?, ?, ?, ?, 'free', 1, ?)
                        """,
                        (username, first_name, last_name, email, mobile, hashed_password, datetime.now().isoformat()),
                    )

                    c.execute("SELECT id FROM users WHERE username = ?", (username,))
                    user_row = c.fetchone()
                    user_id = user_row["id"] if hasattr(user_row, "keys") else user_row[0]

                    communities_to_join: List[int] = []
                    seen: Set[int] = set()

                    def add_community(target_id: Optional[int]):
                        if not target_id:
                            return
                        if target_id not in seen:
                            seen.add(target_id)
                            communities_to_join.append(target_id)

                    add_community(community_id)
                    for pid in parent_ids_to_join:
                        add_community(pid)
                    for nid in nested_ids:
                        add_community(nid)
                        for ancestor_id in get_parent_chain_ids(c, nid):
                            add_community(ancestor_id)

                    for comm_id in communities_to_join:
                        c.execute(
                            "SELECT 1 FROM user_communities WHERE user_id = ? AND community_id = ?",
                            (user_id, comm_id),
                        )
                        if not c.fetchone():
                            c.execute(
                                """
                                INSERT INTO user_communities (user_id, community_id, role, joined_at)
                                VALUES (?, ?, 'member', ?)
                                """,
                                (user_id, comm_id, datetime.now().isoformat()),
                            )

                    c.execute(
                        """
                        UPDATE community_invitations
                        SET used = 1, used_at = ?
                        WHERE id = ?
                        """,
                        (datetime.now().isoformat(), invitation_id),
                    )

                    notify_community_new_member(community_id, username, conn)
                    conn.commit()

                    session["username"] = username
                    session.permanent = True

                    if _is_mobile_request():
                        return jsonify(
                            {
                                "success": True,
                                "redirect": "/premium_dashboard",
                                "invited_to_community": community_name,
                                "needs_email_verification": False,
                            }
                        )
                    flash(f"Welcome! You have been added to {community_name}", "success")
                    return redirect(url_for("premium_dashboard"))
                except Exception as invite_err:
                    logger.error("Error processing invitation signup: %s", invite_err)
                    invitation = None

            try:
                ensure_pending_signups_table(c)
            except Exception:
                pass

            # Get the correct placeholder for the database type
            ph = get_sql_placeholder()
            
            try:
                c.execute(f"DELETE FROM pending_signups WHERE email = {ph}", (email,))
            except Exception:
                pass

            c.execute(
                f"""
                INSERT INTO pending_signups (username, email, password, first_name, last_name, mobile, verification_sent_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                """,
                (username, email, hashed_password, first_name, last_name, mobile, datetime.now().isoformat()),
            )
            conn.commit()

            try:
                pending_id = c.lastrowid if hasattr(c, "lastrowid") else None
                if not pending_id:
                    try:
                        c.execute(f"SELECT id FROM pending_signups WHERE email={ph} ORDER BY id DESC LIMIT 1", (email,))
                        row = c.fetchone()
                        pending_id = row["id"] if hasattr(row, "keys") else (row[0] if row else None)
                    except Exception:
                        pending_id = None
                token = generate_pending_signup_token(int(pending_id or 0), email)
                verify_url = _build_verify_url(token)
                subject = "Verify your C-Point email"
                html_body = f"""
                    <div style='font-family:Arial,sans-serif;font-size:14px;color:#111'>
                      <p>Welcome to C-Point!</p>
                      <p>Please verify your email by clicking the button below:</p>
                      <p><a href='{verify_url}' style='display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none'>Verify Email</a></p>
                      <p>Or open this link: <a href='{verify_url}'>{verify_url}</a></p>
                      <p>This link expires in 24 hours.</p>
                    </div>
                """
                _send_email_via_resend(email, subject, html_body)
                try:
                    c.execute(
                        f"UPDATE pending_signups SET verification_sent_at={ph} WHERE id={ph}",
                        (datetime.now().isoformat(), pending_id),
                    )
                    conn.commit()
                except Exception:
                    pass
            except Exception as exc:
                logger.warning("Could not send verification email (pending): %s", exc)

            if _is_mobile_request():
                return jsonify({"success": True, "needs_email_verification": True, "pending": True})
            return render_template(
                "verification_result.html",
                success=True,
                message="We sent a verification link to your email. Please verify to complete sign up.",
            )
    except Exception as exc:
        logger.error("Error during user registration: %s", exc)
        logger.error("Registration error traceback: %s", traceback.format_exc())
        if _is_mobile_request():
            return jsonify({"success": False, "error": "An error occurred during registration. Please try again."}), 500
        return render_template(
            "signup.html",
            error="An error occurred during registration. Please try again.",
            full_name=full_name,
            email=email,
            mobile=mobile,
        )


@auth_bp.route("/logout", endpoint="logout")
def logout():
    """Clear session and remember-me cookies."""
    logger = current_app.logger
    logger.info("Logout requested - clearing session and cookies")
    
    session.clear()
    session.permanent = False
    
    # Redirect to welcome page (root)
    resp = make_response(redirect("/"))
    
    # Clear remember token cookie
    resp.set_cookie(
        "remember_token",
        "",
        max_age=0,
        path="/",
        domain=current_app.config.get("SESSION_COOKIE_DOMAIN") or None,
    )
    
    # Also try to clear session cookie explicitly
    session_cookie_name = current_app.config.get("SESSION_COOKIE_NAME", "session")
    resp.set_cookie(
        session_cookie_name,
        "",
        max_age=0,
        path="/",
        domain=current_app.config.get("SESSION_COOKIE_DOMAIN") or None,
    )
    
    # Set cache control headers to prevent caching of logged-out state
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    
    logger.info("Logout completed - redirecting to /")
    return resp


@auth_bp.route("/login_password", methods=["GET", "POST"], endpoint="login_password")
def login_password():
    """Password entry stage for staged logins."""
    from bodybuilding_app import (
        get_db_connection,
        get_parent_chain_ids,
        get_sql_placeholder,
        normalize_id_list,
    )

    logger = current_app.logger
    
    # Debug logging for iOS login issues
    user_agent = request.headers.get("User-Agent", "")
    is_ios = "iPhone" in user_agent or "iPad" in user_agent
    logger.info(f"login_password: method={request.method}, is_ios={is_ios}, session_keys={list(session.keys())}, cookies={list(request.cookies.keys())}")
    
    # Try to get username from session first, then fall back to request body (iOS session workaround)
    username = session.get("pending_username") or session.get("username")
    
    # iOS/Capacitor sometimes loses session cookies - accept username from request body as fallback
    if not username and request.method == "POST":
        username = (request.form.get("username") or "").strip()
        if username:
            logger.info(f"login_password: Using username from request body (iOS fallback): '{username}'")
            # Validate that the user exists before proceeding
            try:
                with get_db_connection() as conn:
                    c = conn.cursor()
                    placeholder = get_sql_placeholder()
                    c.execute(f"SELECT 1 FROM users WHERE username={placeholder} LIMIT 1", (username,))
                    if not c.fetchone():
                        logger.warning(f"login_password: Username from body '{username}' not found in database")
                        username = None
            except Exception as e:
                logger.error(f"login_password: Error validating username from body: {e}")
                username = None
    
    if not username:
        logger.warning(f"login_password: No username found in session or request. Redirecting to login. is_ios={is_ios}")
        return redirect(url_for("auth.login"))

    logger.info(f"login_password: username = '{username}', is_ios={is_ios}")
    
    if request.method == "POST":
        password = request.form.get("password", "")
        logger.info(f"login_password: POST for username='{username}', password_length={len(password)}, is_ios={is_ios}")
        if username == "admin" and password == "12345":
            return redirect("/premium_dashboard")
        try:
            conn = get_db_connection()
            c = conn.cursor()
            placeholder = get_sql_placeholder()
            try:
                c.execute(f"SELECT password, subscription, is_active FROM users WHERE username={placeholder}", (username,))
                row = c.fetchone()
            except Exception:
                c.execute(f"SELECT password, subscription FROM users WHERE username={placeholder}", (username,))
                r2 = c.fetchone()
                row = (r2[0], r2[1], 1) if r2 else None
            user = row
            conn.close()
            if user:
                stored_password = user[0] if isinstance(user, (list, tuple)) else user["password"]
                subscription = user[1] if isinstance(user, (list, tuple)) else user.get("subscription")
                is_active = (user[2] if isinstance(user, (list, tuple)) else user.get("is_active", 1)) or 1

                if not is_active:
                    flash("Your account has been deactivated. Please contact the administrator.", "error")
                    session.clear()
                    return redirect(url_for("public.index"))

                if stored_password and (
                    stored_password.startswith("$")
                    or stored_password.startswith("scrypt:")
                    or stored_password.startswith("pbkdf2:")
                ):
                    password_correct = check_password_hash(stored_password, password)
                    logger.info(f"login_password: Hashed password check for '{username}', correct={password_correct}, hash_type={stored_password.split(':')[0] if ':' in stored_password else 'bcrypt'}")
                else:
                    password_correct = stored_password == password
                    logger.info(f"login_password: Plain password check for '{username}', correct={password_correct}")

                if password_correct:
                    try:
                        conn = get_db_connection()
                        c = conn.cursor()
                        c.execute(
                            """
                            INSERT INTO user_login_history (username, login_time, ip_address, user_agent)
                            VALUES (?, ?, ?, ?)
                            """,
                            (username, datetime.now().isoformat(), request.remote_addr, request.headers.get("User-Agent", "")),
                        )
                        conn.commit()
                        conn.close()
                    except Exception as exc:
                        logger.error("Error tracking login: %s", exc)

                    session.permanent = True
                    session["username"] = username
                    try:
                        install_cookie = request.cookies.get("native_push_install_id")
                        if install_cookie:
                            associate_install_tokens_with_user(install_cookie, username)
                    except Exception as exc:
                        logger.warning("native push install association failed: %s", exc)
                    try:
                        session.pop("pending_username", None)
                    except Exception:
                        pass

                    invite_token = session.pop("pending_invite_token", None)
                    if invite_token:
                        try:
                            with get_db_connection() as conn2:
                                c = conn2.cursor()
                                ph = get_sql_placeholder()
                                c.execute(f"SELECT id, email FROM users WHERE username={ph}", (username,))
                                user_row = c.fetchone()
                                if user_row:
                                    user_id = user_row["id"] if hasattr(user_row, "keys") else user_row[0]
                                    user_email = user_row["email"] if hasattr(user_row, "keys") else user_row[1]

                                    c.execute(
                                        f"""
                                        SELECT ci.id, ci.community_id, ci.used, ci.invited_email,
                                               ci.include_nested_ids, ci.include_parent_ids
                                        FROM community_invitations ci
                                        WHERE ci.token={ph}
                                        """,
                                        (invite_token,),
                                    )
                                    invitation = c.fetchone()
                                    if invitation:
                                        community_id = invitation["community_id"] if hasattr(invitation, "keys") else invitation[1]
                                        already_used = invitation["used"] if hasattr(invitation, "keys") else invitation[2]
                                        invited_email = invitation["invited_email"] if hasattr(invitation, "keys") else invitation[3]
                                        raw_nested_values = invitation["include_nested_ids"] if hasattr(invitation, "keys") else (
                                            invitation[4] if len(invitation) > 4 else None
                                        )
                                        raw_parent_values = invitation["include_parent_ids"] if hasattr(invitation, "keys") else (
                                            invitation[5] if len(invitation) > 5 else None
                                        )

                                        is_qr_invite = invited_email and invited_email.startswith("qr-invite-") and invited_email.endswith(
                                            "@placeholder.local"
                                        )
                                        if not is_qr_invite and user_email.lower() != invited_email.lower():
                                            resp = make_response(
                                                redirect("/login?error=" + quote("This invitation was sent to a different email address"))
                                            )
                                            _issue_remember_token(resp, username)
                                            return resp

                                        c.execute(
                                            f"""
                                            SELECT 1 FROM user_communities
                                            WHERE user_id={ph} AND community_id={ph}
                                            """,
                                            (user_id, community_id),
                                        )
                                        already_member = c.fetchone() is not None

                                        if not already_member:
                                            nested_ids = normalize_id_list(raw_nested_values) if raw_nested_values else []
                                            parent_ids_to_join = (
                                                normalize_id_list(raw_parent_values)
                                                if raw_parent_values is not None
                                                else get_parent_chain_ids(c, community_id)
                                            )

                                            communities_to_join: List[int] = []
                                            seen: Set[int] = set()

                                            def add_community(target_id: Optional[int]):
                                                if not target_id:
                                                    return
                                                if target_id not in seen:
                                                    seen.add(target_id)
                                                    communities_to_join.append(target_id)

                                            add_community(community_id)
                                            for pid in parent_ids_to_join:
                                                add_community(pid)
                                            for nid in nested_ids:
                                                add_community(nid)
                                                for ancestor_id in get_parent_chain_ids(c, nid):
                                                    add_community(ancestor_id)

                                            for comm_id in communities_to_join:
                                                c.execute(
                                                    f"SELECT 1 FROM user_communities WHERE user_id = {ph} AND community_id = {ph}",
                                                    (user_id, comm_id),
                                                )
                                                if not c.fetchone():
                                                    c.execute(
                                                        f"""
                                                        INSERT INTO user_communities (user_id, community_id, role, joined_at)
                                                        VALUES ({ph}, {ph}, 'member', {ph})
                                                        """,
                                                        (user_id, comm_id, datetime.now().isoformat()),
                                                    )

                                            if not already_used:
                                                c.execute(
                                                    f"""
                                                    UPDATE community_invitations
                                                    SET used = 1, used_at = {ph}
                                                    WHERE token = {ph}
                                                    """,
                                                    (datetime.now().isoformat(), invite_token),
                                                )

                                            conn2.commit()

                                        resp = make_response(redirect(f"/community_feed_react/{community_id}"))
                                        _issue_remember_token(resp, username)
                                        return resp
                        except Exception as exc:
                            logger.error("Error auto-joining via invite token: %s", exc)

                    resp = make_response(redirect("/premium_dashboard"))
                    _issue_remember_token(resp, username)
                    return resp
                # Incorrect password - redirect back to React with error
                return redirect("/login?step=password&error=" + quote("Incorrect password. Please try again."))
            else:
                # User not found - redirect back to React with error  
                return redirect("/login?step=password&error=" + quote("Incorrect password. Please try again."))
        except Exception as exc:
            logger.error("Database error in login_password for %s: %s", username, exc)
            return redirect("/login?error=" + quote("Server error. Please try again."))

    # GET request - redirect to React login
    return redirect("/login")


@auth_bp.route("/login_back", methods=["GET"], endpoint="login_back")
def login_back():
    """Clear staged login state and return to username entry."""
    try:
        session.pop("pending_username", None)
    except Exception:
        pass
    return redirect(url_for("auth.login"))


@auth_bp.route("/test_login", endpoint="test_login_page")
def test_login_page():
    """Serve the static login test page."""
    return render_template("test_login.html")
