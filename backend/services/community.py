"""Community-related helper utilities shared across the backend."""

from __future__ import annotations

import logging
from collections import deque
from typing import Any, Dict, List, Optional, Set, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder


logger = logging.getLogger(__name__)


_COMMUNITY_DEPENDENT_TABLES: List[Tuple[str, str]] = [
    ("post_views", "post_id IN (SELECT id FROM posts WHERE community_id = {ph})"),
    ("key_posts", "community_id = {ph}"),
    ("community_key_posts", "community_id = {ph}"),
    ("comments", "post_id IN (SELECT id FROM posts WHERE community_id = {ph})"),
    ("reactions", "post_id IN (SELECT id FROM posts WHERE community_id = {ph})"),
    ("reply_reactions", "reply_id IN (SELECT id FROM replies WHERE community_id = {ph})"),
    ("replies", "community_id = {ph}"),
    (
        "poll_votes",
        "poll_id IN (SELECT id FROM polls WHERE post_id IN "
        "(SELECT id FROM posts WHERE community_id = {ph}))",
    ),
    (
        "poll_options",
        "poll_id IN (SELECT id FROM polls WHERE post_id IN "
        "(SELECT id FROM posts WHERE community_id = {ph}))",
    ),
    ("polls", "post_id IN (SELECT id FROM posts WHERE community_id = {ph})"),
    ("posts", "community_id = {ph}"),
    (
        "event_rsvps",
        "event_id IN (SELECT id FROM calendar_events WHERE community_id = {ph})",
    ),
    (
        "event_invitations",
        "event_id IN (SELECT id FROM calendar_events WHERE community_id = {ph})",
    ),
    ("calendar_events", "community_id = {ph}"),
    (
        "community_story_reactions",
        "story_id IN (SELECT id FROM community_stories WHERE community_id = {ph})",
    ),
    (
        "community_story_comments",
        "story_id IN (SELECT id FROM community_stories WHERE community_id = {ph})",
    ),
    (
        "community_story_views",
        "story_id IN (SELECT id FROM community_stories WHERE community_id = {ph})",
    ),
    ("community_stories", "community_id = {ph}"),
    (
        "resource_upvotes",
        "post_id IN (SELECT id FROM resource_posts WHERE community_id = {ph}) "
        "OR comment_id IN (SELECT rc.id FROM resource_comments rc "
        "JOIN resource_posts rp ON rp.id = rc.post_id WHERE rp.community_id = {ph})",
    ),
    (
        "resource_comments",
        "post_id IN (SELECT id FROM resource_posts WHERE community_id = {ph})",
    ),
    ("resource_posts", "community_id = {ph}"),
    ("user_communities", "community_id = {ph}"),
    ("community_admins", "community_id = {ph}"),
    ("community_announcements", "community_id = {ph}"),
    ("community_files", "community_id = {ph}"),
    ("community_invites", "community_id = {ph}"),
    ("community_billing", "community_id = {ph}"),
    ("user_muted_communities", "community_id = {ph}"),
]

_COMMUNITY_DIRECT_DEPENDENT_TABLES = {
    table for table, where in _COMMUNITY_DEPENDENT_TABLES
    if where == "community_id = {ph}"
}

_FK_NAME_MAX_LEN = 64


# ── Community tier taxonomy ────────────────────────────────────────────
#
# These mirror the five groups on the ``community-tiers`` KB page. Stored
# in ``communities.tier`` as a free-form string (we don't fight MySQL's
# ENUM vs. VARCHAR semantics), but normalized through ``_normalize_tier``
# at every read site so "Paid L1", "paid_l1", "  PAID-L1 " all collapse
# to the same constant.
COMMUNITY_TIER_FREE = "free"
COMMUNITY_TIER_PAID_L1 = "paid_l1"
COMMUNITY_TIER_PAID_L2 = "paid_l2"
COMMUNITY_TIER_PAID_L3 = "paid_l3"
COMMUNITY_TIER_ENTERPRISE = "enterprise"

_COMMUNITY_TIERS = {
    COMMUNITY_TIER_FREE,
    COMMUNITY_TIER_PAID_L1,
    COMMUNITY_TIER_PAID_L2,
    COMMUNITY_TIER_PAID_L3,
    COMMUNITY_TIER_ENTERPRISE,
}

