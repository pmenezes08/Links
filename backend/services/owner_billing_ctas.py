"""Owner CTA notifications for Steve Community Package billing moments.

Three owner-only triggers, all localized in the RECIPIENT's locale via
:mod:`notification_copy`, all delivered as an in-app row + push, all
audited through :mod:`subscription_audit`, all deep-linking to the
add-on panel (``/subscription_plans?open=community_addons&community_id=…``):

1. **Trial lifecycle** (:func:`run_trial_lifecycle_sweep`, driven by the
   ``/api/cron/steve-trial-lifecycle`` cron): synthetic Steve-package
   trials (``trial_pkg_<id>`` / ``trialing``) get one "ending soon"
   notification when the period end is within the next
   :data:`TRIAL_ENDING_WINDOW_DAYS` days, and one "trial ended"
   notification once the period end is in the past. Idempotent per
   community forever — the ``subscription_audit_log`` row is the dedup
   marker (audit-first, at-most-once).

2. **Member blocked in a paid, package-less community**
   (:func:`notify_member_blocked`): fired best-effort from the
   entitlements gate's ``premium_required`` deny path when the community
   sits on a paid tier without an active Steve Community Package and the
   denied user is not the owner. Capped at once per community per 7 days
   via :mod:`rate_limit`. The copy never names the blocked member.

3. **Pool exhausted** (:func:`notify_pool_exhausted`): fired best-effort
   from the ``community_pool_exhausted`` deny path when the denied user
   is not the owner. Once per community per billing-cycle month (the
   rate-limit identity embeds ``YYYY-MM``).

Fail-open discipline: triggers 2 and 3 are side-channels off the hot
deny path of the gate — they must NEVER raise into the caller, and a
Redis blip degrades to "maybe one duplicate ping", never to "the gate
breaks". Kill switch: ``OWNER_BILLING_CTAS_ENABLED`` (default on).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from backend.services import community as community_svc
from backend.services import community_billing
from backend.services import notification_copy
from backend.services import rate_limit
from backend.services import subscription_audit
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.feature_flags import is_enabled

logger = logging.getLogger(__name__)

# Client-facing notification types (rendered as CTA cards by the client).
NOTIF_TRIAL_ENDING = "owner_cta:steve_trial_ending"
NOTIF_TRIAL_EXPIRED = "owner_cta:steve_trial_expired"
NOTIF_MEMBER_BLOCKED = "owner_cta:steve_member_blocked"
NOTIF_POOL_EXHAUSTED = "owner_cta:steve_pool_exhausted"

# subscription_audit actions (registered in subscription_audit.ACTIONS).
AUDIT_TRIAL_ENDING = "owner_cta_steve_trial_ending"
AUDIT_TRIAL_EXPIRED = "owner_cta_steve_trial_expired"
AUDIT_MEMBER_BLOCKED = "owner_cta_steve_member_blocked"
AUDIT_POOL_EXHAUSTED = "owner_cta_steve_pool_exhausted"

# i18n event names under ``notifications.*`` (title/body/message each).
_COPY_EVENTS = {
    NOTIF_TRIAL_ENDING: "owner_cta_steve_trial_ending",
    NOTIF_TRIAL_EXPIRED: "owner_cta_steve_trial_expired",
    NOTIF_MEMBER_BLOCKED: "owner_cta_steve_member_blocked",
    NOTIF_POOL_EXHAUSTED: "owner_cta_steve_pool_exhausted",
}

TRIAL_ENDING_WINDOW_DAYS = 3
MEMBER_BLOCKED_WINDOW_SECONDS = 7 * 24 * 3600
# Identity embeds YYYY-MM, so the long window only guards against
# boundary double-fires inside the same month.
POOL_EXHAUSTED_WINDOW_SECONDS = 35 * 24 * 3600

_PAID_TIERS = (
    community_svc.COMMUNITY_TIER_PAID_L1,
    community_svc.COMMUNITY_TIER_PAID_L2,
    community_svc.COMMUNITY_TIER_PAID_L3,
)


def _enabled() -> bool:
    """Kill switch — default ON; flip OWNER_BILLING_CTAS_ENABLED=false to mute."""
    return is_enabled("OWNER_BILLING_CTAS_ENABLED", default=True)


def _addon_url(community_id: int) -> str:
    return f"/subscription_plans?open=community_addons&community_id={int(community_id)}"


def _parse_dt(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw
    s = str(raw).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[: len("2000-01-01 00:00:00")], fmt)
        except ValueError:
            continue
    return None


def _send_owner_cta(
    *,
    owner: str,
    community_id: int,
    community_name: str,
    notification_type: str,
    audit_action: str,
    source: str,
    params: Optional[Dict[str, Any]] = None,
    triggered_by: Optional[str] = None,
) -> bool:
    """Audit + in-app row + push, in the owner's locale. Audit-first so a
    Scheduler retry after a push failure never double-sends (at-most-once)."""
    from backend.services.notifications import (
        create_notification,
        send_push_to_user,
        truncate_notification_preview,
    )

    event = _COPY_EVENTS[notification_type]
    locale = notification_copy.recipient_locale(owner)
    url = _addon_url(community_id)
    copy_params = {"community": community_name, **(params or {})}

    metadata: Dict[str, Any] = {"community_name": community_name}
    if triggered_by:
        # Audit metadata only (admin surface) — NEVER surfaced to the owner.
        metadata["triggered_by"] = triggered_by
    subscription_audit.log(
        username=owner,
        action=audit_action,
        source=source,
        community_id=int(community_id),
        metadata=metadata,
    )

    message = notification_copy.in_app_text(event, locale, **copy_params)
    # Billing CTAs are system/app-chrome, never Steve's voice — the
    # monetization invariant. Same attribution as community_admin_notifications.
    create_notification(
        owner,
        "admin",
        notification_type,
        community_id=int(community_id),
        message=message,
        link=url,
        preview_text=truncate_notification_preview(message, 160),
    )
    try:
        payload = notification_copy.push_payload(event, locale, **copy_params)
        send_push_to_user(
            owner,
            {
                "title": payload["title"],
                "body": payload["body"],
                "url": url,
                "tag": f"owner-cta-{event}-{int(community_id)}",
            },
        )
    except Exception:
        # In-app row + audit already landed; a lost push is acceptable.
        logger.warning(
            "owner CTA push failed (in-app row kept): owner=%s community=%s type=%s",
            owner, community_id, notification_type, exc_info=True,
        )
    return True


# ── Trigger 1 — trial lifecycle sweep (cron) ────────────────────────────


def _audit_exists(cursor, action: str, community_id: int) -> bool:
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"""
            SELECT 1 FROM subscription_audit_log
            WHERE action = {ph} AND community_id = {ph}
            LIMIT 1
            """,
            (action, int(community_id)),
        )
        return cursor.fetchone() is not None
    except Exception:
        # Table missing (first ever run) — treat as "not sent yet"; the
        # audit write below creates it via subscription_audit.ensure_tables.
        return False


def run_trial_lifecycle_sweep(*, dry_run: bool = False, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Sweep synthetic Steve-package trials and notify owners once each.

    * period_end in the future but within :data:`TRIAL_ENDING_WINDOW_DAYS`
      days → ``owner_cta:steve_trial_ending`` (once per community ever)
    * period_end in the past → ``owner_cta:steve_trial_expired``
      (once per community ever)
    """
    result: Dict[str, Any] = {
        "success": True,
        "dry_run": dry_run,
        "scanned": 0,
        "ending_soon_sent": 0,
        "expired_sent": 0,
        "skipped_already_sent": 0,
        "skipped_not_due": 0,
        "errors": 0,
    }
    if not _enabled():
        result["skipped"] = True
        result["reason"] = "owner_billing_ctas_disabled"
        return result

    now = now or datetime.utcnow()
    window_end = now + timedelta(days=TRIAL_ENDING_WINDOW_DAYS)
    trial_prefix = community_billing.STEVE_PACKAGE_TRIAL_SUB_PREFIX

    try:
        subscription_audit.ensure_tables()
    except Exception:
        pass

    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT id, name, creator_username,
                       steve_package_stripe_subscription_id,
                       steve_package_current_period_end
                FROM communities
                WHERE parent_community_id IS NULL
                  AND steve_package_stripe_subscription_id LIKE '{trial_prefix}%'
                  AND LOWER(COALESCE(steve_package_subscription_status, '')) = 'trialing'
                  AND steve_package_current_period_end IS NOT NULL
                """
            )
            rows = c.fetchall() or []
        except Exception:
            logger.exception("steve trial lifecycle sweep: candidate query failed")
            result["success"] = False
            result["error"] = "query_failed"
            return result

        for r in rows:
            def _g(key: str, idx: int) -> Any:
                return r[key] if hasattr(r, "keys") else r[idx]

            sub_id = str(_g("steve_package_stripe_subscription_id", 3) or "")
            if not sub_id.startswith(trial_prefix):
                continue  # LIKE '_' wildcard false positive — never a trial
            result["scanned"] += 1

            cid = int(_g("id", 0))
            name = str(_g("name", 1) or "this community")
            owner = str(_g("creator_username", 2) or "").strip()
            period_end = _parse_dt(_g("steve_package_current_period_end", 4))
            if not owner or period_end is None:
                continue

            if period_end <= now:
                notif_type, audit_action, counter = (
                    NOTIF_TRIAL_EXPIRED, AUDIT_TRIAL_EXPIRED, "expired_sent",
                )
            elif period_end <= window_end:
                notif_type, audit_action, counter = (
                    NOTIF_TRIAL_ENDING, AUDIT_TRIAL_ENDING, "ending_soon_sent",
                )
            else:
                result["skipped_not_due"] += 1
                continue

            if _audit_exists(c, audit_action, cid):
                result["skipped_already_sent"] += 1
                continue
            if dry_run:
                result[counter] += 1
                continue

            try:
                _send_owner_cta(
                    owner=owner,
                    community_id=cid,
                    community_name=name,
                    notification_type=notif_type,
                    audit_action=audit_action,
                    source="cron",
                    params={"date": period_end.strftime("%Y-%m-%d")},
                )
                result[counter] += 1
            except Exception:
                logger.exception(
                    "steve trial lifecycle notify failed: community=%s type=%s",
                    cid, notif_type,
                )
                result["errors"] += 1

    return result


# ── Triggers 2 + 3 — gate deny-path side-channels (fail-open) ───────────


def _owner_context(community_id: int) -> Optional[Dict[str, Any]]:
    from backend.services.community_admin_notifications import get_community_context

    return get_community_context(int(community_id))


def notify_member_blocked(community_id: int, denied_username: str) -> bool:
    """Owner ping when a member hits ``premium_required`` in a paid,
    package-less community. Fail-open: never raises into the gate."""
    try:
        if not community_id or not _enabled():
            return False
        from backend.services.feature_flags import entitlements_enforcement_enabled

        if not entitlements_enforcement_enabled():
            return False  # nobody is actually blocked while the flag is off

        root_id, _ = community_svc.resolve_root_community_id(int(community_id))
        state = community_billing.get_billing_state(root_id) or {}
        if state.get("tier") not in _PAID_TIERS:
            return False  # free/enterprise communities keep the default pitch
        if state.get("steve_package_subscription_active"):
            return False  # package already live — nothing to sell

        ctx = _owner_context(root_id) or {}
        owner = str(ctx.get("owner_username") or "").strip()
        denied = str(denied_username or "").strip().lstrip("@")
        if not owner or not denied:
            return False
        if denied.lower() == owner.lstrip("@").lower():
            return False  # the owner's own denial already shows the CTA inline

        if not rate_limit.allow(
            AUDIT_MEMBER_BLOCKED,
            str(int(root_id)),
            max_events=1,
            window_seconds=MEMBER_BLOCKED_WINDOW_SECONDS,
        ):
            return False

        return _send_owner_cta(
            owner=owner,
            community_id=int(root_id),
            community_name=str(ctx.get("community_name") or "this community"),
            notification_type=NOTIF_MEMBER_BLOCKED,
            audit_action=AUDIT_MEMBER_BLOCKED,
            source="steve_gate",
            triggered_by=denied,
        )
    except Exception:
        logger.warning(
            "notify_member_blocked failed (non-fatal) for community %s",
            community_id, exc_info=True,
        )
        return False


def notify_pool_exhausted(community_id: int, denied_username: str) -> bool:
    """Owner ping when the shared Steve pool blocks a member — once per
    community per billing-cycle month. Fail-open: never raises into the gate."""
    try:
        if not community_id or not _enabled():
            return False
        from backend.services.feature_flags import entitlements_enforcement_enabled

        if not entitlements_enforcement_enabled():
            return False

        root_id, _ = community_svc.resolve_root_community_id(int(community_id))
        ctx = _owner_context(root_id) or {}
        owner = str(ctx.get("owner_username") or "").strip()
        denied = str(denied_username or "").strip().lstrip("@")
        if not owner or not denied:
            return False
        if denied.lower() == owner.lstrip("@").lower():
            return False

        cycle = datetime.utcnow().strftime("%Y-%m")
        if not rate_limit.allow(
            AUDIT_POOL_EXHAUSTED,
            f"{int(root_id)}:{cycle}",
            max_events=1,
            window_seconds=POOL_EXHAUSTED_WINDOW_SECONDS,
        ):
            return False

        return _send_owner_cta(
            owner=owner,
            community_id=int(root_id),
            community_name=str(ctx.get("community_name") or "this community"),
            notification_type=NOTIF_POOL_EXHAUSTED,
            audit_action=AUDIT_POOL_EXHAUSTED,
            source="steve_gate",
            triggered_by=denied,
        )
    except Exception:
        logger.warning(
            "notify_pool_exhausted failed (non-fatal) for community %s",
            community_id, exc_info=True,
        )
        return False
