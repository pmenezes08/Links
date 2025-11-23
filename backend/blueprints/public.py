"""Public/unauthenticated routes exposed via a Flask blueprint."""

from __future__ import annotations

import os

from flask import (
    Blueprint,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
    current_app,
    jsonify,
)


public_bp = Blueprint("public", __name__)


@public_bp.route("/", methods=["GET"])
def index():
    """Landing page - serves React SPA for all devices and users."""
    logger = current_app.logger
    try:
        # Always serve React SPA - let React handle routing and authentication
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
            logger.error("React build not found at: %s", index_path)
            return ("React build not found. Please run 'npm run build' in the client directory.", 500)
    except Exception as exc:
        logger.error("Error in / route: %s", exc)
        return ("Internal Server Error", 500)


@public_bp.route("/welcome", methods=["GET"])
def welcome():
    """Welcome/onboarding page - serves React SPA."""
    logger = current_app.logger
    try:
        # Serve React SPA for welcome page
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
            logger.error("React build not found at: %s", index_path)
            return ("React build not found.", 500)
    except Exception as exc:
        logger.error("Error in /welcome: %s", exc)
        return ("Internal Server Error", 500)


@public_bp.route("/api/push/register_native", methods=["POST"])
def register_native_push_token():
    """Register a native iOS/Android push notification token."""
    from backend.services.database import get_db_connection, get_sql_placeholder
    
    logger = current_app.logger
    try:
        data = request.get_json() or {}
        token = data.get('token')
        platform = data.get('platform', 'unknown')
        
        if not token:
            return jsonify({'success': False, 'error': 'No token provided'}), 400
        
        # Get current user from session (may be None if not logged in yet)
        username = session.get('username')
        
        # If not logged in, store as anonymous for now (will be updated on login)
        if not username:
            username = f'anonymous_{token[:16]}'  # Temporary placeholder
            logger.info(f"📱 Storing anonymous push token (will associate with user on login)")
            logger.info(f"   Token preview: {token[:20]}...")
            logger.info(f"   Platform: {platform}")
        
        # Store token in database
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            ph = get_sql_placeholder()
            # Check if token exists for this user/platform
            cursor.execute(
                f"SELECT id FROM push_tokens WHERE username = {ph} AND platform = {ph}",
                (username, platform)
            )
            existing = cursor.fetchone()
            
            if existing:
                # Update existing token
                cursor.execute(
                    f"UPDATE push_tokens SET token = {ph}, updated_at = CURRENT_TIMESTAMP, is_active = 1 WHERE username = {ph} AND platform = {ph}",
                    (token, username, platform)
                )
                logger.info(f"📱 Updated push token for {username} on {platform}")
            else:
                # Insert new token
                cursor.execute(
                    f"INSERT INTO push_tokens (username, token, platform, is_active) VALUES ({ph}, {ph}, {ph}, 1)",
                    (username, token, platform)
                )
                logger.info(f"📱 Registered new push token for {username} on {platform}")
            
            conn.commit()
            
            logger.info(f"✅ Push token saved - Platform: {platform}, Token: {token[:20]}...")
            
            # If this was an anonymous registration, remind to associate it on login
            if username.startswith('anonymous_'):
                logger.info(f"   Note: Token stored anonymously, will be linked to user on login")
            
            return jsonify({'success': True, 'message': 'Push token registered successfully'}), 200
            
        except Exception as db_err:
            conn.rollback()
            logger.error(f"Database error storing push token: {db_err}")
            # Even if DB storage fails, log it for manual setup
            logger.info(f"📱 FALLBACK LOG - Platform: {platform}, Token: {token[:20]}...")
            return jsonify({'success': True, 'message': 'Token logged (DB storage failed)'}), 200
        finally:
            cursor.close()
            conn.close()
            
    except Exception as exc:
        logger.error("Error registering native push token: %s", exc)
        return jsonify({'success': False, 'error': 'Internal server error'}), 500


@public_bp.route("/api/push/public_key", methods=["GET"])
def get_push_public_key():
    """Get VAPID public key for web push (not used by native apps)."""
    # This endpoint is for web push only, not native apps
    # Native apps use APNs/FCM directly
    return jsonify({'publicKey': None}), 200