# KB field names that hold the member cap per tier. Free communities are
# handled by ``ensure_free_parent_member_capacity`` via the owner's user
# tier, so we deliberately don't map ``free`` here — the tier helper
# short-circuits on ``free`` to avoid double-enforcement.
_TIER_CAP_KB_FIELD = {
    COMMUNITY_TIER_PAID_L1: "paid_l1_max_members",
    COMMUNITY_TIER_PAID_L2: "paid_l2_max_members",
    COMMUNITY_TIER_PAID_L3: "paid_l3_max_members",
}

# Legacy hard fallbacks in case the KB lookup fails catastrophically.
# These match the current KB defaults; they only activate when the KB
# table is unavailable (first boot, migration window).
_TIER_CAP_FALLBACK = {
    COMMUNITY_TIER_PAID_L1: 75,
    COMMUNITY_TIER_PAID_L2: 150,
    COMMUNITY_TIER_PAID_L3: 250,
}

_TIER_DISPLAY_LABEL = {
    COMMUNITY_TIER_FREE: "Free",
    COMMUNITY_TIER_PAID_L1: "Paid L1",
    COMMUNITY_TIER_PAID_L2: "Paid L2",
    COMMUNITY_TIER_PAID_L3: "Paid L3",
    COMMUNITY_TIER_ENTERPRISE: "Enterprise",
}


def _normalize_tier(value: Any) -> Optional[str]:
    """Return a canonical tier key or ``None`` for unset / unrecognised values."""
    if value is None:
        return None
    text = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    if not text:
        return None
    # Collapse common variants without being permissive about typos.
    if text in _COMMUNITY_TIERS:
        return text
    return None


# ── Free-tier membership-cap enforcement ────────────────────────────────
#
# The exception + helper below were lifted out of ``bodybuilding_app.py``
# as part of the Phase 1 refactor (April 2026). They are imported back
# into the monolith via a shim so the three existing call sites
# (``add_user_to_community``, the subcommunity adder, and the
# ``/create_community`` free-tier gate) keep working without edits.


class CommunityMembershipLimitError(Exception):
    """Raised when a community has exhausted its per-tier member cap.

    The exception carries structured context so route handlers can render
    tier-appropriate copy (owner vs. invitee) without relying on the
    plain-text ``str()`` form — which was previously being returned
    verbatim to the client and leaked "Upgrade" CTAs to users who aren't
    the owner and can't act on them.
    """

    def __init__(
        self,
        *,
        community_id: Optional[int],
        community_name: Optional[str],
        cap: Optional[int],
        attempted_username: Optional[str],
        creator_username: Optional[str],
    ) -> None:
        self.community_id = community_id
        self.community_name = community_name or ""
        self.cap = cap
        self.attempted_username = attempted_username or ""
        self.creator_username = creator_username or ""
        # Keep ``str(exc)`` neutral — never render this directly to a user.
        super().__init__(
            f"community {community_id} at member cap {cap}"
        )


def render_member_cap_error(
    exc: "CommunityMembershipLimitError",
    *,
    session_username: Optional[str] = None,
) -> Tuple[Dict[str, Any], int]:
    """Return ``(payload, http_status)`` for a member-cap exception.

    Single source of truth for the user-facing copy so that all three
    catch sites (the two blueprint routes and the legacy monolith routes
    that still catch this exception) stay consistent without each having
    to duplicate the owner-vs-invitee branch.

    * **Owner** (``session_username`` matches the community creator) —
      "coming soon" copy; no promise of a ship date.
    * **Everyone else** — neutral "reach out to the owner/admin"; no
      upgrade CTA, because they can't act on one.
    """
    cap = exc.cap if exc.cap is not None else 25
    creator = (exc.creator_username or "").strip().lower()
    current = (session_username or "").strip().lower()
    is_owner = bool(creator) and creator == current

    if is_owner:
        msg = (
            f"This community is at its {cap}-member cap. Paid community "
            f"tiers are coming soon."
        )
    else:
        msg = (
            f"This community has reached its member limit. Please reach "
            f"out to the community owner or an admin for further context."
        )

    return (
        {
            "success": False,
            "error": msg,
            "reason_code": "community_member_limit",
            "community_id": exc.community_id,
        },
        403,
    )


