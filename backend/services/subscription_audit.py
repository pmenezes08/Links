"""
Subscription & seat audit log.

Every state transition we care about for the Enterprise lifecycle writes a
row here:

    * personal Premium: purchased / renewed / cancelled / expired
    * IAP nag: sent / acknowledged / stopped
    * Enterprise seat: joined / left / removed_by_admin / grace_started /
                       grace_expired / community_downgraded
    * Winback: eligible / promo_sent / promo_redeemed / expired
    * Conflict resolution: personal_paused (cancel_at_period_end=True),
                           conflict_detected (IAP + seat), admin_override

This is the single source of truth the admin audit UI (Wave 7) reads, and
what the cron jobs in Wave 6 idempotently write into.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)


# Action vocabulary — keep in sync with the KB Enterprise Seat pages.
ACTIONS = {
    # personal Premium
    "personal_premium_purchased",
    "personal_premium_renewed",
    "personal_premium_cancelled",
    "personal_premium_expired",
    "personal_premium_paused_for_enterprise",
    # Community Paid Tier (Step E)
    "community_tier_purchased",
    "community_tier_renewed",
    "community_tier_updated",
    "community_tier_cancelled",
    "community_tier_past_due",
    # Platform-admin community actions
    "community_admin_deleted",
    "community_admin_frozen",
    "community_admin_unfrozen",
    "community_admin_tier_upgraded",
    "community_admin_tier_downgraded",
    "community_admin_stripe_cancelled",
    # System auto-actions (webhook + lifecycle hooks)
    "community_auto_frozen_subscription_expired",
    "community_auto_unfrozen_member_removed",
    "community_auto_unfrozen_subscription_active",
    # Enterprise seats
    "enterprise_seat_joined",
    "enterprise_seat_left",
    "enterprise_seat_removed_by_admin",
    "enterprise_seat_grace_started",
    "enterprise_seat_grace_expired",
    "enterprise_seat_community_downgraded",
    # IAP nag
    "iap_nag_sent",
    "iap_nag_acknowledged",
    "iap_nag_stopped",
    "iap_conflict_detected",
    # Winback
    "winback_eligible",
    "winback_promo_sent",
    "winback_promo_redeemed",
    "winback_promo_expired",
    # Admin overrides
    "admin_seat_end_override",
    "admin_grace_extended",
    # Usage cycle notifications (queued by cron, delivered by push/email layer)
    "usage_cycle_warning_80",
    "usage_cycle_warning_95",
}


def _utc_now_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def ensure_tables() -> None:
    """Create ``subscription_audit_log`` if missing. Idempotent."""
    with get_db_connection() as conn:
        c = conn.cursor()
        # MySQL flavour. SQLite ignores the AUTO_INCREMENT keyword in CREATE
        # TABLE IF NOT EXISTS via the compat shim upstream; keep a single
        # definition so both DBs behave the same.
        try:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS subscription_audit_log (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    username VARCHAR(191) NOT NULL,
                    action VARCHAR(64) NOT NULL,
                    source VARCHAR(32) NOT NULL,
                    community_id INT NULL,
                    community_slug VARCHAR(191) NULL,
                    actor_username VARCHAR(191) NULL,
                    reason VARCHAR(512) NULL,
                    metadata_json TEXT NULL,
                    effective_at TIMESTAMP NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_sub_audit_username (username, created_at),
                    INDEX idx_sub_audit_action (action, created_at)
                )
                """
            )
        except Exception:
            # SQLite doesn't understand INDEX-in-CREATE-TABLE; retry without.
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS subscription_audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username VARCHAR(191) NOT NULL,
                    action VARCHAR(64) NOT NULL,
                    source VARCHAR(32) NOT NULL,
                    community_id INTEGER NULL,
                    community_slug VARCHAR(191) NULL,
                    actor_username VARCHAR(191) NULL,
                    reason VARCHAR(512) NULL,
                    metadata_json TEXT NULL,
                    effective_at TIMESTAMP NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        try:
            conn.commit()
        except Exception:
            pass


def log(
    *,
    username: str,
    action: str,
    source: str = "system",
    community_id: Optional[int] = None,
    community_slug: Optional[str] = None,
    actor_username: Optional[str] = None,
    reason: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    effective_at: Optional[str] = None,
) -> None:
    """Append an audit row. Never raises — audit failures must not crash flows."""
    if action not in ACTIONS:
        logger.warning("subscription_audit.log: unknown action '%s' (continuing)", action)
    try:
        ensure_tables()
        ph = get_sql_placeholder()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""
                INSERT INTO subscription_audit_log
                    (username, action, source, community_id, community_slug,
                     actor_username, reason, metadata_json, effective_at, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                """,
                (
                    username,
                    action,
                    source,
                    community_id,
                    community_slug,
                    actor_username,
                    reason,
                    json.dumps(metadata) if metadata else None,
                    effective_at,
                    _utc_now_str(),
                ),
            )
            try:
                conn.commit()
            except Exception:
                pass
    except Exception:
        logger.exception("subscription_audit.log failed (non-fatal)")


def list_for_user(username: str, limit: int = 100) -> List[Dict[str, Any]]:
    """Return recent audit rows for a user, newest first."""
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, username, action, source, community_id, community_slug,
                   actor_username, reason, metadata_json, effective_at, created_at
            FROM subscription_audit_log
            WHERE username = {ph}
            ORDER BY created_at DESC, id DESC
            LIMIT {int(limit)}
            """,
            (username,),
        )
        rows = c.fetchall() or []
    return [_row_to_dict(r) for r in rows]


def list_recent(limit: int = 200) -> List[Dict[str, Any]]:
    """Return the most recent audit rows across all users (admin view)."""
    ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT id, username, action, source, community_id, community_slug,
                   actor_username, reason, metadata_json, effective_at, created_at
            FROM subscription_audit_log
            ORDER BY created_at DESC, id DESC
            LIMIT {int(limit)}
            """
        )
        rows = c.fetchall() or []
    return [_row_to_dict(r) for r in rows]


def _row_to_dict(r: Any) -> Dict[str, Any]:
    def g(key, idx):
        return r[key] if hasattr(r, "keys") else r[idx]
    md_raw = g("metadata_json", 8)
    try:
        metadata = json.loads(md_raw) if md_raw else None
    except Exception:
        metadata = None
    return {
        "id": g("id", 0),
        "username": g("username", 1),
        "action": g("action", 2),
        "source": g("source", 3),
        "community_id": g("community_id", 4),
        "community_slug": g("community_slug", 5),
        "actor_username": g("actor_username", 6),
        "reason": g("reason", 7),
        "metadata": metadata,
        "effective_at": str(g("effective_at", 9)) if g("effective_at", 9) else None,
        "created_at": str(g("created_at", 10)) if g("created_at", 10) else None,
    }
