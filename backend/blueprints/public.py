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


@public_bp.route("/api/push/register_fcm", methods=["POST"])
def register_fcm_token():
    """Register a push notification token (FCM or native APNs)."""
    from backend.services.database import get_db_connection, get_sql_placeholder, USE_MYSQL
    from backend.services.firebase_notifications import is_apns_token
    
    logger = current_app.logger
    
    try:
        data = request.get_json()
        token = data.get("token", "").strip()
        platform = data.get("platform", "ios")
        device_name = data.get("device_name", "")
        
        if not token:
            return jsonify({"error": "Token required"}), 400
        
        # Get username if logged in
        username = session.get("username")
        
        # Detect token type
        is_native_apns = is_apns_token(token)
        token_type = "APNs" if is_native_apns else "FCM"
        
        logger.info(f"📱 Registering {token_type} token for {username or 'anonymous'}")
        logger.info(f"   Token: {token[:20]}... ({len(token)} chars)")
        
        conn = get_db_connection()
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        
        # Always store in fcm_tokens table (main table for all push tokens)
        if USE_MYSQL:
            cursor.execute(f"""
                INSERT INTO fcm_tokens (token, username, platform, device_name, last_seen, is_active)
                VALUES ({ph}, {ph}, {ph}, {ph}, NOW(), 1)
                ON DUPLICATE KEY UPDATE
                    username=IFNULL(VALUES(username), username),
                    platform=VALUES(platform),
                    device_name=VALUES(device_name),
                    last_seen=NOW(),
                    is_active=1
            """, (token, username, platform, device_name))
        else:
            cursor.execute("""
                INSERT INTO fcm_tokens (token, username, platform, device_name, last_seen, is_active)
                VALUES (?, ?, ?, ?, datetime('now'), 1)
                ON CONFLICT(token) DO UPDATE SET
                    username=COALESCE(excluded.username, username),
                    platform=excluded.platform,
                    device_name=excluded.device_name,
                    last_seen=excluded.last_seen,
                    is_active=1
            """, (token, username, platform, device_name))
        
        # If it's an APNs token, also store in native_push_tokens for direct APNs sending
        if is_native_apns and platform == 'ios':
            logger.info(f"   Also storing in native_push_tokens for direct APNs")
            try:
                if USE_MYSQL:
                    cursor.execute(f"""
                        INSERT INTO native_push_tokens (token, username, platform, environment, bundle_id, device_name, last_seen, is_active)
                        VALUES ({ph}, {ph}, {ph}, 'production', 'co.cpoint.app', {ph}, NOW(), 1)
                        ON DUPLICATE KEY UPDATE
                            username=IFNULL(VALUES(username), username),
                            device_name=VALUES(device_name),
                            last_seen=NOW(),
                            is_active=1
                    """, (token, username, platform, device_name))
                else:
                    cursor.execute("""
                        INSERT INTO native_push_tokens (token, username, platform, environment, bundle_id, device_name, last_seen, is_active)
                        VALUES (?, ?, ?, 'production', 'co.cpoint.app', ?, datetime('now'), 1)
                        ON CONFLICT(token) DO UPDATE SET
                            username=COALESCE(excluded.username, username),
                            device_name=excluded.device_name,
                            last_seen=excluded.last_seen,
                            is_active=1
                    """, (token, username, platform, device_name))
            except Exception as e:
                logger.warning(f"Could not store in native_push_tokens: {e}")
        
        conn.commit()
        cursor.close()
        conn.close()
        
        logger.info(f"✅ {token_type} token registered for {username or 'anonymous'}")
        return jsonify({
            "success": True, 
            "message": f"{token_type} token registered",
            "token_type": token_type.lower()
        })
        
    except Exception as e:
        logger.error(f"Token registration error: {e}")
        return jsonify({"error": str(e)}), 500


@public_bp.route("/api/push/register_native", methods=["POST"])
def register_native_push_token():
    """Register a native iOS/Android push notification token (legacy - redirects to FCM)."""
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