def _normalize_subscription(value: Optional[str]) -> str:
    return str(value or "").strip().lower()


def _is_free_subscription(subscription_value: str) -> bool:
    # Mirror the legacy helper from ``bodybuilding_app.py``: anyone who is
    # not explicitly 'premium' is treated as free for capacity purposes.
    # Trial and special are excluded separately at the resolver layer
    # (special is uncapped; trial is treated as premium-equivalent here
    # only if they have a live Stripe trial — resolved via ``resolve_entitlements``).
    return _normalize_subscription(subscription_value) not in {"premium"}


def _fetch_user_subscription(cursor, username: Optional[str]) -> str:
    if not username:
        return ""
    placeholder = get_sql_placeholder()
    cursor.execute(
        f"SELECT subscription FROM users WHERE username = {placeholder}",
        (username,),
    )
    row = cursor.fetchone()
    if not row:
        return ""
    if hasattr(row, "keys"):
        return _normalize_subscription(row.get("subscription"))
    return _normalize_subscription(
        row[0] if isinstance(row, (list, tuple)) and row else row
    )


def _fetch_community_name(cursor, community_id: int) -> str:
    placeholder = get_sql_placeholder()
    try:
        cursor.execute(
            f"SELECT name FROM communities WHERE id = {placeholder}",
            (community_id,),
        )
        row = cursor.fetchone()
    except Exception:
        return ""
    if not row:
        return ""
    if hasattr(row, "keys"):
        return str(row.get("name") or "")
    return str(row[0] if isinstance(row, (list, tuple)) and row else "")


def ensure_free_parent_member_capacity(
    cursor,
    community_id: Optional[int],
    extra_members: int = 1,
    *,
    attempted_username: Optional[str] = None,
) -> None:
    """Raise ``CommunityMembershipLimitError`` if a Free-plan parent community
    would exceed its per-tier member cap after adding ``extra_members``.

    Noops for:
      * missing ``community_id``
      * sub-communities (enforcement only applies to the root)
      * admin-owned communities
      * communities owned by a non-Free user

    The cap is sourced from ``resolve_entitlements()`` so it stays
    KB-driven; on resolver error we fail **closed** to a safe legacy
    cap of 100 so we never accidentally uncap a Free community because
    the KB is temporarily broken.

    Owner notification (``notify_community_member_blocked``) is fired
    from the caller, not here, so this helper stays purely about
    enforcement and can be unit-tested without a notifications table.
    """
    if not community_id:
        return
    info = get_community_basic(cursor, community_id)
    if not info:
        return
    if info.get("parent_community_id"):
        return  # sub-communities inherit their parent's cap indirectly
    creator_username = info.get("creator_username")
    if not creator_username or str(creator_username).lower() == "admin":
        return
    subscription_value = _fetch_user_subscription(cursor, creator_username)
    if not _is_free_subscription(subscription_value):
        return

    placeholder = get_sql_placeholder()
    cursor.execute(
        f"SELECT COUNT(*) FROM user_communities WHERE community_id = {placeholder}",
        (community_id,),
    )
    row = cursor.fetchone()
    current_count = 0
    if row:
        if hasattr(row, "keys"):
            current_count = list(row.values())[0]
        else:
            current_count = row[0] if isinstance(row, (list, tuple)) and row else 0
    try:
        current_count = int(current_count or 0)
    except Exception:
        current_count = 0

    free_members_cap = 100  # fail-closed legacy fallback
    try:
        from backend.services.entitlements import resolve_entitlements

        entitlements = resolve_entitlements(creator_username) or {}
        resolved_cap = entitlements.get("members_per_owned_community")
        if isinstance(resolved_cap, int) and resolved_cap > 0:
            free_members_cap = resolved_cap
    except Exception:
        logger.exception(
            "ensure_free_parent_member_capacity: resolve_entitlements failed for %s",
            creator_username,
        )

    if current_count + extra_members > free_members_cap:
        community_name = _fetch_community_name(cursor, community_id)
        # Fire the owner+admin notification *before* raising so it lands
        # in the caller's transaction; if the caller rolls back the whole
        # request, the notification rolls back too (no orphans).
        if attempted_username:
            try:
                from backend.services.notifications import notify_community_member_blocked

                notify_community_member_blocked(
                    cursor,
                    community_id=community_id,
                    community_name=community_name,
                    attempted_username=attempted_username,
                    cap=free_members_cap,
                )
            except Exception:
                logger.exception(
                    "ensure_free_parent_member_capacity: notify failed (community=%s attempt=%s)",
                    community_id,
                    attempted_username,
                )
        raise CommunityMembershipLimitError(
            community_id=community_id,
            community_name=community_name,
            cap=free_members_cap,
            attempted_username=attempted_username,
            creator_username=str(creator_username),
        )


