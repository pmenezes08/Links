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
    logger = current_app.logger
    try:
        data = request.get_json() or {}
        token = data.get('token')
        platform = data.get('platform', 'unknown')
        
        if not token:
            return jsonify({'success': False, 'error': 'No token provided'}), 400
        
        # TODO: Store token in database for sending push notifications via APNs/FCM
        # For now, just log it
        logger.info(f"📱 Native push token registered - Platform: {platform}, Token: {token[:20]}...")
        
        # In production, you would:
        # 1. Store the token in database associated with the current user
        # 2. Configure APNs (iOS) or FCM (Android) credentials
        # 3. Use a library like 'pyapns2' or 'firebase-admin' to send notifications
        
        return jsonify({'success': True, 'message': 'Token registered (logged for future APNs setup)'}), 200
    except Exception as exc:
        logger.error("Error registering native push token: %s", exc)
        return jsonify({'success': False, 'error': 'Internal server error'}), 500


@public_bp.route("/api/push/public_key", methods=["GET"])
def get_push_public_key():
    """Get VAPID public key for web push (not used by native apps)."""
    # This endpoint is for web push only, not native apps
    # Native apps use APNs/FCM directly
    return jsonify({'publicKey': None}), 200
