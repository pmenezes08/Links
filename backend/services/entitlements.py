"""
Entitlements — compute what a user is allowed to do, right now.

Returns a flat dict of resolved values pulled from:
  1. ``users`` table                     (is_special, subscription)
  2. Knowledge Base pages                (Credits & Entitlements, Hard Limits,
                                          User Tiers, Special Users)

Tier priority (highest wins):
    SPECIAL  >  PREMIUM  >  TRIAL  >  FREE

Typical call site::

    from backend.services.entitlements import resolve_entitlements
    ent = resolve_entitlements("paulo")
    if not ent["can_use_steve"]:
        return jsonify({"error": "Upgrade to Premium"}), 402
    if ent["ai_remaining_today"] <= 0:
        return jsonify({"error": "Daily limit reached"}), 429

This service is **read-only** — it never mutates. The source of truth for
caps lives in the KB (editable by the admin); this function resolves them.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services import knowledge_base as kb
from backend.services import special_access

# Lazy-imported inside resolve_entitlements to avoid circular imports at
# module load time (enterprise_membership imports subscription_audit which
# eventually pulls knowledge_base -> entitlements through the KB page
# handlers registered at app boot).
_enterprise_membership = None


def _ent_mem():
    global _enterprise_membership
    if _enterprise_membership is None:
        try:
            from backend.services import enterprise_membership as _em
            _enterprise_membership = _em
        except Exception:
            _enterprise_membership = False  # sentinel: not available
    return _enterprise_membership or None

logger = logging.getLogger(__name__)


# Tier names (exposed for callers).
TIER_SPECIAL = "special"
TIER_PREMIUM = "premium"
TIER_TRIAL = "trial"
TIER_FREE = "free"


# Fields pulled from each KB page, with safe defaults if the KB is missing.
_DEFAULTS: Dict[str, Any] = {
    # Credits & Entitlements
    "steve_uses_per_month": 100,
    "whisper_minutes_per_month": 100,
    "monthly_spend_ceiling_eur": 3.99,
    "internal_weights": {"dm": 1, "group": 3, "feed": 3, "post_summary": 2, "voice_minute": 1},
    # Hard Limits (Premium defaults)
    "ai_daily_limit": 10,
    "max_output_tokens_dm": 600,
    "max_output_tokens_feed": 600,
    "max_output_tokens_group": 1500,
    "max_tool_invocations_per_turn": 3,
    "max_context_messages": 200,
    "max_images_per_turn": 5,
    "rpm_per_user": 10,
    "hpm_per_user": 60,
    # Special overrides
    "ai_daily_limit_special": 200,
    "monthly_spend_ceiling_eur_special": 50.0,
    "max_tool_invocations_per_turn_special": 5,
    # User Tiers
    "free_communities_max": 5,
    "premium_communities_max": 10,
    "trial_communities_max": 5,
    "members_per_owned_community": 50,
}


def _kb_field_value(page_slug: str, field_name: str, default: Any) -> Any:
    """Pluck a single field's value off a KB page, falling back to a default."""
    try:
        page = kb.get_page(page_slug)
    except Exception:
        page = None
    if not page:
        return default
    for f in page.get("fields") or []:
        if f.get("name") == field_name and "value" in f:
            return f["value"]
    return default


def _load_kb_defaults() -> Dict[str, Any]:
    """Read all the values we care about from the KB, falling back to _DEFAULTS."""
    out = dict(_DEFAULTS)

    # Credits & Entitlements
    out["steve_uses_per_month"] = int(
        _kb_field_value("credits-entitlements", "steve_uses_per_month_user_facing",
                        _DEFAULTS["steve_uses_per_month"]) or _DEFAULTS["steve_uses_per_month"]
    )
    out["whisper_minutes_per_month"] = int(
        _kb_field_value("credits-entitlements", "whisper_minutes_per_month",
                        _DEFAULTS["whisper_minutes_per_month"]) or _DEFAULTS["whisper_minutes_per_month"]
    )
    out["monthly_spend_ceiling_eur"] = float(
        _kb_field_value("credits-entitlements", "monthly_spend_ceiling_eur",
                        _DEFAULTS["monthly_spend_ceiling_eur"]) or _DEFAULTS["monthly_spend_ceiling_eur"]
    )
    weights = _kb_field_value("credits-entitlements", "internal_weights", None)
    if isinstance(weights, dict) and weights:
        out["internal_weights"] = weights

    # Hard Limits
    for k in (
        "ai_daily_limit", "max_output_tokens_dm", "max_output_tokens_feed",
        "max_output_tokens_group", "max_tool_invocations_per_turn",
        "max_context_messages", "max_images_per_turn", "rpm_per_user", "hpm_per_user",
        "ai_daily_limit_special", "max_tool_invocations_per_turn_special",
    ):
        v = _kb_field_value("hard-limits", k, _DEFAULTS[k])
        try:
            out[k] = int(v)
        except Exception:
            out[k] = _DEFAULTS[k]
    try:
        out["monthly_spend_ceiling_eur_special"] = float(
            _kb_field_value("hard-limits", "monthly_spend_ceiling_eur_special",
                            _DEFAULTS["monthly_spend_ceiling_eur_special"])
        )
    except Exception:
        out["monthly_spend_ceiling_eur_special"] = _DEFAULTS["monthly_spend_ceiling_eur_special"]

    # User Tiers
    for k in ("free_communities_max", "premium_communities_max",
              "trial_communities_max", "members_per_owned_community"):
        out[k] = int(_kb_field_value("user-tiers", k, _DEFAULTS[k]) or _DEFAULTS[k])

    return out


