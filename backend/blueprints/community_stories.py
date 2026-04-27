"""Community story API routes."""

from __future__ import annotations

from functools import wraps

from flask import Blueprint, current_app, jsonify, redirect, request, session, url_for

from backend.services import community_stories as stories_svc


community_stories_bp = Blueprint("community_stories", __name__)


def _login_required(view_func):
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


def _json_response(result):
    payload, status = result
    return jsonify(payload), status


@community_stories_bp.route("/api/community_stories/<int:community_id>")
@_login_required
def api_community_stories(community_id: int):
    return _json_response(stories_svc.list_community_stories(session["username"], community_id))


@community_stories_bp.route("/api/community_stories", methods=["POST"])
@_login_required
def create_community_story():
    return _json_response(stories_svc.create_community_story(session["username"], request.form, request.files))


@community_stories_bp.route("/api/community_stories/view", methods=["POST"])
@_login_required
def api_mark_story_view():
    payload = request.get_json(silent=True) or {}
    story_id = payload.get("story_id") or request.form.get("story_id")
    try:
        story_id = int(story_id)
    except Exception:
        return jsonify({"success": False, "error": "story_id required"}), 400
    return _json_response(stories_svc.mark_story_view(session["username"], story_id))


@community_stories_bp.route("/api/community_stories/<int:story_id>/viewers", methods=["GET"])
@_login_required
def api_get_story_viewers(story_id: int):
    return _json_response(stories_svc.get_story_viewers(session["username"], story_id))


@community_stories_bp.route("/api/story/<int:story_id>", methods=["GET"])
@_login_required
def get_community_story(story_id: int):
    return _json_response(stories_svc.get_story(story_id))


@community_stories_bp.route("/api/community_stories/<int:story_id>", methods=["DELETE"])
@_login_required
def delete_community_story(story_id: int):
    return _json_response(stories_svc.delete_story(session["username"], story_id))


@community_stories_bp.route("/api/community_stories/group/<story_group_id>", methods=["DELETE"])
@_login_required
def delete_community_story_group(story_group_id: str):
    return _json_response(stories_svc.delete_story_group(session["username"], story_group_id))


@community_stories_bp.route("/api/community_stories/react", methods=["POST"])
@_login_required
def api_story_reaction():
    payload = request.get_json(silent=True) or {}
    story_id = payload.get("story_id") or request.form.get("story_id")
    try:
        story_id = int(story_id)
    except Exception:
        return jsonify({"success": False, "error": "story_id required"}), 400
    return _json_response(stories_svc.react_to_story(session["username"], story_id, payload.get("reaction")))


@community_stories_bp.route("/api/community_stories/<int:story_id>/comments")
@_login_required
def api_get_story_comments(story_id: int):
    return _json_response(stories_svc.get_story_comments(session["username"], story_id))


@community_stories_bp.route("/api/community_stories/<int:story_id>/comments", methods=["POST"])
@_login_required
def api_add_story_comment(story_id: int):
    payload = request.get_json(silent=True) or {}
    content = (payload.get("content") or "").strip()
    return _json_response(stories_svc.add_story_comment(session["username"], story_id, content))


@community_stories_bp.route("/api/community_stories/comments/<int:comment_id>", methods=["DELETE"])
@_login_required
def api_delete_story_comment(comment_id: int):
    return _json_response(stories_svc.delete_story_comment(session["username"], comment_id))
