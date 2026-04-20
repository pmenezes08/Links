"""Admin API for the internal C-Point Knowledge Base."""

from __future__ import annotations

import logging
from functools import wraps
from typing import Any, Dict

from flask import Blueprint, jsonify, request, session

from backend.services.content_generation.permissions import is_app_admin
from backend.services import special_access
from backend.services.knowledge_base import (
    TEST_STATUSES,
    ensure_tables,
    get_categories,
    get_page,
    list_changelog,
    list_pages,
    save_page,
    seed_default_pages,
    update_test_status,
)


knowledge_base_bp = Blueprint("knowledge_base", __name__)
logger = logging.getLogger(__name__)

# Run ``seed_default_pages()`` at most once per Python process so that new
# seed content added after a deploy automatically flows into the DB without a
# manual POST. Subsequent list/get calls skip the seed work.
#
# The seed function itself is safe to re-run: it only touches pages that are
# either (a) missing, or (b) still at v1 / updated_by='system-seed' (never
# edited). User-edited pages are skipped.
_seed_run_this_process = False


def _ensure_seeded_once() -> None:
    global _seed_run_this_process
    if _seed_run_this_process:
        return
    try:
        result = seed_default_pages()
        logger.info("KB seed on boot: %s", result)
    except Exception:
        logger.exception("KB seed on boot failed (non-fatal)")
    finally:
        _seed_run_this_process = True


def _admin_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        if not is_app_admin(session.get("username")):
            return jsonify({"success": False, "error": "Admin access required"}), 403
        return view_func(*args, **kwargs)
    return wrapper


def _body_json() -> Dict[str, Any]:
    return request.get_json(silent=True) or {}


@knowledge_base_bp.route("/api/admin/kb/pages", methods=["GET"])
@_admin_required
def kb_list_pages():
    try:
        ensure_tables()
        # Auto-upgrade untouched pages and insert new ones on first access per boot.
        _ensure_seeded_once()
        pages = list_pages()
        categories = get_categories()
        # Trim payload: for list view we don't need fields_json / body on every row.
        trimmed = [
            {
                "slug": p["slug"],
                "title": p["title"],
                "category": p["category"],
                "icon": p["icon"],
                "description": p["description"],
                "sort_order": p["sort_order"],
                "version": p["version"],
                "updated_at": p["updated_at"],
                "updated_by": p["updated_by"],
                "tbd_count": sum(1 for f in (p["fields"] or []) if f.get("tbd")),
            }
            for p in pages
        ]
        return jsonify({
            "success": True,
            "categories": categories,
            "pages": trimmed,
        })
    except Exception as e:
        logger.exception("kb_list_pages failed")
        return jsonify({"success": False, "error": str(e)}), 500


@knowledge_base_bp.route("/api/admin/kb/pages/<slug>", methods=["GET"])
@_admin_required
def kb_get_page(slug: str):
    try:
        ensure_tables()
        _ensure_seeded_once()
        page = get_page(slug)
        if not page:
            return jsonify({"success": False, "error": "Page not found"}), 404
        return jsonify({"success": True, "page": page})
    except Exception as e:
        logger.exception("kb_get_page failed")
        return jsonify({"success": False, "error": str(e)}), 500


@knowledge_base_bp.route("/api/admin/kb/pages/<slug>", methods=["PUT"])
@_admin_required
def kb_save_page(slug: str):
    data = _body_json()
    reason = str(data.get("reason") or "").strip()
    if not reason:
        return jsonify({"success": False, "error": "A change reason is required."}), 400

    fields = data.get("fields")
    body = data.get("body_markdown")
    if fields is None and body is None:
        return jsonify({"success": False, "error": "Nothing to save."}), 400

    try:
        actor = session.get("username") or "unknown"
        updated = save_page(
            slug,
            fields=fields,
            body_markdown=body,
            reason=reason,
            actor_username=actor,
        )

        # Side effects: certain KB pages mirror into DB tables.
        side_effect: Dict[str, Any] = {}
        if slug == "special-users" and fields is not None:
            try:
                special_access.ensure_tables()
                special_list_field = next(
                    (f for f in updated.get("fields") or []
                     if f.get("name") == "special_users"),
                    None,
                )
                special_list = (special_list_field or {}).get("value") or []
                side_effect["special_sync"] = special_access.sync_from_kb(
                    special_list,
                    actor_username=actor,
                    save_reason=reason,
                )
            except Exception as sync_err:
                logger.exception("special-users sync_from_kb failed")
                side_effect["special_sync_error"] = str(sync_err)

        resp: Dict[str, Any] = {"success": True, "page": updated}
        if side_effect:
            resp["side_effect"] = side_effect
        return jsonify(resp)
    except KeyError as e:
        return jsonify({"success": False, "error": str(e)}), 404
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        logger.exception("kb_save_page failed")
        return jsonify({"success": False, "error": str(e)}), 500


