"""Record community post views (feed impressions, post detail, etc.)."""

from __future__ import annotations

from functools import wraps

from flask import Blueprint, jsonify, request, session

from backend.services.post_views import record_community_post_view

post_views_bp = Blueprint("post_views", __name__)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"success": False, "error": "unauthenticated"}), 401
            from flask import redirect, url_for

            return redirect(url_for("auth.login"))
        return view_func(*args, **kwargs)

    return wrapper


@post_views_bp.route("/api/post_view", methods=["POST"])
@_login_required
def api_post_view():
    username = session.get("username") or ""
    try:
        payload = request.get_json(silent=True) or {}
    except Exception:
        payload = {}
    post_id = payload.get("post_id")
    if post_id is None:
        post_id = request.form.get("post_id", type=int)
    if post_id is None:
        return jsonify({"success": False, "error": "post_id required"}), 400

    result = record_community_post_view(username, post_id)
    status = int(result.pop("http_status", 200))
    if result.get("success"):
        return jsonify(result)
    return jsonify(result), status