def _read_kb_member_cap(tier: str) -> Optional[int]:
    """Resolve the member-cap integer for a paid tier from the KB page.

    Returns ``None`` when the tier has no cap (``enterprise``) or the KB
    cannot be read. Callers that receive ``None`` treat the community as
    uncapped — the enterprise semantics.
    """
    if tier == COMMUNITY_TIER_ENTERPRISE:
        return None
    field_name = _TIER_CAP_KB_FIELD.get(tier)
    if not field_name:
        return None
    try:
        # Local import avoids importing KB service during early bootstrap
        # of the community service (the KB service touches its own tables
        # on first call, which we don't want on every capacity check).
        from backend.services.knowledge_base import get_page

        page = get_page("community-tiers") or {}
        fields = page.get("fields") or []
        for f in fields:
            if f.get("name") == field_name:
                value = f.get("value")
                try:
                    resolved = int(value)
                    if resolved > 0:
                        return resolved
                except (TypeError, ValueError):
                    pass
                break
    except Exception:
        logger.exception(
            "_read_kb_member_cap: KB lookup failed for tier=%s field=%s",
            tier,
            field_name,
        )
    return _TIER_CAP_FALLBACK.get(tier)


def _count_community_members(cursor, community_id: int) -> int:
    placeholder = get_sql_placeholder()
    try:
        cursor.execute(
            f"SELECT COUNT(*) FROM user_communities WHERE community_id = {placeholder}",
            (community_id,),
        )
        row = cursor.fetchone()
    except Exception:
        logger.exception(
            "_count_community_members: query failed for community %s",
            community_id,
        )
        return 0
    if not row:
        return 0
    if hasattr(row, "keys"):
        return int(list(row.values())[0] or 0)
    if isinstance(row, (list, tuple)) and row:
        return int(row[0] or 0)
    try:
        return int(row or 0)
    except Exception:
        return 0


def get_community_tier(cursor, community_id: int) -> Optional[str]:
    """Return the normalised tier stored on a community row.

    Returns ``None`` when:
      * the community does not exist, or
      * the ``tier`` column is absent from the schema (pre-migration), or
      * the stored value is empty / unrecognised.

    Callers treat ``None`` as "no tier-based enforcement" so the helper is
    safe to call in environments that have not yet run the tier column
    migration.
    """
    if not community_id:
        return None
    placeholder = get_sql_placeholder()
    try:
        cursor.execute(
            f"SELECT tier FROM communities WHERE id = {placeholder}",
            (community_id,),
        )
        row = cursor.fetchone()
    except Exception:
        # Almost certainly "column not found" on environments where the
        # tier column hasn't been added yet. Fail soft — enforcement
        # simply doesn't activate until the column exists.
        return None
    if not row:
        return None
    if hasattr(row, "keys"):
        return _normalize_tier(row.get("tier"))
    if isinstance(row, (list, tuple)) and row:
        return _normalize_tier(row[0])
    return _normalize_tier(row)