def _load_user(username: str) -> Optional[Dict[str, Any]]:
    """Return ``{subscription, is_special, created_at}`` for ``username``, or None."""
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                f"""
                SELECT username, subscription, is_special, created_at
                FROM users WHERE username = {ph}
                """,
                (username,),
            )
        except Exception:
            # is_special column may not exist yet on very old DBs.
            try:
                c.execute(
                    f"SELECT username, subscription, created_at FROM users WHERE username = {ph}",
                    (username,),
                )
            except Exception:
                return None
            row = c.fetchone()
            if not row:
                return None
            return {
                "username": row["username"] if hasattr(row, "keys") else row[0],
                "subscription": (row["subscription"] if hasattr(row, "keys") else row[1]) or "free",
                "is_special": False,
                "created_at": str(row["created_at"] if hasattr(row, "keys") else row[2] or ""),
            }
        row = c.fetchone()
    if not row:
        return None
    return {
        "username": row["username"] if hasattr(row, "keys") else row[0],
        "subscription": (row["subscription"] if hasattr(row, "keys") else row[1]) or "free",
        "is_special": bool(int((row["is_special"] if hasattr(row, "keys") else row[2]) or 0)),
        "created_at": str((row["created_at"] if hasattr(row, "keys") else row[3]) or ""),
    }


def _is_in_trial_window(user: Dict[str, Any], trial_days: int = 30) -> bool:
    created = (user.get("created_at") or "").strip()
    if not created:
        return False
    # Tolerate both "YYYY-MM-DD HH:MM:SS" and ISO variants.
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(created[: len(fmt) + 3 if "%f" in fmt else 19], fmt)
            break
        except Exception:
            continue
    else:
        return False
    return datetime.utcnow() - dt <= timedelta(days=trial_days)


