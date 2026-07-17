"""Owner upgrade-prompt eligibility + dismissal (server-side decision).

Backend for the owner upgrade surface ("Grow your community" page /
interstitial): decides WHO may see the pitch and carries the evidence
numbers, so the client stays dumb. Consumed by
``backend/blueprints/owner_upgrade.py``.

Eligibility is an authorization + policy decision made HERE, never in the
client:

* **Owner-only, non-enumerating** — only the billing root's owner (or an
  app admin) via ``community.can_manage_community``; everyone else gets
  ``None`` and the blueprint returns the same closed 404 a missing
  community would. Delegated admins never see the surface — they can't
  act on billing.
* **Root-normalized** — billing lives on the root; a sub-community id
  resolves to its root before any check.
* **Free tier only** — paid/enterprise roots are not eligible (a later
  higher-tier upsell is a different surface).
* **Durable dismiss** — ``communities.owner_upgrade_prompt_dismissed_at``
  (schema via ``client_ui_flags.ensure_community_ui_columns``), never
  localStorage: "don't show again" must survive devices and reinstalls.
* **Frequency window** — the interstitial shows at most once per
  :data:`INTERSTITIAL_WINDOW_DAYS` per owner, keyed on the owner's own
  ``upgrade_page_shown`` retention events so measurement and gating share
  one record. Hard-block moments (owner literally blocked at the member
  cap) may bypass the window client-side — being blocked is not a nudge.

Stats policy (privacy + honesty): aggregates only, never member names;
weak numbers are floored to zero-evidence server-side rather than
rendered as anti-evidence (a "3 of 25 seats" stat argues against
upgrading — the client hides what isn't sent).
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

from backend.services import client_ui_flags
from backend.services import community as community_svc
from backend.services import community_billing
from backend.services import retention_events
from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

INTERSTITIAL_WINDOW_DAYS = 14

# Stats floors — below these the number is withheld (evidence, not decor).
MIN_BLOCKED_MEMBERS_TO_SHOW = 2


def _root_for(community_id: int) -> int:
    rid, _ = community_svc.resolve_root_community_id(int(community_id))
    return int(rid)


def _community_row(root_id: int) -> Optional[Dict[str, Any]]:
    """Name + dismissed flag for the root community, None when missing."""
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            client_ui_flags.ensure_community_ui_columns(c)
            c.execute(
                f"""
                SELECT name, owner_upgrade_prompt_dismissed_at
                FROM communities WHERE id = {ph}
                """,
                (root_id,),
            )
            row = c.fetchone()
            if not row:
                return None

            def _g(key: str, idx: int) -> Any:
                return row[key] if hasattr(row, "keys") else row[idx]

            members = community_svc._count_community_members(c, root_id)
            return {
                "name": str(_g("name", 0) or ""),
                "dismissed_at": _g("owner_upgrade_prompt_dismissed_at", 1),
                "members": int(members),
            }
    except Exception:
        logger.exception("owner_upgrade_prompt: community row read failed for %s", root_id)
        return None


def get_state(username: str, community_id: int) -> Optional[Dict[str, Any]]:
    """Eligibility + evidence payload, or ``None`` for "closed door".

    ``None`` means the blueprint must answer with the non-enumerating 404 —
    missing community and not-your-community are indistinguishable.
    """
    if not username or not community_id:
        return None
    try:
        root_id = _root_for(community_id)
    except Exception:
        return None
    if not community_svc.can_manage_community(username, root_id):
        return None

    row = _community_row(root_id)
    if row is None:
        return None

    state = community_billing.get_billing_state(root_id) or {}
    tier = str(state.get("tier") or "free")
    dismissed_at = row["dismissed_at"]

    eligible = True
    reason: Optional[str] = None
    if tier != community_svc.COMMUNITY_TIER_FREE:
        eligible, reason = False, "not_free_tier"
    elif dismissed_at:
        eligible, reason = False, "dismissed"

    # Frequency window — a recent impression closes the *interstitial*
    # only; the voluntary path (plans page, ManageMembershipModal) is
    # never gated by this.
    recently_shown = retention_events.recently_recorded(
        username,
        event_type="upgrade_page_shown",
        within_days=INTERSTITIAL_WINDOW_DAYS,
    )

    member_cap = community_svc._read_kb_free_community_cap() or 25
    members = row["members"]

    from backend.services import ai_usage

    blocked = ai_usage.community_blocked_steve_members_30d(root_id)

    trial_days = community_billing.community_tier_trial_days(username)

    return {
        "community_id": root_id,
        "community_name": row["name"],
        "tier": tier,
        "eligible": eligible,
        "reason": reason,
        "interstitial_allowed": bool(eligible and not recently_shown),
        "dismissed": bool(dismissed_at),
        "stats": {
            "members": members,
            "member_cap": int(member_cap),
            # Same >=80% threshold the Owner Dashboard uses.
            "cap_warning": bool(member_cap and members >= 0.8 * member_cap),
            # Floored: 1 blocked member is noise, not demand evidence.
            "blocked_steve_members_30d": (
                blocked if blocked >= MIN_BLOCKED_MEMBERS_TO_SHOW else 0
            ),
        },
        "trial_eligible": trial_days > 0,
        "trial_days": trial_days,
    }


def dismiss(username: str, community_id: int) -> Optional[bool]:
    """Durably dismiss the prompt for this root. ``None`` = closed door,
    ``True`` = dismissed (idempotent)."""
    if not username or not community_id:
        return None
    try:
        root_id = _root_for(community_id)
    except Exception:
        return None
    if not community_svc.can_manage_community(username, root_id):
        return None

    ph = get_sql_placeholder()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            client_ui_flags.ensure_community_ui_columns(c)
            c.execute(
                f"""
                UPDATE communities
                SET owner_upgrade_prompt_dismissed_at = {ph}
                WHERE id = {ph} AND owner_upgrade_prompt_dismissed_at IS NULL
                """,
                (now, root_id),
            )
            conn.commit()
        return True
    except Exception:
        logger.exception("owner_upgrade_prompt: dismiss failed for %s", root_id)
        return None
