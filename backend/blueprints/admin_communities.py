"""Admin community directory (all communities, admins, billing snapshot)."""

from __future__ import annotations

import logging
from functools import wraps
from typing import Any, Dict, List

from flask import Blueprint, jsonify, session

from backend.services import admin_tenant_scope
from backend.services.community import is_app_admin
from backend.services.database import get_db_connection

logger = logging.getLogger(__name__)

admin_communities_bp = Blueprint("admin_communities", __name__)


def _admin_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        username = session.get("username")
        if not username:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        if not is_app_admin(str(username)):
            return jsonify({"success": False, "error": "Admin access required"}), 403
        return view_func(*args, **kwargs)

    return wrapper


def _row_dict(row: Any, keys: List[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if hasattr(row, "keys"):
        for k in keys:
            out[k] = row[k] if k in row.keys() else None
        return out
    if isinstance(row, dict):
        for k in keys:
            out[k] = row.get(k)
        return out
    # Tuple positional fallback (legacy drivers)
    for i, k in enumerate(keys):
        out[k] = row[i] if isinstance(row, (list, tuple)) and len(row) > i else None
    return out


@admin_communities_bp.route("/api/admin/communities/directory", methods=["GET"])
@_admin_required
def api_admin_communities_directory():
    """List communities with member counts, sub-community counts, admins, tier."""
    try:
        tf, tp = admin_tenant_scope.communities_table_tenant_sql("tenant_id")
        sql_main = f"""
            SELECT
                c.id,
                c.name,
                c.type,
                c.creator_username,
                c.parent_community_id,
                COALESCE(c.tier, 'free') AS tier,
                c.subscription_status,
                c.stripe_customer_id,
                c.stripe_subscription_id,
                c.current_period_end,
                c.cancel_at_period_end,
                c.canceled_at,
                (
                    SELECT COUNT(*) FROM user_communities uc
                    WHERE uc.community_id = c.id
                ) AS member_count,
                (
                    SELECT COUNT(*) FROM communities ch
                    WHERE ch.parent_community_id = c.id
                ) AS direct_child_count
            FROM communities c
            WHERE 1 = 1{tf}
            ORDER BY c.name ASC
        """
        admin_sql = f"""
            SELECT ca.community_id, ca.username
            FROM community_admins ca
            INNER JOIN communities c ON c.id = ca.community_id
            WHERE 1 = 1{tf}
            ORDER BY ca.username ASC
        """

        admins_by_cid: Dict[int, List[str]] = {}
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(sql_main, tp)
            rows_main = c.fetchall() or []
            try:
                c.execute(admin_sql, tp)
                for row in c.fetchall() or []:
                    rcid = row["community_id"] if hasattr(row, "keys") else row[0]
                    uname = row["username"] if hasattr(row, "keys") else row[1]
                    if rcid is None or not uname:
                        continue
                    cid_i = int(rcid)
                    if cid_i not in admins_by_cid:
                        admins_by_cid[cid_i] = []
                    admins_by_cid[cid_i].append(str(uname))
            except Exception:
                logger.exception("community_admins join failed; returning empty admin lists")

        keys = [
            "id",
            "name",
            "type",
            "creator_username",
            "parent_community_id",
            "tier",
            "subscription_status",
            "stripe_customer_id",
            "stripe_subscription_id",
            "current_period_end",
            "cancel_at_period_end",
            "canceled_at",
            "member_count",
            "direct_child_count",
        ]
        communities: List[Dict[str, Any]] = []
        for row in rows_main:
            d = _row_dict(row, keys)
            cid = int(d["id"])
            d["member_count"] = int(d["member_count"] or 0)
            d["direct_child_count"] = int(d["direct_child_count"] or 0)
            cape = d.get("cancel_at_period_end")
            d["cancel_at_period_end"] = bool(cape) if cape is not None else False
            cpe = d.get("current_period_end")
            if cpe is not None:
                d["current_period_end"] = str(cpe)
            cat = d.get("canceled_at")
            if cat is not None:
                d["canceled_at"] = str(cat)
            d["admin_usernames"] = admins_by_cid.get(cid, [])
            communities.append(d)

        return jsonify({"success": True, "communities": communities})
    except Exception as exc:
        logger.exception("api_admin_communities_directory failed: %s", exc)
        return jsonify({"success": False, "error": str(exc)}), 500