def ensure_community_tier_member_capacity(
    cursor,
    community_id: Optional[int],
    extra_members: int = 1,
    *,
    attempted_username: Optional[str] = None,
) -> None:
    """Raise ``CommunityMembershipLimitError`` when a Paid community would
    exceed its **own** tier's member cap after adding ``extra_members``.

    Unlike :func:`ensure_free_parent_member_capacity` (which uses the
    *owner's* user tier), this helper reads the community's own
    ``tier`` column and compares against the cap published on the
    ``community-tiers`` KB page. The two helpers compose — the caller
    runs the owner-side check first (Free caps) and then this one (Paid
    L1/L2/L3 caps). Enterprise communities are uncapped.

    Noops for:
      * missing ``community_id``
      * sub-communities (tier enforcement applies to the root only)
      * communities with no tier set (treated as untiered — covered by
        ``ensure_free_parent_member_capacity`` when the owner is Free)
      * tier == ``free`` (already covered by the owner helper)
      * tier == ``enterprise`` (unlimited by design)
      * KB misconfiguration (cap <= 0 or non-integer)
    """
    if not community_id:
        return
    info = get_community_basic(cursor, community_id)
    if not info:
        return
    if info.get("parent_community_id"):
        return

    tier = get_community_tier(cursor, community_id)
    if not tier:
        return
    if tier in (COMMUNITY_TIER_FREE, COMMUNITY_TIER_ENTERPRISE):
        return

    cap = _read_kb_member_cap(tier)
    if cap is None or cap <= 0:
        return

    current_count = _count_community_members(cursor, community_id)
    try:
        extra = max(1, int(extra_members or 1))
    except Exception:
        extra = 1
    if current_count + extra <= cap:
        return

    # Over cap — raise with structured context so render_member_cap_error
    # can produce owner-vs-invitee copy. We reuse the existing error
    # class so every catch site in the codebase keeps working untouched.
    community_name = _fetch_community_name(cursor, community_id)
    creator_username = str(info.get("creator_username") or "")
    raise CommunityMembershipLimitError(
        community_id=community_id,
        community_name=community_name,
        cap=cap,
        attempted_username=attempted_username,
        creator_username=creator_username,
    )


def is_app_admin(username):
    """Check if a user is a global app admin.

    Kept in this service so community-management decisions do not need to
    import the monolith. The legacy ``admin`` username still wins, and the
    newer ``users.is_admin`` flag is checked case-insensitively.
    """
    norm_username = (username or "").strip().lower()
    if not norm_username:
        return False
    if norm_username == "admin":
        return True

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"SELECT is_admin FROM users WHERE LOWER(username) = LOWER({ph})",
                (username,),
            )
            row = c.fetchone()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("is_app_admin failed: %s", exc)
        return False

    if not row:
        return False
    value = row["is_admin"] if hasattr(row, "keys") else row[0]
    return bool(value)


def is_community_owner(username, community_id):
    """Check if a user is the owner of a community."""
    norm_username = (username or "").strip().lower()
    if not norm_username or not community_id:
        return False
    
    # App admin 'admin' has owner rights in all communities
    if norm_username == 'admin':
        return True

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(f"SELECT creator_username FROM communities WHERE id = {ph}", (community_id,))
            result = c.fetchone()
            if not result:
                return False
            creator = result["creator_username"] if hasattr(result, "keys") else result[0]
            return bool(creator and str(creator).strip().lower() == norm_username)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("is_community_owner failed: %s", exc)
        return False


def can_manage_community(username, community_id):
    """True when ``username`` may edit/delete/manage ``community_id``."""
    return bool(
        is_app_admin(username)
        or is_community_owner(username, community_id)
    )


def is_community_admin(username, community_id):
    """Check if a user is an admin of a community."""
    norm_username = (username or "").strip().lower()
    if not norm_username or not community_id:
        return False
    
    # App admin 'admin' has admin rights in all communities
    if norm_username == 'admin':
        return True

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            try:
                c.execute(
                    f"""
                    SELECT uc.role
                    FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    WHERE LOWER(u.username) = LOWER({ph}) AND uc.community_id = {ph}
                    """,
                    (username, community_id),
                )
                row = c.fetchone()
                if row:
                    role = row["role"] if hasattr(row, "keys") else row[0]
                    normalized_role = (role or "").strip().lower()
                    if normalized_role in {"admin", "owner", "moderator", "manager"}:
                        return True
            except Exception:
                pass

            c.execute(
                f"SELECT 1 FROM community_admins WHERE community_id = {ph} AND LOWER(username) = LOWER({ph})",
                (community_id, username),
            )
            return c.fetchone() is not None
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("is_community_admin failed: %s", exc)
        return False


