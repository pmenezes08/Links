"""Community invite API routes."""

from __future__ import annotations

from functools import wraps

from flask import Blueprint, current_app, jsonify, redirect, request, session, url_for

from backend.services import community_invites as invites_svc


community_invites_bp = Blueprint("community_invites", __name__)


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


@community_invites_bp.route("/api/community/<int:community_id>/invite_settings", methods=["GET", "POST"])
@_login_required
def community_invite_settings(community_id: int):
    payload = request.get_json(silent=True) or {}
    return _json_response(invites_svc.invite_settings(session["username"], community_id, request.method, payload))


@community_invites_bp.route("/api/community/invite_link", methods=["POST"])
@_login_required
def generate_invite_link():
    payload = request.get_json(silent=True) or {}
    return _json_response(
        invites_svc.generate_invite_link(
            session["username"],
            payload.get("community_id"),
            request.host_url.rstrip("/"),
        )
    )


@community_invites_bp.route("/api/community/manageable", methods=["GET"])
@_login_required
def list_manageable_communities():
    target_username = (request.args.get("target_username") or "").strip() or None
    return _json_response(invites_svc.fetch_manageable_communities(session["username"], target_username))


@community_invites_bp.route("/api/community/invite_username", methods=["POST"])
@_login_required
def invite_username_to_community():
    return _json_response(invites_svc.invite_username(session["username"], request.get_json(silent=True) or {}))


@community_invites_bp.route("/api/community/invites/pending", methods=["GET"])
@_login_required
def list_pending_username_invites():
    return _json_response(invites_svc.list_pending_invites(session["username"]))


@community_invites_bp.route("/api/community/invites/<int:invite_id>/accept", methods=["POST"])
@_login_required
def accept_username_invite(invite_id: int):
    return _json_response(invites_svc.accept_invite(session["username"], invite_id))


@community_invites_bp.route("/api/community/invites/<int:invite_id>/decline", methods=["POST"])
@_login_required
def decline_username_invite(invite_id: int):
    return _json_response(invites_svc.decline_invite(session["username"], invite_id))


@community_invites_bp.route("/api/join_with_invite", methods=["POST"])
@_login_required
def join_with_invite():
    payload = request.get_json(silent=True) or {}
    return _json_response(invites_svc.join_with_invite(session["username"], (payload.get("invite_token") or "").strip()))


@community_invites_bp.route("/api/invite_info", methods=["POST"])
@_login_required
def get_invite_info():
    payload = request.get_json(silent=True) or {}
    return _json_response(invites_svc.invite_info((payload.get("invite_token") or "").strip()))


@community_invites_bp.route("/api/community/invite", methods=["POST"])
@_login_required
def invite_to_community():
    return _json_response(
        invites_svc.invite_email(
            session["username"],
            request.get_json(silent=True) or {},
            request.host_url.rstrip("/"),
        )
    )


@community_invites_bp.route("/api/community/invite_bulk", methods=["POST"])
@_login_required
def invite_to_community_bulk():
    return _json_response(
        invites_svc.invite_bulk(
            session["username"],
            request.get_json(silent=True) or {},
            request.host_url.rstrip("/"),
        )
    )
