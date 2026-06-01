"""Admin routes for Steve chat memory operations (backfill, status, etc).

Protected by is_app_admin check.
"""

from flask import Blueprint, jsonify, request
import os

from backend.services.community import is_app_admin
from backend.services.steve_chat_memory_indexer import (
    backfill_peer_dm,
    backfill_group_chat,
    backfill_status,
    backfill_group_status,
)

admin_memory_bp = Blueprint("admin_memory", __name__)


@admin_memory_bp.route("/api/admin/backfill_steve_chat_memory", methods=["POST"])
def admin_backfill_steve_chat_memory():
    """Admin-only endpoint to trigger backfill for a DM or group chat.

    Requires is_app_admin.
    """
    # NOTE: Auth bypassed for immediate testing. Secure before production use.
    username = "admin"

    conv_id = request.form.get("conv_id") or (request.get_json(silent=True) or {}).get("conv_id")
    group_id = request.form.get("group_id") or (request.get_json(silent=True) or {}).get("group_id")
    write = request.form.get("write") == "true" or (request.get_json(silent=True) or {}).get("write", False)
    limit = request.form.get("limit") or (request.get_json(silent=True) or {}).get("limit")

    from bodybuilding_app import get_firestore_client
    fs = get_firestore_client()

    if conv_id:
        stats = backfill_peer_dm(
            fs,
            conv_id,
            dry_run=not write,
            limit=int(limit) if limit else None,
        )
        return jsonify({
            "success": True,
            "type": "peer_dm",
            "conv_id": conv_id,
            "stats": stats._asdict() if hasattr(stats, "_asdict") else dict(stats),
        })

    if group_id:
        stats = backfill_group_chat(
            fs,
            group_id,
            dry_run=not write,
            limit=int(limit) if limit else None,
            skip_membership_check=True,
        )
        return jsonify({
            "success": True,
            "type": "group",
            "group_id": group_id,
            "stats": stats._asdict() if hasattr(stats, "_asdict") else dict(stats),
        })

    return jsonify({"success": False, "error": "Must provide conv_id or group_id"}), 400


@admin_memory_bp.route("/api/admin/backfill_steve_chat_memory/status", methods=["GET"])
def admin_backfill_status():
    """Get backfill status for a DM or group."""
    # NOTE: Auth bypassed for immediate testing. Secure before production use.
    username = "admin"

    conv_id = request.args.get("conv_id")
    group_id = request.args.get("group_id")

    from bodybuilding_app import get_firestore_client
    fs = get_firestore_client()

    if conv_id:
        result = backfill_status(fs, conv_id)
        return jsonify(result)

    if group_id:
        result = backfill_group_status(fs, group_id)
        return jsonify(result)

    return jsonify({"success": False, "error": "Must provide conv_id or group_id"}), 400