def get_parent_chain_ids(cursor, community_id: int) -> List[int]:
    """Return ordered list of parent community IDs (direct parent first) up to root."""
    parents: List[int] = []
    visited: set[int] = set()
    current = community_id
    placeholder = get_sql_placeholder()
    while current:
        cursor.execute(f"SELECT parent_community_id FROM communities WHERE id = {placeholder}", (current,))
        row = cursor.fetchone()
        if not row:
            break
        parent_id = row["parent_community_id"] if hasattr(row, "keys") else row[0]
        if not parent_id or parent_id in visited:
            break
        visited.add(parent_id)
        parents.append(parent_id)
        current = parent_id
    return parents


def fetch_community_names(cursor, community_ids: List[int]) -> List[str]:
    """Fetch community names preserving order of provided IDs."""
    ids = [cid for cid in community_ids if cid is not None]
    if not ids:
        return []
    placeholders = ",".join([get_sql_placeholder()] * len(ids))
    cursor.execute(f"SELECT id, name FROM communities WHERE id IN ({placeholders})", tuple(ids))
    rows = cursor.fetchall()
    id_to_name: Dict[int, str] = {}
    for row in rows:
        cid = row["id"] if hasattr(row, "keys") else row[0]
        name = row["name"] if hasattr(row, "keys") else row[1]
        id_to_name[cid] = name
    return [id_to_name[cid] for cid in ids if cid in id_to_name]


def get_community_basic(cursor, community_id: int) -> Optional[Dict[str, Any]]:
    placeholder = get_sql_placeholder()
    cursor.execute(
        f"SELECT id, creator_username, parent_community_id FROM communities WHERE id = {placeholder}",
        (community_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    if hasattr(row, "keys"):
        return {
            "id": row.get("id"),
            "creator_username": row.get("creator_username"),
            "parent_community_id": row.get("parent_community_id"),
        }
    return {
        "id": row[0] if len(row) > 0 else None,
        "creator_username": row[1] if len(row) > 1 else None,
        "parent_community_id": row[2] if len(row) > 2 else None,
    }


def get_community_ancestors(cursor, community_id: int) -> List[Dict[str, Any]]:
    """Return list of ancestor community records starting from the specified community."""
    ancestors: List[Dict[str, Any]] = []
    current_id = community_id
    visited: Set[int] = set()
    while current_id:
        if current_id in visited:
            break
        visited.add(current_id)
        info = get_community_basic(cursor, current_id)
        if not info:
            break
        ancestors.append(info)
        current_id = info.get("parent_community_id")
    return ancestors


def get_descendant_community_ids(cursor, community_id: int) -> List[int]:
    """Return descendant community IDs (including the provided one) ordered deepest-first."""
    try:
        queue = deque([(community_id, 0)])
        pop_left = True
    except Exception:  # pragma: no cover - fallback for limited environments
        queue = [(community_id, 0)]  # type: ignore
        pop_left = False

    seen: Set[int] = set()
    results: List[Tuple[int, int]] = []

    while queue:
        if pop_left:
            current_id, depth = queue.popleft()  # type: ignore
        else:  # pragma: no cover - fallback branch
            current_id, depth = queue.pop(0)  # type: ignore

        if current_id in seen:
            continue
        seen.add(current_id)
        results.append((current_id, depth))

        placeholder = get_sql_placeholder()
        try:
            cursor.execute(f"SELECT id FROM communities WHERE parent_community_id = {placeholder}", (current_id,))
            rows = cursor.fetchall() or []
        except Exception as child_err:
            logger.warning("Failed to load child communities for %s: %s", current_id, child_err)
            rows = []

        for row in rows:
            child_id = row["id"] if hasattr(row, "keys") else row[0]
            if child_id and child_id not in seen:
                if pop_left:
                    queue.append((child_id, depth + 1))  # type: ignore
                else:  # pragma: no cover - fallback branch
                    queue.append((child_id, depth + 1))  # type: ignore

    results.sort(key=lambda item: item[1], reverse=True)
    return [cid for cid, _ in results]


def _table_exists(cursor, table_name: str) -> bool:
    """Return whether ``table_name`` exists in the active database."""
    ph = get_sql_placeholder()
    if ph == "%s":
        cursor.execute(
            """
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = %s
            LIMIT 1
            """,
            (table_name,),
        )
    else:
        cursor.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
            (table_name,),
        )
    return cursor.fetchone() is not None


def _is_missing_optional_schema_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        marker in text
        for marker in (
            "unknown column",
            "no such column",
            "doesn't exist",
            "does not exist",
            "no such table",
        )
    )


