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
    """Landing page that serves React SPA to mobile and HTML to desktop."""
    logger = current_app.logger
    try:
        if session.get("username"):
            return redirect(url_for("premium_dashboard"))

        ua = request.headers.get("User-Agent", "")
        is_mobile = any(k in ua for k in ["Mobi", "Android", "iPhone", "iPad"])
        if is_mobile:
            try:
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
            except Exception as exc:
                logger.warning("React mobile index not available: %s", exc)
        return render_template("index.html")
    except Exception as exc:
        logger.error("Error in / route: %s", exc)
        return ("Internal Server Error", 500)


@public_bp.route("/welcome", methods=["GET"])
def welcome():
    """Mobile-only React entry point for onboarding."""
    logger = current_app.logger
    try:
        ua = request.headers.get("User-Agent", "")
        is_mobile = any(k in ua for k in ["Mobi", "Android", "iPhone", "iPad"])
        if not is_mobile:
            return redirect(url_for("public.index"))

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

        return render_template("onboarding_welcome.html", username=session.get("username"))
    except Exception as exc:
        logger.error("Error in /welcome: %s", exc)
        return ("Internal Server Error", 500)
