"""Useful Links & Docs API routes."""

from __future__ import annotations

from functools import wraps

from flask import Blueprint, current_app, jsonify, redirect, request, session, url_for

from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.useful_docs_write import delete_useful_doc, rename_useful_doc, upload_useful_doc
from backend.services.useful_links_read import fetch_useful_links_payload
from backend.services.useful_links_write import add_useful_link, delete_useful_link

useful_resources_bp = Blueprint("useful_resources", __name__)


def _login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return redirect(url_for("auth.login"))
        return view_func(*args, **kwargs)

    return wrapper


def _json(payload, status: int = 200):
    return jsonify(payload), status


def _parse_group_id(raw: str | None) -> tuple[int | None, dict | None]:
    raw = (raw or "").strip()
    if not raw:
        return None, None
    try:
        return int(raw), None
    except (TypeError, ValueError):
        return None, {"success": False, "message": "Invalid group_id", "error": "Invalid group_id"}


@useful_resources_bp.route("/get_links")
@_login_required
def get_links():
    try:
        username = session["username"]
        community_id = request.args.get("community_id")
        group_id_param = request.args.get("group_id")
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            payload = fetch_useful_links_payload(c, username, community_id, group_id_param, ph)
            if not payload.get("success"):
                code = 400 if (payload.get("error") or "") == "Invalid group_id" else 403
                return _json(payload, code)
            return _json(payload)
    except Exception as exc:
        current_app.logger.error("Error getting links: %s", exc)
        return _json({"success": False, "error": str(exc)}, 500)


@useful_resources_bp.route("/add_link", methods=["POST"])
@_login_required
def add_link():
    try:
        username = session["username"]
        group_id_int, err_payload = _parse_group_id(request.form.get("group_id"))
        if err_payload:
            return _json(err_payload, 400)
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            ok, payload = add_useful_link(
                conn,
                c,
                ph,
                username=username,
                url=request.form.get("url", ""),
                description=request.form.get("description", ""),
                community_id_raw=request.form.get("community_id"),
                group_id_int=group_id_int,
            )
            if not ok:
                code = 403 if payload.get("error") == "Forbidden" else 400
                return _json(payload, code)
            return _json(payload)
    except Exception as exc:
        current_app.logger.error("Error adding link: %s", exc)
        return _json({"success": False, "error": str(exc)}, 500)


@useful_resources_bp.route("/upload_doc", methods=["POST"])
@_login_required
def upload_doc():
    try:
        username = session["username"]
        group_id_int, err_payload = _parse_group_id(request.form.get("group_id"))
        if err_payload:
            return _json({**err_payload, "success": False}, 400)
        if "file" not in request.files:
            return _json({"success": False, "error": "No file provided"})
        name = (request.form.get("name") or request.form.get("description") or "").strip()
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            ok, payload, status = upload_useful_doc(
                conn,
                c,
                ph,
                username=username,
                community_id_raw=request.form.get("community_id"),
                group_id_int=group_id_int,
                name=name,
                details=(request.form.get("details") or "").strip(),
                file_storage=request.files["file"],
            )
            if not ok:
                return _json(payload, status)
            return _json(payload)
    except Exception as exc:
        current_app.logger.error("upload_doc error: %s", exc)
        return _json({"success": False, "error": "Server error"}, 500)


@useful_resources_bp.route("/delete_doc", methods=["POST"])
@_login_required
def delete_doc():
    try:
        username = session.get("username")
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            ok, payload = delete_useful_doc(
                conn,
                c,
                ph,
                username=username,
                doc_id_raw=request.form.get("doc_id"),
            )
            if not ok:
                code = 403 if payload.get("error") == "Forbidden" else 400
                return _json(payload, code)
            return _json(payload)
    except Exception as exc:
        current_app.logger.error("Error deleting doc: %s", exc)
        return _json({"success": False, "error": "Server error"}, 500)


@useful_resources_bp.route("/rename_doc", methods=["POST"])
@_login_required
def rename_doc():
    try:
        username = session.get("username")
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            ok, payload = rename_useful_doc(
                conn,
                c,
                ph,
                username=username,
                doc_id_raw=request.form.get("doc_id"),
                new_name=request.form.get("new_name", ""),
                details=(request.form.get("details") or "").strip(),
            )
            if not ok:
                return _json(payload, 400)
            return _json(payload)
    except Exception as exc:
        current_app.logger.error("Error renaming doc: %s", exc)
        return _json({"success": False, "error": "Server error"}, 500)


@useful_resources_bp.route("/delete_link", methods=["POST"])
@_login_required
def delete_link():
    try:
        username = session["username"]
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            ok, payload = delete_useful_link(
                conn,
                c,
                ph,
                username=username,
                link_id_raw=request.form.get("link_id"),
            )
            if not ok:
                return _json(payload, 400)
            return _json(payload)
    except Exception as exc:
        current_app.logger.error("Error deleting link: %s", exc)
        return _json({"success": False, "error": str(exc)}, 500)
