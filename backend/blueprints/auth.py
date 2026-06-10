"""Authentication and onboarding routes blueprint."""

from __future__ import annotations

import os
import re
import secrets
import traceback
from datetime import datetime
from functools import wraps
from typing import Any
from urllib.parse import urlencode, quote

from flask import (
    Blueprint,
    abort,
    current_app,
    g,
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

from backend.services.native_push import (
    associate_fcm_tokens_for_install,
    associate_install_tokens_with_user,
    deactivate_all_push_for_user,
    deactivate_for_install,
)
from backend.services import auth_session, disposable_email, remember_tokens, session_identity
from backend.services import api_errors
from backend.services import template_i18n
from backend.services import session_revocation
from backend.services.account_deletion import AccountDeletionMode, delete_user_in_connection
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.email_normalization import (
    canonicalize_with_policy,
    is_well_formed as _email_is_well_formed,
)
from backend.services.oauth_email_verification import (
    apply_oauth_email_verified,
    first_oauth_verified_at_iso,
)


auth_bp = Blueprint("auth", __name__)

MOBILE_UA_KEYWORDS = ("Mobi", "Android", "iPhone", "iPad")


def _session_required_api(view_func):
    """Require a logged-in session for JSON API handlers (no monolith import cycle)."""

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return api_errors.auth_required()
        return view_func(*args, **kwargs)

    return wrapper


def _apply_login_persistence(resp, username: str) -> int:
    """Revoke any prior remember-me row for this browser, then issue a fresh token + install id."""
    stale = remember_tokens.revoke_by_cookie(request)
    remember_tokens.issue(resp, username)
    auth_session.set_install_cookie(resp, secrets.token_urlsafe(24))
    return stale


def _finalize_session_response(resp, username: str) -> None:
    """Persist Flask session + remember-me on an auth redirect (Capacitor/fetch-safe).

    After a FLASK_SECRET_KEY rotation or SESSION_COOKIE_DOMAIN change, browsers may
    still send an old ``cpoint_session`` cookie that decodes to an empty session.
    Clear it explicitly, then save the new signed session on this response.
    """
    auth_session.clear_session_cookie(resp)
    session.permanent = True
    session["username"] = username
    session_revocation.stamp_session(session, username)
    session.modified = True
    try:
        current_app.session_interface.save_session(current_app, session, resp)
    except Exception as exc:
        current_app.logger.error("save_session failed for %s: %s", username, exc)
    _apply_login_persistence(resp, username)
    auth_session.no_store(resp)


def _invalidate_profile_and_dashboard_caches(username: str) -> None:
    """Bust Redis profile/dashboard payloads so the next API read matches MySQL."""
    if not username:
        return
    try:
        from redis_cache import cache, invalidate_user_parent_dashboard

        cache.delete(f"profile:{username}")
        invalidate_user_parent_dashboard(username)
    except Exception:
        pass


def _is_mobile_request() -> bool:
    ua = request.headers.get("User-Agent", "")
    return any(token in ua for token in MOBILE_UA_KEYWORDS)


@auth_bp.before_app_request
def auto_login_from_remember_token():
    """Restore sessions from remember_token cookies when possible."""
    try:
        if "username" in session:
            if session_revocation.is_session_revoked(session):
                session.clear()
            else:
                return
        if "pending_username" in session:
            current_app.logger.info("auth.auto_login_skipped reason=pending_username")
            return
        token_hash = remember_tokens.cookie_hash(request)
        username = remember_tokens.restore_session(request, session)
        if not username or not token_hash:
            return
        g.remember_token_rotation_username = username
        g.remember_token_rotation_old_hash = token_hash
        # Audit signal so post-deploy monitoring can detect anomalous remember-me restoration
        # (e.g. cookie used from a new IP after logout). Required by the May-2026 logout hotfix.
        try:
            ua = (request.headers.get("User-Agent") or "-")[:120]
            current_app.logger.info(
                "auth.remember_me_restore username=%s ip=%s ua=%s endpoint=%s",
                username,
                request.remote_addr or "-",
                ua,
                request.endpoint or "-",
            )
        except Exception:
            pass
    except Exception as exc:
        current_app.logger.warning("auto_login_from_remember_token failed: %s", exc)


@auth_bp.after_app_request
def rotate_remember_token_after_auto_login(response):
    """Refresh remember-token cookies after silent session restoration."""
    # Never rotate on the logout endpoint itself: previously this hook re-issued a fresh
    # remember_token on the /logout response, undoing the revocation in the same response
    # and silently keeping the user signed in on Capacitor (RC-1 in
    # docs/audit/LOGOUT_REMEDIATION_PLAN.md).
    if (
        getattr(g, "skip_remember_rotation", False)
        or request.endpoint == "auth.logout"
        or request.path == "/logout"
    ):
        return response

    username = getattr(g, "remember_token_rotation_username", None)
    old_hash = getattr(g, "remember_token_rotation_old_hash", None)
    if not username or not old_hash:
        return response

    try:
        remember_tokens.revoke_by_token_hash(old_hash)
    except Exception as exc:
        current_app.logger.warning("Failed deleting old remember token for %s: %s", username, exc)

    try:
        remember_tokens.issue(response, username)
        auth_session.set_install_cookie(response, secrets.token_urlsafe(24))
    except Exception as exc:
        current_app.logger.warning("Failed rotating remember token for %s: %s", username, exc)
        return response
    return response


@auth_bp.route("/login", methods=["GET", "POST"], endpoint="login")
def login():
    """Username entry stage of the login flow."""
    logger = current_app.logger
    try:
        if request.method == "GET":
            if "username" in session and request.args.get('step') != 'password':
                return redirect("/premium_dashboard")
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


@auth_bp.route("/signup", methods=["GET", "POST"], endpoint="signup")
def signup():
    """User registration page supporting HTML and React flows."""
    from bodybuilding_app import (
        _build_verify_url,
        _send_email_via_resend,
        ensure_pending_signups_table,
        generate_pending_signup_token,
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
                            if _is_mobile_request():
                                return api_errors.error_response(
                                    "auth.signup.email_does_not_match_invitation", 400
                                )
                            error_msg = "Email does not match invitation"
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

    def _react_error(key: str, *, fallback_text: str):
        """Return an i18n error for mobile clients, HTML for desktop browsers.

        ``key`` is the i18n key used for mobile JSON; ``fallback_text`` is
        the English string rendered into the HTML signup template (which
        still expects raw text) until that template is migrated.
        """
        if _is_mobile_request() or (
            request.headers.get("Content-Type") == "application/x-www-form-urlencoded" and _is_mobile_request()
        ):
            return api_errors.error_response(key, 400)
        return render_template(
            "signup.html",
            error=fallback_text,
            full_name=full_name,
            email=email,
            mobile=mobile,
        )

    if not all([first_name, email, password, confirm_password]):
        return _react_error(
            "auth.signup.missing_required_fields",
            fallback_text="All required fields must be filled",
        )
    if password != confirm_password:
        return _react_error(
            "auth.signup.passwords_do_not_match",
            fallback_text="Passwords do not match",
        )
    if len(password) < 6:
        return _react_error(
            "auth.signup.password_too_short",
            fallback_text="Password must be at least 6 characters long",
        )
    if not _email_is_well_formed(email):
        return _react_error(
            "auth.signup.invalid_email",
            fallback_text="Please enter a valid email address",
        )
    if disposable_email.should_block(email):
        logger.info("Blocked signup from disposable domain: %s", email)
        return _react_error(
            "auth.signup.disposable_email_blocked",
            fallback_text=(
                "This email provider isn't supported. Please use a permanent "
                "email address (not a disposable / temporary one)."
            ),
        )
    canonical = canonicalize_with_policy(email)

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            # Uniqueness is enforced on canonical_email (post-
            # normalization form). We OR with raw email to catch rows
            # created before the canonical_email column existed — they
            # still have NULL there but their raw email collides.
            c.execute(
                "SELECT 1 FROM users WHERE canonical_email = ? OR email = ?",
                (canonical, email),
            )
            if c.fetchone():
                return _react_error(
                    "auth.signup.email_already_registered",
                    fallback_text="Email already registered",
                )

            if desired_username:
                candidate = re.sub(r"[^a-z0-9_]", "", desired_username.lower())
                if not candidate:
                    return api_errors.error_response("auth.signup.invalid_username", 400)
                c.execute("SELECT 1 FROM users WHERE username = ?", (candidate,))
                if c.fetchone():
                    return api_errors.error_response("auth.signup.username_taken", 400)
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
            _tpl = template_i18n.template_ctx()
            return render_template(
                "verification_result.html",
                success=True,
                message=template_i18n.localize_verification_message(
                    "We sent a verification link to your email. Please verify to complete sign up.",
                    _tpl["locale"],
                ),
                **_tpl,
            )
    except Exception as exc:
        logger.error("Error during user registration: %s", exc)
        logger.error("Registration error traceback: %s", traceback.format_exc())
        if _is_mobile_request():
            return api_errors.error_response("auth.signup.registration_failed", 500)
        return render_template(
            "signup.html",
            error="An error occurred during registration. Please try again.",
            full_name=full_name,
            email=email,
            mobile=mobile,
        )


@auth_bp.route("/logout", endpoint="logout")
def logout():
    """Clear session and remember-me cookies on every device the user is signed in on."""
    # Belt-and-suspenders: also short-circuits the after-request rotation hook in case
    # request.endpoint is somehow unset by the time it runs.
    g.skip_remember_rotation = True

    logger = current_app.logger
    username = session.get("username")
    install_id = (request.cookies.get(auth_session.INSTALL_COOKIE_NAME) or "").strip()
    push_counts = deactivate_all_push_for_user(username) if username else {
        "native_push_tokens": 0,
        "fcm_tokens": 0,
        "push_subscriptions": 0,
    }
    if install_id:
        install_counts = deactivate_for_install(install_id)
        for key in ("native_push_tokens", "fcm_tokens"):
            push_counts[key] = max(push_counts.get(key, 0), install_counts.get(key, 0))
    tokens_revoked = remember_tokens.revoke_by_cookie(request)
    # Revoke every remember-me row for this user so logout ends the session on all
    # of their devices, not just this one. Banking-grade default; matches the
    # explicit copy in the LogoutPromptProvider modal.
    user_tokens_revoked = remember_tokens.revoke_for_user(username) if username else 0
    # Bump session_version so signed cookies on other devices are invalidated on next request.
    session_revocation.bump_session_version(username)

    session.clear()
    session.permanent = False

    resp = make_response(redirect("/welcome"))
    remember_tokens.clear_cookie(resp)
    auth_session.clear_session_cookie(resp)
    auth_session.clear_install_cookie(resp)

    if username:
        try:
            from redis_cache import invalidate_user_cache

            invalidate_user_cache(username)
        except Exception as exc:
            logger.warning("auth.logout cache invalidation failed: %s", exc)

    current_app.session_interface.save_session(current_app, session, resp)
    auth_session.no_store(resp)
    logger.info(
        "auth.logout pre_username=%s tokens_revoked=%d user_tokens_revoked=%d push_native=%d push_fcm=%d push_web=%d",
        username or "-",
        tokens_revoked,
        user_tokens_revoked,
        push_counts.get("native_push_tokens", 0),
        push_counts.get("fcm_tokens", 0),
        push_counts.get("push_subscriptions", 0),
    )
    return resp


@auth_bp.route("/delete_account", methods=["POST"])
@_session_required_api
def delete_account_post():
    """Permanently delete the current user's account (FK-safe).

    Immediate self-service deletion. Underage users who only scheduled purge via
    ``POST /api/me/age-confirmation`` with ``confirmed: false`` remain until cron;
    this endpoint still deletes immediately when the user explicitly requests it.
    """
    logger = current_app.logger
    username = session.get("username")
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    logger.info("Starting account deletion for user: %s", username)
    try:
        with get_db_connection() as conn:
            former = delete_user_in_connection(conn, username, AccountDeletionMode.SELF_SERVICE)
            conn.commit()
        logger.info("Successfully deleted account for %s", username)
    except ValueError as e:
        if str(e) == "user_not_found":
            return jsonify({"success": False, "error": "User not found"}), 404
        logger.exception("delete_account ValueError for %s", username)
        return jsonify({"success": False, "error": "server error"}), 500
    except Exception:
        logger.exception("delete_account error for %s", username)
        return jsonify({"success": False, "error": "server error"}), 500

    session_revocation.bump_session_version(username)
    session.clear()
    try:
        from redis_cache import invalidate_user_cache

        invalidate_user_cache(username)
    except Exception:
        pass

    try:
        from backend.services import community_lifecycle as _lifecycle
        from backend.services import subscription_audit as _audit

        for cid in former:
            try:
                if _lifecycle.maybe_auto_unfreeze(cid):
                    _audit.log(
                        username=username or "",
                        action="community_auto_unfrozen_member_removed",
                        source="delete_account",
                        metadata={"community_id": cid},
                    )
            except Exception:
                pass
    except Exception:
        pass

    remember_tokens.revoke_for_user(username)

    resp = jsonify({"success": True, "clear_storage": True})
    remember_tokens.clear_cookie(resp)
    auth_session.clear_session_cookie(resp)
    auth_session.clear_install_cookie(resp)
    auth_session.no_store(resp)
    return resp


@auth_bp.route("/login_password", methods=["GET", "POST"], endpoint="login_password")
def login_password():
    """Password entry stage for staged logins."""
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
                    posted_invite_token = (request.form.get("invite_token") or "").strip()
                    pending_invite_token = session.get("pending_invite_token") or posted_invite_token
                    session.clear()
                    session.permanent = False

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

                    try:
                        install_cookie = request.cookies.get("native_push_install_id")
                        if install_cookie:
                            associate_install_tokens_with_user(install_cookie, username)
                            try:
                                associate_fcm_tokens_for_install(install_cookie, username)
                            except Exception as fcm_exc:
                                logger.warning("fcm_tokens install association failed: %s", fcm_exc)
                    except Exception as exc:
                        logger.warning("native push install association failed: %s", exc)
                    try:
                        session.pop("pending_username", None)
                    except Exception:
                        pass

                    _invalidate_profile_and_dashboard_caches(username)

                    invite_token = pending_invite_token
                    if invite_token:
                        resp = make_response(redirect(f"/invite-preview/{quote(invite_token)}"))
                        _finalize_session_response(resp, username)
                        logger.info("login_password invite_preview username=%s", username)
                        return resp

                    resp = make_response(redirect("/premium_dashboard"))
                    _finalize_session_response(resp, username)
                    logger.info("login_password ok username=%s", username)
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


@auth_bp.route("/api/check_pending_login", methods=["GET"])
def api_check_pending_login():
    """Two-step login: expose pending_username only (no cookie/session debug)."""
    logger = current_app.logger
    try:
        pending_username = session.get("pending_username")
        if pending_username:
            return jsonify({"success": True, "pending_username": pending_username})
        return jsonify({"success": False, "pending_username": None})
    except Exception as exc:
        logger.error("api_check_pending_login: %s", exc)
        return jsonify({"success": False, "pending_username": None}), 500


@auth_bp.route("/api/clear_stale_session", methods=["POST"])
def api_clear_stale_session():
    """Clear session when stored username no longer exists."""
    logger = current_app.logger
    try:
        username = session_identity.current_session_username(session)
        if not username:
            return jsonify({"success": True, "cleared": False, "reason": "no_session"})
        if not session_identity.user_exists(username):
            session_identity.clear_invalid_session(session, username)
            logger.info("api_clear_stale_session cleared session for missing user")
            return jsonify({"success": True, "cleared": True, "reason": "user_deleted"})
        return jsonify({"success": True, "cleared": False, "reason": "user_exists"})
    except Exception as exc:
        logger.error("api_clear_stale_session: %s", exc)
        return jsonify({"success": False, "error": "server_error"}), 500


# --- Google Sign-In ---

# OAuth client IDs (Google Cloud Console). Web = browser + Android ID token audience; iOS = native iOS OAuth client.
_DEFAULT_GOOGLE_WEB_CLIENT_ID = "739552904126-ini3ms8voub380vij0cgq79k1dreul5h.apps.googleusercontent.com"
_DEFAULT_GOOGLE_IOS_CLIENT_ID = "739552904126-nb0l7j8d0p8q8q8rr84gatij5e0ip23p.apps.googleusercontent.com"
_DEFAULT_GOOGLE_ANDROID_CLIENT_ID = "739552904126-mvkhoasgt3kt25uejlple989m3ph6dd4.apps.googleusercontent.com"

GOOGLE_CLIENT_ID_WEB = os.environ.get("GOOGLE_CLIENT_ID_WEB") or _DEFAULT_GOOGLE_WEB_CLIENT_ID
GOOGLE_CLIENT_ID_IOS = os.environ.get("GOOGLE_CLIENT_ID_IOS") or _DEFAULT_GOOGLE_IOS_CLIENT_ID
GOOGLE_CLIENT_ID_ANDROID = os.environ.get("GOOGLE_CLIENT_ID_ANDROID") or _DEFAULT_GOOGLE_ANDROID_CLIENT_ID
APPLE_CLIENT_ID_IOS = os.environ.get("APPLE_CLIENT_ID_IOS") or os.environ.get("APPLE_BUNDLE_ID") or "co.cpoint.app"
APPLE_ISSUER = "https://appleid.apple.com"
APPLE_JWKS_URL = f"{APPLE_ISSUER}/auth/keys"
_APPLE_JWKS_CLIENT: Any = None


def _verify_google_id_token(id_token: str, platform: str = 'ios') -> dict | None:
    """Verify a Google ID token and return the payload (sub, email, name, etc.)."""
    from google.oauth2 import id_token as google_id_token
    from google.auth.transport import requests as google_requests

    # Try audiences in a sensible order per platform (Web/Android tokens usually use Web client aud).
    platform = (platform or '').lower()
    if platform == 'android':
        ordered = (GOOGLE_CLIENT_ID_WEB, GOOGLE_CLIENT_ID_ANDROID, GOOGLE_CLIENT_ID_IOS)
    elif platform == 'web':
        ordered = (GOOGLE_CLIENT_ID_WEB, GOOGLE_CLIENT_ID_IOS, GOOGLE_CLIENT_ID_ANDROID)
    else:
        ordered = (GOOGLE_CLIENT_ID_IOS, GOOGLE_CLIENT_ID_WEB, GOOGLE_CLIENT_ID_ANDROID)
    client_ids = [c for c in ordered if c]

    for client_id in client_ids:
        try:
            payload = google_id_token.verify_oauth2_token(
                id_token, google_requests.Request(), client_id
            )
            if payload.get('iss') not in ('accounts.google.com', 'https://accounts.google.com'):
                return None
            return payload
        except Exception as e:
            suffix = client_id[-8:] if len(client_id) >= 8 else client_id
            current_app.logger.debug("Google ID token verify with client_id (suffix …%s): %s", suffix, e)
            continue
    current_app.logger.warning("Google ID token verification failed: no matching client ID")
    return None


def _ensure_google_id_column(cursor):
    """Add google_id column to users table if missing."""
    try:
        cursor.execute("SELECT google_id FROM users LIMIT 1")
    except Exception:
        try:
            from backend.services.database import USE_MYSQL
            if USE_MYSQL:
                cursor.execute("ALTER TABLE users ADD COLUMN google_id VARCHAR(191) UNIQUE DEFAULT NULL")
            else:
                cursor.execute("ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE DEFAULT NULL")
        except Exception:
            pass


def _ensure_apple_id_column(cursor):
    """Add apple_id column to users table if missing."""
    try:
        cursor.execute("SELECT apple_id FROM users LIMIT 1")
    except Exception:
        try:
            from backend.services.database import USE_MYSQL
            if USE_MYSQL:
                cursor.execute("ALTER TABLE users ADD COLUMN apple_id VARCHAR(191) UNIQUE DEFAULT NULL")
            else:
                cursor.execute("ALTER TABLE users ADD COLUMN apple_id TEXT UNIQUE DEFAULT NULL")
        except Exception:
            pass


def _oauth_email_verified(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes")
    return bool(value)


def _verify_apple_id_token(id_token: str, nonce: str | None = None) -> dict | None:
    """Verify an Apple identity token and return its claims."""
    try:
        import jwt
        from jwt import PyJWKClient

        global _APPLE_JWKS_CLIENT
        if _APPLE_JWKS_CLIENT is None:
            _APPLE_JWKS_CLIENT = PyJWKClient(APPLE_JWKS_URL)

        signing_key = _APPLE_JWKS_CLIENT.get_signing_key_from_jwt(id_token)
        payload = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=APPLE_CLIENT_ID_IOS,
            issuer=APPLE_ISSUER,
        )
        if nonce and payload.get("nonce") and payload.get("nonce") != nonce:
            current_app.logger.warning("Apple ID token nonce mismatch")
            return None
        return payload
    except Exception as exc:
        current_app.logger.warning("Apple ID token verification failed: %s", exc)
        return None


@auth_bp.route("/api/auth/google", methods=["POST"])
def google_sign_in():
    """
    Google Sign-In endpoint for iOS/Android.
    Body: { id_token, platform: 'ios'|'android', invite_token? }
    """
    logger = current_app.logger
    data = request.get_json() or {}
    id_token_str = (data.get('id_token') or '').strip()
    platform = (data.get('platform') or 'ios').strip().lower()
    invite_token = (data.get('invite_token') or '').strip() or None

    if not id_token_str:
        return jsonify({'success': False, 'error': 'ID token required'}), 400

    payload = _verify_google_id_token(id_token_str, platform)
    if not payload:
        return jsonify({'success': False, 'error': 'Invalid Google token'}), 401

    google_id = payload.get('sub')
    email = (payload.get('email') or '').lower().strip()
    canonical = canonicalize_with_policy(email) if email else ""
    first_name = payload.get('given_name') or ''
    last_name = payload.get('family_name') or ''
    email_verified = payload.get('email_verified', False)

    if not google_id or not email:
        return jsonify({'success': False, 'error': 'Incomplete Google profile'}), 400

    try:
        # Drop any prior session keys (pending_username, stale username, etc.) before binding identity.
        session.clear()
        session.permanent = False
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_google_id_column(c)

            # 1. Look up by google_id (returning user)
            c.execute(f"SELECT username, email FROM users WHERE google_id = {ph}", (google_id,))
            row = c.fetchone()
            if row:
                username = row['username'] if hasattr(row, 'keys') else row[0]
                apply_oauth_email_verified(c, ph, username, bool(email_verified))
                conn.commit()
                session['username'] = username
                if invite_token:
                    session['pending_invite_token'] = invite_token
                session.permanent = True
                session_revocation.stamp_session(session, username)
                _invalidate_profile_and_dashboard_caches(username)
                logger.info(f"Google sign-in: returning user {username}")
                resp = make_response(jsonify({'success': True, 'username': username, 'is_new': False}))
                stale = _apply_login_persistence(resp, username)
                logger.info("Google sign-in persistence stale_revoked=%d user=%s", stale, username)
                auth_session.no_store(resp)
                return resp

            # 2. Look up by email (link existing account)
            c.execute(
                f"SELECT username FROM users WHERE canonical_email = {ph} OR LOWER(email) = LOWER({ph})",
                (canonical, email),
            )
            row = c.fetchone()
            if row:
                username = row['username'] if hasattr(row, 'keys') else row[0]
                c.execute(
                    f"UPDATE users SET google_id = {ph}, canonical_email = COALESCE(canonical_email, {ph}) WHERE username = {ph}",
                    (google_id, canonical, username),
                )
                apply_oauth_email_verified(c, ph, username, bool(email_verified))
                conn.commit()
                session['username'] = username
                if invite_token:
                    session['pending_invite_token'] = invite_token
                session.permanent = True
                session_revocation.stamp_session(session, username)
                # Display name is intentionally NOT touched on link: established users keep
                # whatever they already had in user_profiles. Auto-fill happens only on the
                # new-user creation branch below.
                _invalidate_profile_and_dashboard_caches(username)
                logger.info(f"Google sign-in: linked {username} to Google ID")
                resp = make_response(jsonify({'success': True, 'username': username, 'is_new': False}))
                stale = _apply_login_persistence(resp, username)
                logger.info("Google sign-in linked persistence stale_revoked=%d user=%s", stale, username)
                auth_session.no_store(resp)
                return resp

            # 3. Create new user
            base_username = re.sub(r'[^a-z0-9_]', '', email.split('@')[0].lower()) or 'user'
            username = base_username
            suffix = 1
            while True:
                c.execute(f"SELECT 1 FROM users WHERE username = {ph}", (username,))
                if not c.fetchone():
                    break
                suffix += 1
                username = f"{base_username}{suffix}"

            random_password = generate_password_hash(secrets.token_urlsafe(32))
            now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
            verified_at = first_oauth_verified_at_iso() if email_verified else None
            c.execute(f"""
                INSERT INTO users (username, email, canonical_email, password, first_name, last_name, google_id, email_verified, email_verified_at, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """, (
                username,
                email,
                canonical,
                random_password,
                first_name,
                last_name,
                google_id,
                1 if email_verified else 0,
                verified_at,
                now,
            ))
            conn.commit()

            # Create profile with display name
            full_name = f"{first_name} {last_name}".strip() or username
            try:
                c.execute(f"INSERT INTO user_profiles (username, display_name) VALUES ({ph}, {ph})", (username, full_name))
                conn.commit()
            except Exception:
                try:
                    c.execute(f"UPDATE user_profiles SET display_name = {ph} WHERE username = {ph}", (full_name, username))
                    conn.commit()
                except Exception:
                    pass

            # Handle invite token
            if invite_token:
                try:
                    session['pending_invite_token'] = invite_token
                except Exception:
                    pass

            session['username'] = username
            session.permanent = True
            session_revocation.stamp_session(session, username)
            _invalidate_profile_and_dashboard_caches(username)
            logger.info(f"Google sign-in: created new user {username}")
            resp = make_response(jsonify({'success': True, 'username': username, 'is_new': True}))
            stale = _apply_login_persistence(resp, username)
            logger.info("Google sign-in new user persistence stale_revoked=%d user=%s", stale, username)
            auth_session.no_store(resp)
            return resp

    except Exception as e:
        logger.error(f"Google sign-in error: {e}")
        return jsonify({'success': False, 'error': 'Authentication failed'}), 500


@auth_bp.route("/api/auth/apple", methods=["POST"])
def apple_sign_in():
    """
    Sign in with Apple endpoint for iOS.
    Body: { id_token, apple_user?, given_name?, family_name?, nonce?, invite_token? }
    """
    logger = current_app.logger
    data = request.get_json() or {}
    id_token_str = (data.get('id_token') or '').strip()
    apple_user = (data.get('apple_user') or '').strip()
    nonce = (data.get('nonce') or '').strip() or None
    invite_token = (data.get('invite_token') or '').strip() or None

    if not id_token_str:
        return jsonify({'success': False, 'error': 'Apple identity token required'}), 400

    payload = _verify_apple_id_token(id_token_str, nonce=nonce)
    if not payload:
        return jsonify({'success': False, 'error': 'Invalid Apple token'}), 401

    apple_id = (payload.get('sub') or '').strip()
    email = (payload.get('email') or '').lower().strip()
    canonical = canonicalize_with_policy(email) if email else ""
    first_name = (data.get('given_name') or '').strip()
    last_name = (data.get('family_name') or '').strip()
    email_verified = _oauth_email_verified(payload.get('email_verified'))

    if not apple_id:
        return jsonify({'success': False, 'error': 'Incomplete Apple profile'}), 400
    if apple_user and apple_user != apple_id:
        return jsonify({'success': False, 'error': 'Apple account mismatch'}), 400

    try:
        # Drop any prior session keys (pending_username, stale username, etc.) before binding identity.
        session.clear()
        session.permanent = False
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            _ensure_apple_id_column(c)

            # 1. Look up by Apple's stable subject (returning user).
            c.execute(f"SELECT username, email FROM users WHERE apple_id = {ph}", (apple_id,))
            row = c.fetchone()
            if row:
                username = row['username'] if hasattr(row, 'keys') else row[0]
                apply_oauth_email_verified(c, ph, username, email_verified)
                conn.commit()
                session['username'] = username
                if invite_token:
                    session['pending_invite_token'] = invite_token
                session.permanent = True
                session_revocation.stamp_session(session, username)
                _invalidate_profile_and_dashboard_caches(username)
                logger.info("Apple sign-in: returning user %s", username)
                resp = make_response(jsonify({'success': True, 'username': username, 'is_new': False}))
                stale = _apply_login_persistence(resp, username)
                logger.info("Apple sign-in persistence stale_revoked=%d user=%s", stale, username)
                auth_session.no_store(resp)
                return resp

            # 2. Link an existing email account only when Apple supplied a signed email claim.
            if email:
                c.execute(
                    f"SELECT username FROM users WHERE canonical_email = {ph} OR LOWER(email) = LOWER({ph})",
                    (canonical, email),
                )
                row = c.fetchone()
                if row:
                    username = row['username'] if hasattr(row, 'keys') else row[0]
                    c.execute(
                        f"UPDATE users SET apple_id = {ph}, canonical_email = COALESCE(canonical_email, {ph}) WHERE username = {ph}",
                        (apple_id, canonical, username),
                    )
                    apply_oauth_email_verified(c, ph, username, email_verified)
                    conn.commit()
                    session['username'] = username
                    if invite_token:
                        session['pending_invite_token'] = invite_token
                    session.permanent = True
                    session_revocation.stamp_session(session, username)
                    _invalidate_profile_and_dashboard_caches(username)
                    logger.info("Apple sign-in: linked %s to Apple ID", username)
                    resp = make_response(jsonify({'success': True, 'username': username, 'is_new': False}))
                    stale = _apply_login_persistence(resp, username)
                    logger.info("Apple sign-in linked persistence stale_revoked=%d user=%s", stale, username)
                    auth_session.no_store(resp)
                    return resp

            if not email:
                return jsonify({
                    'success': False,
                    'error': 'Apple did not provide an email address. Remove C-Point from Sign in with Apple settings and try again.',
                }), 400

            # 3. Create new user. Apple private relay emails are accepted as the account email.
            base_username = re.sub(r'[^a-z0-9_]', '', email.split('@')[0].lower()) or 'appleuser'
            username = base_username
            suffix = 1
            while True:
                c.execute(f"SELECT 1 FROM users WHERE username = {ph}", (username,))
                if not c.fetchone():
                    break
                suffix += 1
                username = f"{base_username}{suffix}"

            random_password = generate_password_hash(secrets.token_urlsafe(32))
            now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
            verified_at = first_oauth_verified_at_iso() if email_verified else None
            c.execute(f"""
                INSERT INTO users (username, email, canonical_email, password, first_name, last_name, apple_id, email_verified, email_verified_at, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """, (
                username,
                email,
                canonical,
                random_password,
                first_name,
                last_name,
                apple_id,
                1 if email_verified else 0,
                verified_at,
                now,
            ))
            conn.commit()

            full_name = f"{first_name} {last_name}".strip() or username
            try:
                c.execute(f"INSERT INTO user_profiles (username, display_name) VALUES ({ph}, {ph})", (username, full_name))
                conn.commit()
            except Exception:
                try:
                    c.execute(f"UPDATE user_profiles SET display_name = {ph} WHERE username = {ph}", (full_name, username))
                    conn.commit()
                except Exception:
                    pass

            if invite_token:
                try:
                    session['pending_invite_token'] = invite_token
                except Exception:
                    pass

            session['username'] = username
            session.permanent = True
            session_revocation.stamp_session(session, username)
            _invalidate_profile_and_dashboard_caches(username)
            logger.info("Apple sign-in: created new user %s", username)
            resp = make_response(jsonify({'success': True, 'username': username, 'is_new': True}))
            stale = _apply_login_persistence(resp, username)
            logger.info("Apple sign-in new user persistence stale_revoked=%d user=%s", stale, username)
            auth_session.no_store(resp)
            return resp
    except Exception as e:
        logger.error("Apple sign-in error: %s", e)
        return jsonify({'success': False, 'error': 'Authentication failed'}), 500


@auth_bp.route("/request_password_reset", methods=["POST"])
def request_password_reset():
    """Public endpoint: email a password reset link when account exists."""
    from backend.services import password_reset as pw_reset

    data = request.get_json(silent=True) or {}
    email = (
        (data.get("email") if isinstance(data, dict) else None)
        or request.form.get("email")
        or request.args.get("email")
    )
    payload = pw_reset.request_reset(email or "")
    return jsonify(payload)


@auth_bp.route("/reset_password/<token>", methods=["GET", "POST"], endpoint="reset_password")
def reset_password(token: str):
    """Show reset form (GET) or apply new password (POST)."""
    from backend.services import password_reset as pw_reset

    if request.method == "GET":
        ctx = template_i18n.template_ctx()
        token_ctx = pw_reset.get_token_context(token)
        if not token_ctx:
            flash(ctx["tt"]("reset_password.invalid_link"), "error")
            return redirect(url_for("public.index"))
        return render_template(
            "reset_password.html",
            token=token_ctx["token"],
            username=token_ctx["username"],
            **ctx,
        )

    new_password = request.form.get("password") or ""
    confirm_password = request.form.get("confirm_password") or ""
    ok, message = pw_reset.complete_reset(token, new_password, confirm_password)
    ctx = template_i18n.template_ctx()
    if not ok:
        flash(template_i18n.localize_reset_message(message, ctx["locale"]), "error")
        return redirect(url_for("auth.reset_password", token=token))
    return render_template(
        "verification_result.html",
        success=True,
        message=template_i18n.localize_reset_message(message, ctx["locale"]),
        **ctx,
    )
