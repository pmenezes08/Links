"""B2B access gate for Steve networking (people-search).

Networking is gated to communities with an active Steve Package: paid or on
the synthetic 14-day trial. The gate decides *whether* a member may search and
*which* weekly cap applies (a small trial cap vs the full paid cap). It does not
count usage itself — the route owns the per-user rolling-7-day counter — so this
stays a pure, testable policy function with injectable dependencies.

Decision modes returned by ``networking_gate_decision``:
  - ``exempt``      — app admin / founder / Special tier: allow, no cap.
  - ``no_package``  — the searched community's root has no active Steve Package
                      (and the KB requires one): block with reason
                      ``steve_package_required``.
  - ``cap``         — apply ``effective_cap`` (trial vs paid); ``in_trial`` says
                      which, so the route can pick the denial reason/copy.

The package requirement is itself KB-toggleable (``requires_steve_package`` on
the networking-ai page) so the B2B gate can be turned off without a deploy.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

MODE_EXEMPT = "exempt"
MODE_NO_PACKAGE = "no_package"
MODE_CAP = "cap"

REASON_PACKAGE_REQUIRED = "steve_package_required"
REASON_WEEKLY_CAP = "weekly_networking_prompt_cap"
REASON_TRIAL_CAP = "networking_trial_cap"


def networking_gate_decision(
    username: Optional[str],
    community_id: Any,
    config: Any,
    *,
    billing: Any = None,
    exempt_fn: Any = None,
) -> Dict[str, Any]:
    """Decide networking access for ``username`` searching within ``community_id``.

    ``config`` is a NetworkingAiConfig. ``billing``/``exempt_fn`` are injectable
    for tests; production lazy-imports the real services.

    Returns one of:
      {"mode": "exempt"}
      {"mode": "no_package"}
      {"mode": "cap", "effective_cap": int, "in_trial": bool}
    """
    # Admin / founder / Special bypass the package requirement AND the cap — the
    # same unlimited-business intent as everywhere else Special applies.
    if exempt_fn is None:
        from backend.services.networking_ai_config import networking_cap_exempt as exempt_fn
    try:
        if exempt_fn(username):
            return {"mode": MODE_EXEMPT}
    except Exception:
        logger.warning("networking_gate_decision: exempt check failed for %s", username, exc_info=True)

    # B2B gate can be disabled from the KB — then everyone falls through to the
    # paid weekly cap (legacy behaviour).
    if not getattr(config, "requires_steve_package", True):
        return {"mode": MODE_CAP, "effective_cap": int(config.weekly_prompts_per_user), "in_trial": False}

    if billing is None:
        from backend.services import community_billing as billing

    # get_billing_state root-normalizes internally, so the child community_id the
    # route received resolves to the billing root's package state. Fail closed
    # (treat as no package) on error — a revenue gate must not open on a blip,
    # and a billing-table read failure breaks the whole route anyway.
    try:
        state = billing.get_billing_state(community_id) or {}
    except Exception:
        logger.warning("networking_gate_decision: billing read failed for community %s", community_id, exc_info=True)
        state = {}

    if not state.get("steve_package_subscription_active"):
        return {"mode": MODE_NO_PACKAGE}

    # Trial vs paid: the synthetic 14-day taster reports status "trialing" with a
    # "trial_pkg_" id. Prefer the explicit synthetic check so a future real Stripe
    # trial isn't accidentally treated as our taster.
    in_trial = str(state.get("steve_package_subscription_status") or "").lower() == "trialing"
    try:
        if billing.is_synthetic_steve_package_trial(state):
            in_trial = True
    except Exception:
        pass

    effective_cap = (
        int(config.trial_weekly_prompts_per_user)
        if in_trial
        else int(config.weekly_prompts_per_user)
    )
    return {"mode": MODE_CAP, "effective_cap": effective_cap, "in_trial": in_trial}