@knowledge_base_bp.route("/api/admin/kb/changelog", methods=["GET"])
@_admin_required
def kb_changelog():
    slug = request.args.get("slug") or None
    try:
        limit = int(request.args.get("limit") or 100)
    except Exception:
        limit = 100
    limit = max(1, min(limit, 500))
    try:
        entries = list_changelog(slug=slug, limit=limit)
        return jsonify({"success": True, "entries": entries})
    except Exception as e:
        logger.exception("kb_changelog failed")
        return jsonify({"success": False, "error": str(e)}), 500


@knowledge_base_bp.route("/api/admin/kb/seed", methods=["POST"])
@_admin_required
def kb_seed():
    """Re-seed any missing pages. Untouched seeded pages auto-upgrade. ``force=true`` overwrites edits."""
    global _seed_run_this_process
    data = _body_json()
    force = bool(data.get("force"))
    try:
        result = seed_default_pages(force=force)
        # Mark as seeded so the once-per-process guard doesn't re-run the same
        # work on the next list call.
        _seed_run_this_process = True
        return jsonify({"success": True, "result": result})
    except Exception as e:
        logger.exception("kb_seed failed")
        return jsonify({"success": False, "error": str(e)}), 500


@knowledge_base_bp.route("/api/admin/kb/tests/<test_id>/status", methods=["PATCH"])
@_admin_required
def kb_update_test_status(test_id: str):
    """Update the status pill for one row on the Tests page.

    Body::

        {
            "status": "successful" | "unsuccessful" | "not_run",
            "notes":  "<optional markdown>"
        }

    The heavy lifting lives in
    :func:`backend.services.knowledge_base.update_test_status` — this
    endpoint is a thin validation + audit wrapper. The underlying save
    path writes a ``kb_changelog`` row so every status change is
    attributable to the clicker.
    """
    data = _body_json()
    status = str(data.get("status") or "").strip()
    notes = data.get("notes")
    if status not in TEST_STATUSES:
        return jsonify({
            "success": False,
            "error": f"Invalid status. Expected one of: {list(TEST_STATUSES)}",
        }), 400
    actor = session.get("username") or "unknown"
    try:
        row = update_test_status(test_id, status, actor_username=actor,
                                 notes=notes)
        return jsonify({"success": True, "row": row})
    except KeyError as e:
        return jsonify({"success": False, "error": str(e)}), 404
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        logger.exception("kb_update_test_status failed")
        return jsonify({"success": False, "error": str(e)}), 500


@knowledge_base_bp.route("/api/admin/kb/special-access/audit", methods=["GET"])
@_admin_required
def kb_special_access_audit():
    """Recent grants / revokes / modifications of Special access."""
    username = request.args.get("username") or None
    try:
        limit = int(request.args.get("limit") or 100)
    except Exception:
        limit = 100
    limit = max(1, min(limit, 500))
    try:
        special_access.ensure_tables()
        entries = special_access.list_audit_log(username=username, limit=limit)
        return jsonify({"success": True, "entries": entries})
    except Exception as e:
        logger.exception("kb_special_access_audit failed")
        return jsonify({"success": False, "error": str(e)}), 500


@knowledge_base_bp.route("/api/admin/kb/special-access/revoke-expired", methods=["POST"])
@_admin_required
def kb_special_access_revoke_expired():
    """Manually trigger the nightly expiry sweep (also runs from cron)."""
    try:
        result = special_access.revoke_expired()
        return jsonify({"success": True, "result": result})
    except Exception as e:
        logger.exception("kb_special_access_revoke_expired failed")
        return jsonify({"success": False, "error": str(e)}), 500
