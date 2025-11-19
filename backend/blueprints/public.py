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