def resolve_entitlements(username: Optional[str]) -> Dict[str, Any]:
    """Compute the full entitlements dict for ``username``.

    Always returns a dict (never raises). If the user doesn't exist, returns a
    ``tier = anonymous`` shape that denies everything.
    """
    defaults = _load_kb_defaults()

    if not username:
        return {
            "username": None,
            "tier": "anonymous",
            "can_use_steve": False,
            "can_create_communities": False,
            **defaults,
        }

    user = _load_user(username)
    if user is None:
        return {
            "username": username,
            "tier": "unknown",
            "can_use_steve": False,
            "can_create_communities": False,
            **defaults,
        }

    subscription = (user.get("subscription") or "free").strip().lower()

    # Check for an active Enterprise seat (including grace-window seats the
    # resolver still considers "premium-via-enterprise"). When present this
    # overrides a Free/Trial personal tier and lets us stamp ``inherited_from``
    # so the admin UI and Manage Membership modal show the correct origin.
    enterprise_seat = None
    em = _ent_mem()
    if em is not None:
        try:
            enterprise_seat = em.active_seat_for(username)
        except Exception:
            logger.exception("resolve_entitlements: active_seat_for failed for %s", username)
            enterprise_seat = None

    tier: str
    inherited_from: Optional[str] = None
    if user.get("is_special"):
        tier = TIER_SPECIAL
    elif subscription in ("premium", "pro", "paid"):
        tier = TIER_PREMIUM
    elif enterprise_seat is not None:
        # Seat takes precedence over Free / Trial for non-paying users.
        tier = TIER_PREMIUM
        slug = enterprise_seat.get("community_slug") or str(enterprise_seat.get("community_id") or "")
        inherited_from = f"enterprise:{slug}"
    elif _is_in_trial_window(user):
        tier = TIER_TRIAL
    else:
        tier = TIER_FREE

    # If they're personal-Premium AND on a live seat, stamp inherited_from so
    # the client can nudge them ("Premium included with Enterprise — avoid
    # double-paying"). We don't downgrade the personal plan here — that's
    # handled by the IAP nag / Stripe cancel_at_period_end flow.
    if enterprise_seat is not None and inherited_from is None and tier == TIER_PREMIUM:
        slug = enterprise_seat.get("community_slug") or str(enterprise_seat.get("community_id") or "")
        inherited_from = f"enterprise:{slug}"

    # Build the resolved entitlements based on tier.
    ent: Dict[str, Any] = {
        "username": username,
        "tier": tier,
        "subscription": subscription,
        "is_special": bool(user.get("is_special")),
        "inherited_from": inherited_from,
        "enterprise_seat": enterprise_seat,
        "internal_weights": defaults["internal_weights"],
        # Technical per-turn caps always apply (same for everyone).
        "max_output_tokens_dm": defaults["max_output_tokens_dm"],
        "max_output_tokens_feed": defaults["max_output_tokens_feed"],
        "max_output_tokens_group": defaults["max_output_tokens_group"],
        "max_context_messages": defaults["max_context_messages"],
        "max_images_per_turn": defaults["max_images_per_turn"],
    }

    if tier == TIER_SPECIAL:
        ent.update({
            "can_use_steve": True,
            "can_create_communities": True,
            "steve_uses_per_month": None,          # unlimited (business)
            "whisper_minutes_per_month": None,     # unlimited (business)
            "communities_max": None,               # unlimited (business)
            "members_per_owned_community": None,   # unlimited (business)
            # Technical safeguards still apply:
            "ai_daily_limit": defaults["ai_daily_limit_special"],
            "max_tool_invocations_per_turn": defaults["max_tool_invocations_per_turn_special"],
            "monthly_spend_ceiling_eur": defaults["monthly_spend_ceiling_eur_special"],
            "rpm_per_user": max(defaults["rpm_per_user"], 60),
            "hpm_per_user": max(defaults["hpm_per_user"], 500),
        })
    elif tier == TIER_PREMIUM:
        ent.update({
            "can_use_steve": True,
            "can_create_communities": True,
            "steve_uses_per_month": defaults["steve_uses_per_month"],
            "whisper_minutes_per_month": defaults["whisper_minutes_per_month"],
            "communities_max": defaults["premium_communities_max"],
            "members_per_owned_community": defaults["members_per_owned_community"],
            "ai_daily_limit": defaults["ai_daily_limit"],
            "max_tool_invocations_per_turn": defaults["max_tool_invocations_per_turn"],
            "monthly_spend_ceiling_eur": defaults["monthly_spend_ceiling_eur"],
            "rpm_per_user": defaults["rpm_per_user"],
            "hpm_per_user": defaults["hpm_per_user"],
        })
    elif tier == TIER_TRIAL:
        ent.update({
            "can_use_steve": True,
            "can_create_communities": True,
            "steve_uses_per_month": defaults["steve_uses_per_month"],
            "whisper_minutes_per_month": defaults["whisper_minutes_per_month"],
            "communities_max": defaults["trial_communities_max"],
            "members_per_owned_community": defaults["members_per_owned_community"],
            "ai_daily_limit": defaults["ai_daily_limit"],
            "max_tool_invocations_per_turn": defaults["max_tool_invocations_per_turn"],
            "monthly_spend_ceiling_eur": defaults["monthly_spend_ceiling_eur"],
            "rpm_per_user": defaults["rpm_per_user"],
            "hpm_per_user": defaults["hpm_per_user"],
        })
    else:  # free
        ent.update({
            "can_use_steve": False,
            "can_create_communities": True,
            "steve_uses_per_month": 0,
            "whisper_minutes_per_month": 0,
            "communities_max": defaults["free_communities_max"],
            "members_per_owned_community": defaults["members_per_owned_community"],
            "ai_daily_limit": 0,
            "max_tool_invocations_per_turn": defaults["max_tool_invocations_per_turn"],
            "monthly_spend_ceiling_eur": 0.0,
            "rpm_per_user": defaults["rpm_per_user"],
            "hpm_per_user": defaults["hpm_per_user"],
        })

    return ent


def has_steve_access(username: Optional[str]) -> bool:
    """Fast boolean helper used on the hot path of Steve endpoints."""
    if not username:
        return False
    try:
        return bool(resolve_entitlements(username).get("can_use_steve"))
    except Exception:
        # Never fail-open if the KB is broken — fail closed to prevent free use.
        return special_access.is_special(username)