def delete_community_cascade(cursor, community_id: int) -> int:
    """Delete a community and its dependents using the caller's transaction.

    Missing optional tables are skipped so lean test schemas and older
    deployments keep working. Real SQL failures are allowed to bubble up,
    which lets the route roll back and avoid returning a false success.
    """
    ph = get_sql_placeholder()
    for table, where in _COMMUNITY_DEPENDENT_TABLES:
        if not _table_exists(cursor, table):
            continue
        placeholder_count = where.count("{ph}") or 1
        try:
            cursor.execute(
                f"DELETE FROM {table} WHERE {where.format(ph=ph)}",
                tuple([community_id] * placeholder_count),
            )
        except Exception as exc:
            if _is_missing_optional_schema_error(exc):
                logger.info(
                    "Skipping optional community delete table %s due to schema mismatch: %s",
                    table,
                    exc,
                )
                continue
            raise
    cursor.execute(f"DELETE FROM communities WHERE id = {ph}", (community_id,))
    return int(cursor.rowcount or 0)


def _fk_constraint_name(table_name: str) -> str:
    base = f"fk_{table_name}_community_delete"
    if len(base) <= _FK_NAME_MAX_LEN:
        return base
    return f"fk_{table_name[:42]}_community_delete"


def ensure_community_delete_cascade_constraints() -> Dict[str, Any]:
    """Best-effort migration for direct ``community_id`` foreign keys.

    MySQL can alter existing FKs in place; SQLite cannot, so local SQLite
    runs only report that the migration was skipped. Startup must never be
    blocked by a historical orphan row or a type mismatch, so per-table
    failures are recorded and logged instead of raising.
    """
    report: Dict[str, Any] = {"updated": [], "already_ok": [], "skipped": [], "failed": []}
    ph = get_sql_placeholder()
    if ph != "%s":
        report["skipped"].append("sqlite")
        return report

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            for table in sorted(_COMMUNITY_DIRECT_DEPENDENT_TABLES):
                try:
                    if not _table_exists(c, table):
                        report["skipped"].append(table)
                        continue

                    c.execute(
                        """
                        SELECT rc.CONSTRAINT_NAME, rc.DELETE_RULE
                        FROM information_schema.REFERENTIAL_CONSTRAINTS rc
                        JOIN information_schema.KEY_COLUMN_USAGE kcu
                          ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                         AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                         AND rc.TABLE_NAME = kcu.TABLE_NAME
                        WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
                          AND rc.TABLE_NAME = %s
                          AND kcu.COLUMN_NAME = 'community_id'
                          AND kcu.REFERENCED_TABLE_NAME = 'communities'
                        LIMIT 1
                        """,
                        (table,),
                    )
                    row = c.fetchone()
                    constraint = None
                    delete_rule = None
                    if row:
                        constraint = row["CONSTRAINT_NAME"] if hasattr(row, "keys") else row[0]
                        delete_rule = row["DELETE_RULE"] if hasattr(row, "keys") else row[1]
                    if constraint and str(delete_rule or "").upper() == "CASCADE":
                        report["already_ok"].append(table)
                        continue

                    if constraint:
                        c.execute(f"ALTER TABLE `{table}` DROP FOREIGN KEY `{constraint}`")

                    fk_name = _fk_constraint_name(table)
                    c.execute(
                        f"""
                        ALTER TABLE `{table}`
                        ADD CONSTRAINT `{fk_name}`
                        FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`)
                        ON DELETE CASCADE
                        """
                    )
                    conn.commit()
                    report["updated"].append(table)
                except Exception as exc:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    report["failed"].append({"table": table, "error": str(exc)})
                    logger.warning(
                        "Could not ensure ON DELETE CASCADE for %s.community_id: %s",
                        table,
                        exc,
                    )
    except Exception as exc:  # pragma: no cover - defensive startup guard
        report["failed"].append({"table": "*", "error": str(exc)})
        logger.warning("Community delete-cascade FK migration failed: %s", exc)

    return report
