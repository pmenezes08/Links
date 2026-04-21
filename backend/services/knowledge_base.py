"""
C-Point internal Knowledge Base.

A lightweight admin-authored wiki storing product/pricing/policy truth in a
structured, editable, versioned form. Inspired by the Steve KB pattern
(atomic notes + synthesis) but deliberately independent:

- Single entity (C-Point itself), not per-user or per-network.
- Admin-authored only — no LLM in the write path.
- Every page has a typed ``fields`` JSON (editable via admin-web) plus a
  free-form markdown ``body``.
- Every save writes a ``kb_changelog`` row with the change reason.

Tables:
  kb_pages       — one row per page (current state)
  kb_changelog   — append-only audit log, one row per edit

Field types supported (matches admin-web editor):
  integer, decimal, percent, boolean, string, markdown, date, enum,
  list_of_objects, weighted_map

Fields may be flagged ``tbd: true`` to render a warning badge in the UI.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

# Categories shown as the top-level grouping in admin-web.
CATEGORIES: List[Dict[str, str]] = [
    {"id": "overview", "label": "Overview", "icon": "fa-layer-group"},
    {"id": "product", "label": "Product", "icon": "fa-cube"},
    {"id": "pricing", "label": "Pricing", "icon": "fa-euro-sign"},
    {"id": "policy", "label": "Policy", "icon": "fa-shield-halved"},
    {"id": "planning", "label": "Planning", "icon": "fa-map"},
    {"id": "reference", "label": "Reference", "icon": "fa-book"},
    {"id": "audit", "label": "Audit", "icon": "fa-clock-rotate-left"},
]


# ── Schema management ────────────────────────────────────────────────────

def _utc_now_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _ensure_index(cursor, table_name: str, index_name: str, columns_sql: str) -> None:
    if USE_MYSQL:
        cursor.execute(
            """
            SELECT 1 FROM information_schema.statistics
            WHERE table_schema = DATABASE()
              AND table_name = ?
              AND index_name = ?
            LIMIT 1
            """,
            (table_name, index_name),
        )
        if cursor.fetchone():
            return
        cursor.execute(f"CREATE INDEX {index_name} ON {table_name} ({columns_sql})")
        return
    cursor.execute(
        f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({columns_sql})"
    )


def _ensure_column(cursor, table: str, column: str, column_def_sql: str) -> None:
    """Idempotently add a column via ALTER TABLE. Swallows 'already exists' errors."""
    try:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_def_sql}")
    except Exception:
        # Column probably already exists — both MySQL and SQLite raise here.
        pass


def ensure_tables() -> None:
    """Create KB tables if they don't exist. Idempotent."""
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS kb_pages (
                slug VARCHAR(64) PRIMARY KEY,
                title VARCHAR(191) NOT NULL,
                category VARCHAR(32) NOT NULL,
                icon VARCHAR(64) NULL,
                description VARCHAR(512) NULL,
                sort_order INT NOT NULL DEFAULT 0,
                fields_json MEDIUMTEXT NULL,
                field_groups_json MEDIUMTEXT NULL,
                body_markdown MEDIUMTEXT NULL,
                version INT NOT NULL DEFAULT 1,
                updated_by VARCHAR(191) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL
            )
            """
        )
        # Retro-fit column for rows created before field_groups_json existed.
        _ensure_column(c, "kb_pages", "field_groups_json", "MEDIUMTEXT NULL")

        c.execute(
            """
            CREATE TABLE IF NOT EXISTS kb_changelog (
                id INT PRIMARY KEY AUTO_INCREMENT,
                page_slug VARCHAR(64) NOT NULL,
                version_from INT NULL,
                version_to INT NOT NULL,
                changed_fields_json MEDIUMTEXT NULL,
                reason TEXT NOT NULL,
                actor_username VARCHAR(191) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        _ensure_index(c, "kb_pages", "idx_kb_pages_category", "category, sort_order")
        _ensure_index(c, "kb_changelog", "idx_kb_changelog_page", "page_slug, created_at")
        try:
            conn.commit()
        except Exception:
            pass


# ── CRUD ─────────────────────────────────────────────────────────────────

def _row_to_page(row: Any) -> Dict[str, Any]:
    def _get(key: str, idx: int) -> Any:
        if hasattr(row, "keys"):
            return row[key]
        return row[idx]

    fields_raw = _get("fields_json", 6)
    groups_raw = _get("field_groups_json", 7)
    body = _get("body_markdown", 8)
    return {
        "slug": _get("slug", 0),
        "title": _get("title", 1),
        "category": _get("category", 2),
        "icon": _get("icon", 3),
        "description": _get("description", 4),
        "sort_order": _get("sort_order", 5),
        "fields": _parse_json(fields_raw, []),
        "field_groups": _parse_json(groups_raw, []),
        "body_markdown": body or "",
        "version": _get("version", 9),
        "updated_by": _get("updated_by", 10),
        "created_at": str(_get("created_at", 11)) if _get("created_at", 11) else None,
        "updated_at": str(_get("updated_at", 12)) if _get("updated_at", 12) else None,
    }


def _parse_json(raw: Any, fallback: Any) -> Any:
    if not raw:
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def list_pages() -> List[Dict[str, Any]]:
    """Return all pages ordered by (category, sort_order, slug)."""
    ensure_tables()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            """
            SELECT slug, title, category, icon, description, sort_order,
                   fields_json, field_groups_json, body_markdown, version,
                   updated_by, created_at, updated_at
            FROM kb_pages
            ORDER BY category, sort_order, slug
            """
        )
        return [_row_to_page(r) for r in c.fetchall()]


def get_page(slug: str) -> Optional[Dict[str, Any]]:
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT slug, title, category, icon, description, sort_order,
                   fields_json, field_groups_json, body_markdown, version,
                   updated_by, created_at, updated_at
            FROM kb_pages WHERE slug = {ph}
            """,
            (slug,),
        )
        row = c.fetchone()
        return _row_to_page(row) if row else None


def _compute_field_diff(old_fields: List[Dict], new_fields: List[Dict]) -> List[Dict]:
    """Return list of {name, from, to} for fields whose value/tbd changed."""
    diffs: List[Dict[str, Any]] = []
    old_by_name = {f.get("name"): f for f in (old_fields or [])}
    for nf in new_fields or []:
        name = nf.get("name")
        if not name:
            continue
        of = old_by_name.get(name)
        old_val = of.get("value") if of else None
        new_val = nf.get("value")
        old_tbd = bool(of.get("tbd")) if of else False
        new_tbd = bool(nf.get("tbd"))
        if old_val != new_val or old_tbd != new_tbd:
            diffs.append({
                "name": name,
                "label": nf.get("label") or name,
                "from": old_val,
                "to": new_val,
                "tbd_from": old_tbd,
                "tbd_to": new_tbd,
            })
    return diffs


def save_page(
    slug: str,
    *,
    fields: Optional[List[Dict[str, Any]]] = None,
    body_markdown: Optional[str] = None,
    reason: str,
    actor_username: str,
) -> Dict[str, Any]:
    """Update a page's fields and/or body, bump version, write changelog."""
    if not (reason or "").strip():
        raise ValueError("A change reason is required.")
    existing = get_page(slug)
    if not existing:
        raise KeyError(f"Page '{slug}' does not exist.")

    new_fields = fields if fields is not None else existing["fields"]
    new_body = body_markdown if body_markdown is not None else existing["body_markdown"]

    # Compute what changed
    field_diffs = _compute_field_diff(existing["fields"], new_fields)
    body_changed = (new_body or "") != (existing["body_markdown"] or "")
    if not field_diffs and not body_changed:
        return existing  # No-op

    new_version = int(existing.get("version") or 1) + 1
    now = _utc_now_str()
    ph = get_sql_placeholder()

    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            UPDATE kb_pages
               SET fields_json = {ph},
                   body_markdown = {ph},
                   version = {ph},
                   updated_by = {ph},
                   updated_at = {ph}
             WHERE slug = {ph}
            """,
            (
                json.dumps(new_fields),
                new_body,
                new_version,
                actor_username,
                now,
                slug,
            ),
        )
        c.execute(
            f"""
            INSERT INTO kb_changelog
                (page_slug, version_from, version_to, changed_fields_json,
                 reason, actor_username, created_at)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (
                slug,
                existing.get("version"),
                new_version,
                json.dumps({
                    "fields": field_diffs,
                    "body_changed": body_changed,
                }),
                (reason or "").strip(),
                actor_username,
                now,
            ),
        )
        try:
            conn.commit()
        except Exception:
            pass

    return get_page(slug) or existing


def list_changelog(slug: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    ensure_tables()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        if slug:
            c.execute(
                f"""
                SELECT id, page_slug, version_from, version_to,
                       changed_fields_json, reason, actor_username, created_at
                FROM kb_changelog
                WHERE page_slug = {ph}
                ORDER BY created_at DESC, id DESC
                LIMIT {ph}
                """,
                (slug, int(limit)),
            )
        else:
            c.execute(
                f"""
                SELECT id, page_slug, version_from, version_to,
                       changed_fields_json, reason, actor_username, created_at
                FROM kb_changelog
                ORDER BY created_at DESC, id DESC
                LIMIT {ph}
                """,
                (int(limit),),
            )
        rows = c.fetchall()

    out: List[Dict[str, Any]] = []
    for r in rows:
        def _g(k: str, i: int) -> Any:
            return r[k] if hasattr(r, "keys") else r[i]
        out.append({
            "id": _g("id", 0),
            "page_slug": _g("page_slug", 1),
            "version_from": _g("version_from", 2),
            "version_to": _g("version_to", 3),
            "changes": _parse_json(_g("changed_fields_json", 4), {}),
            "reason": _g("reason", 5),
            "actor_username": _g("actor_username", 6),
            "created_at": str(_g("created_at", 7)) if _g("created_at", 7) else None,
        })
    return out


# ── Tests-page helpers ──────────────────────────────────────────────────

TEST_STATUSES = ("not_run", "successful", "unsuccessful")


def update_test_status(
    test_id: str,
    status: str,
    *,
    actor_username: str,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Patch a single row in the 'tests' page and return the updated row.

    Called from:
      * ``PATCH /api/admin/kb/tests/<id>/status`` (admin-web "Run now"
        and manual Mark buttons)
      * CI jobs reporting pytest / PowerShell results (same endpoint, via
        a service-account token)

    Raises :class:`KeyError` if ``test_id`` doesn't exist and
    :class:`ValueError` for invalid status.
    """
    if status not in TEST_STATUSES:
        raise ValueError(
            f"Invalid status {status!r}; expected one of {TEST_STATUSES}"
        )
    page = get_page("tests")
    if not page:
        raise KeyError("Tests page not seeded")

    fields = page.get("fields") or []
    tests_field = next((f for f in fields if f.get("name") == "tests"), None)
    if tests_field is None:
        raise KeyError("Tests page has no 'tests' field")

    rows = list(tests_field.get("value") or [])
    target_idx = next(
        (i for i, r in enumerate(rows) if (r.get("id") or "") == test_id),
        None,
    )
    if target_idx is None:
        raise KeyError(f"Test id {test_id!r} not found")

    updated_row = dict(rows[target_idx])
    updated_row["status"] = status
    updated_row["last_run_at"] = _utc_now_str()
    updated_row["last_run_by"] = actor_username
    if notes is not None:
        updated_row["last_run_notes"] = notes
    rows[target_idx] = updated_row

    # Rebuild the fields list with the mutated value. We go through
    # ``save_page`` so the write is properly changelogged — this is the
    # audit trail admins use to reconstruct "who marked this green".
    new_fields = [
        {**f, "value": rows} if f.get("name") == "tests" else f
        for f in fields
    ]
    save_page(
        "tests",
        fields=new_fields,
        reason=f"Test status update: {test_id} → {status}",
        actor_username=actor_username,
    )
    return updated_row


# ── Seed ────────────────────────────────────────────────────────────────

def _seed_pages() -> List[Dict[str, Any]]:
    """Default pages. Any with TBD values are flagged ``tbd: true``."""
    return [
        # ── Overview ────────────────────────────────────────────────
        {
            "slug": "index",
            "title": "Index",
            "category": "overview",
            "icon": "fa-layer-group",
            "description": "One-screen summary of how C-Point makes money today.",
            "sort_order": 10,
            "fields": [
                {"name": "last_reviewed", "label": "Last reviewed", "type": "date", "value": "2026-04-19"},
                {"name": "current_phase", "label": "Current phase", "type": "enum",
                 "allowed_values": ["early-adoption", "standard", "enterprise-only"],
                 "value": "early-adoption"},
                {"name": "pricing_model_summary", "label": "Pricing model summary", "type": "string",
                 "value": "Two-axis: users pay for Steve, communities pay for space, features, and (optionally) a Steve package."},
            ],
            "body": (
                "# C-Point monetization\n\n"
                "C-Point monetizes on two independent axes:\n\n"
                "1. **Users** pay for **Steve** (AI). Two tiers: Free, Premium.\n"
                "2. **Communities** pay for **space and features**. Three tiers: Free, Paid, Enterprise.\n\n"
                "Every new signup gets **1 month of Premium free** (Steve credits included, "
                "community ownership capped at 5). Communities are always separate from user "
                "subscriptions — owning a paid community does **not** give members Premium Steve, "
                "except on the Enterprise tier.\n\n"
                "Primary sales channel is **web (Stripe)** for margin; iOS/Android IAP available "
                "for convenience at the **same public price**."
            ),
        },

        # ── Product ─────────────────────────────────────────────────
        {
            "slug": "user-tiers",
            "title": "User Tiers",
            "category": "product",
            "icon": "fa-user-tag",
            "description": "Free / Trial / Premium (early) / Premium (standard) / Enterprise-derived / Special.",
            "sort_order": 10,
            "field_groups": [
                {"id": "free", "label": "Free", "icon": "fa-user"},
                {"id": "trial", "label": "Free Trial (30d Premium)", "icon": "fa-gift"},
                {"id": "premium", "label": "Premium", "icon": "fa-crown"},
                {"id": "enterprise_derived", "label": "Enterprise member (derived)", "icon": "fa-building"},
                {"id": "special", "label": "Special (admin / founder / F&F)", "icon": "fa-star"},
            ],
            "fields": [
                # Free
                {"name": "free_steve_access", "label": "Steve access", "type": "boolean", "value": False, "group": "free"},
                {"name": "free_communities_max", "label": "Max communities owned", "type": "integer", "value": 5, "group": "free"},
                {"name": "free_members_per_owned_community", "label": "Members per owned community", "type": "integer", "value": 25, "group": "free"},
                {"name": "free_voice_post_summaries", "label": "Voice / post summaries", "type": "boolean", "value": False, "group": "free"},
                {"name": "free_trial_on_signup", "label": "Auto-trial on signup", "type": "boolean", "value": True,
                 "help": "Every new user gets a 30-day Trial. Settings below.", "group": "free"},

                # Trial
                {"name": "trial_duration_days", "label": "Trial duration (days)", "type": "integer", "value": 30, "group": "trial"},
                {"name": "trial_communities_max", "label": "Max communities owned", "type": "integer", "value": 5,
                 "help": "Intentionally capped at Free-tier level — not Premium's 10.", "group": "trial"},
                {"name": "trial_steve_uses_per_month", "label": "Steve uses / month", "type": "integer", "value": 100, "group": "trial"},
                {"name": "trial_whisper_minutes_per_month", "label": "Whisper minutes / month", "type": "integer", "value": 100, "group": "trial"},
                {"name": "trial_lapse_policy", "label": "Expiry behavior", "type": "string",
                 "value": "Silently downgrades to Free. Communities > Free limits lock read-only until user subscribes or trims.", "group": "trial"},
                {"name": "trial_conversion_email_days", "label": "Conversion reminder email days", "type": "string", "value": "7, 14, 25, 28", "group": "trial"},

                # Premium
                {"name": "premium_price_early_eur", "label": "Price — early adoption", "type": "decimal", "prefix": "€", "value": 4.99, "group": "premium"},
                {"name": "premium_price_standard_eur", "label": "Price — standard", "type": "decimal", "prefix": "€", "value": 7.99, "group": "premium"},
                {"name": "early_adoption_duration_months", "label": "Early-adoption window (months)", "type": "integer", "value": 3, "group": "premium"},
                {"name": "annual_plan_discount_pct", "label": "Annual plan discount", "type": "percent", "value": 17, "tbd": True,
                 "help": "Industry norm ~2 months free (~17%). Not locked.", "group": "premium"},
                {"name": "premium_steve_uses_per_month", "label": "Steve uses / month", "type": "integer", "value": 100, "group": "premium"},
                {"name": "premium_whisper_minutes_per_month", "label": "Whisper minutes / month", "type": "integer", "value": 100, "group": "premium"},
                {"name": "premium_communities_max", "label": "Max communities owned", "type": "integer", "value": 10, "group": "premium"},
                # Per-community member cap intentionally not here anymore
                # (April-2026 Phase 3). Community member caps live on
                # the *community's* own tier on the Community Tiers page
                # (Free 25, Paid L1 75 / L2 150 / L3 250, Enterprise
                # unlimited) — independent of the owner's user tier.
                {"name": "premium_voice_summaries", "label": "Voice summaries", "type": "boolean", "value": True, "group": "premium"},
                {"name": "premium_post_summaries", "label": "Post summaries", "type": "boolean", "value": True, "group": "premium"},
                {"name": "premium_cancel_refund_policy", "label": "Cancel & refund policy", "type": "string",
                 "value": "Cancel any time; access continues until period end; no partial-month refunds (standard SaaS norm).", "group": "premium"},

                # Enterprise-derived (Pro / effective tier)
                {"name": "enterprise_derived_label", "label": "Public label for this effective tier", "type": "string",
                 "value": "Premium (via Enterprise)",
                 "help": "Shown in Account Settings when user's Premium is inherited from an Enterprise seat.", "group": "enterprise_derived"},
                {"name": "enterprise_derived_gets_full_premium", "label": "Gets full Premium entitlements", "type": "boolean", "value": True, "group": "enterprise_derived"},
                {"name": "enterprise_derived_keeps_community_ownership", "label": "Keeps personal community-ownership limit", "type": "boolean", "value": True,
                 "help": "Community ownership is personal — not inherited from Enterprise. Still capped at premium_communities_max.", "group": "enterprise_derived"},
                {"name": "enterprise_derived_blocks_self_subscription", "label": "Block personal Premium subscription while seat active", "type": "boolean", "value": True,
                 "help": "Prevents double-pay: Stripe checkout guard + mobile IAP guided-cancel.", "group": "enterprise_derived"},

                # Special
                {"name": "special_see_policy", "label": "See → Policy → Special Users", "type": "string",
                 "value": "Unlimited business entitlements, technical caps still enforced. Managed from the Special Users page.",
                 "group": "special"},
            ],
            "body": (
                "Four user states in the system. Phase 3 (April 2026) **decoupled** "
                "per-community member caps from the user tier — those now live on the "
                "community's own tier (see Community Tiers). The user tier only gates "
                "Steve access and the *count* of communities a user can own.\n\n"
                "- **Free** — no Steve, no voice/post summaries, can own up to "
                "`free_communities_max` (5) communities. Each Free community caps at "
                "25 members (`free_members_per_owned_community`).\n"
                "- **Premium (early adoption)** — first 3 months at "
                "`premium_price_early_eur` (€4.99/mo). Full Steve access + owns up to "
                "`premium_communities_max` (10) communities. **No user-tier member "
                "cap**: a Premium owner's communities still cap at whatever the "
                "community's tier allows (Free 25 → Paid L1 75 → L2 150 → L3 250 → "
                "Enterprise unlimited).\n"
                "- **Premium (standard)** — from month 4 at `premium_price_standard_eur` "
                "(€7.99/mo). Same entitlements as early adoption.\n"
                "- **Free Trial** — 30 days of Premium-equivalent AI on signup, "
                "community ownership capped at `trial_communities_max` (5). Member caps "
                "inherit Free (25/community). Converts to paid only if a card is added; "
                "otherwise silently downgrades to Free.\n\n"
                "**Trial lapse policy**: communities created during trial that exceed Free "
                "tier limits (> 5 owned, or > 25 members) lock read-only until the user "
                "subscribes or trims down.\n\n"
                "> Retired field: `premium_members_per_owned_community` (removed April "
                "2026). The resolver reports `members_per_owned_community = null` for "
                "Premium/Special to make the new \"cap comes from the community\" model "
                "explicit."
            ),
        },
        {
            "slug": "community-tiers",
            "title": "Community Tiers",
            "category": "product",
            "icon": "fa-people-group",
            "description": "Free / Paid L1-L3 / Enterprise community caps, prices, and non-payment policy.",
            "sort_order": 20,
            "field_groups": [
                {"id": "free", "label": "Free Community (≤25 members)", "icon": "fa-user-group"},
                {"id": "paid_l1", "label": "Paid L1 (26–75 members)", "icon": "fa-building"},
                {"id": "paid_l2", "label": "Paid L2 (76–150 members)", "icon": "fa-building-columns"},
                {"id": "paid_l3", "label": "Paid L3 (151–250 members)", "icon": "fa-building-flag"},
                {"id": "enterprise", "label": "Enterprise (≥251 members)", "icon": "fa-crown"},
                {"id": "economics", "label": "Unit economics", "icon": "fa-calculator"},
                {"id": "paid_steve_package", "label": "Paid: Steve Package (add-on)", "icon": "fa-robot"},
                {"id": "paid_content_gen", "label": "Paid: Content Generation", "icon": "fa-pen-nib"},
                {"id": "trial", "label": "Paid community trial", "icon": "fa-hourglass"},
                {"id": "lifecycle", "label": "Non-payment & archive lifecycle", "icon": "fa-clock-rotate-left"},
            ],
            "fields": [
                # Free
                {"name": "free_community_max_members", "label": "Max members", "type": "integer", "value": 25,
                 "help": "Matches ``free_members_per_owned_community`` on the User Tiers page. "
                         "Beyond 25 the community must move to Paid L1.", "group": "free"},
                {"name": "free_community_shown_on_networking", "label": "Shown on networking page", "type": "boolean", "value": False, "group": "free"},
                {"name": "free_community_content_creation", "label": "Content creation enabled", "type": "boolean", "value": False, "group": "free"},
                {"name": "free_community_media_gb", "label": "Media quota (GB)", "type": "decimal", "suffix": "GB", "value": 1, "tbd": True, "group": "free"},
                {"name": "free_community_posts_per_day", "label": "Posts per day (per community)", "type": "integer", "value": 0,
                 "help": "0 = unlimited. Posts are cheap — no cap for free communities.", "group": "free"},
                {"name": "free_community_upgrade_cta", "label": "Upgrade CTA shown to owner", "type": "string",
                 "value": "Your community has reached 25 members. Upgrade to Paid L1 (€25/mo) to grow up to 75.",
                 "group": "free"},

                # Paid L1 — 26–75 members
                {"name": "paid_l1_price_eur_monthly", "label": "Price per month", "type": "decimal", "prefix": "€", "value": 25, "group": "paid_l1"},
                {"name": "paid_l1_max_members", "label": "Max members", "type": "integer", "value": 75, "group": "paid_l1"},
                {"name": "paid_l1_media_gb", "label": "Media quota (GB)", "type": "decimal", "suffix": "GB", "value": 5, "tbd": True, "group": "paid_l1"},
                {"name": "paid_l1_networking_page_included", "label": "Shown on networking page", "type": "boolean", "value": False,
                 "help": "Not included at L1 — sold as add-on (see Networking Page).", "group": "paid_l1"},
                {"name": "paid_l1_content_creation_available", "label": "Content creation available", "type": "boolean", "value": True, "group": "paid_l1"},
                {"name": "paid_l1_upgrade_cta", "label": "Upgrade CTA shown to owner", "type": "string",
                 "value": "You're at 75 members. Upgrade to Paid L2 (€50/mo) to grow up to 150.",
                 "group": "paid_l1"},

                # Paid L2 — 76–150 members
                {"name": "paid_l2_price_eur_monthly", "label": "Price per month", "type": "decimal", "prefix": "€", "value": 50, "group": "paid_l2"},
                {"name": "paid_l2_max_members", "label": "Max members", "type": "integer", "value": 150, "group": "paid_l2"},
                {"name": "paid_l2_media_gb", "label": "Media quota (GB)", "type": "decimal", "suffix": "GB", "value": 10, "tbd": True, "group": "paid_l2"},
                {"name": "paid_l2_networking_page_included", "label": "Shown on networking page", "type": "boolean", "value": False, "group": "paid_l2"},
                {"name": "paid_l2_content_creation_available", "label": "Content creation available", "type": "boolean", "value": True, "group": "paid_l2"},
                {"name": "paid_l2_upgrade_cta", "label": "Upgrade CTA shown to owner", "type": "string",
                 "value": "You're at 150 members. Upgrade to Paid L3 (€80/mo) to grow up to 250.",
                 "group": "paid_l2"},

                # Paid L3 — 151–250 members
                {"name": "paid_l3_price_eur_monthly", "label": "Price per month", "type": "decimal", "prefix": "€", "value": 80, "group": "paid_l3"},
                {"name": "paid_l3_max_members", "label": "Max members", "type": "integer", "value": 250, "group": "paid_l3"},
                {"name": "paid_l3_media_gb", "label": "Media quota (GB)", "type": "decimal", "suffix": "GB", "value": 25, "tbd": True, "group": "paid_l3"},
                {"name": "paid_l3_networking_page_included", "label": "Shown on networking page", "type": "boolean", "value": False, "group": "paid_l3"},
                {"name": "paid_l3_content_creation_available", "label": "Content creation available", "type": "boolean", "value": True, "group": "paid_l3"},
                {"name": "paid_l3_upgrade_cta", "label": "Upgrade CTA shown to owner", "type": "string",
                 "value": "You're at 250 members. Contact sales about Enterprise (custom pricing) to grow further.",
                 "group": "paid_l3"},

                # Unit economics — the flat €/member basis all paid tiers are derived from.
                {"name": "flat_price_per_member_eur", "label": "Flat price per member (internal)", "type": "decimal", "prefix": "€", "value": 0.33,
                 "help": "Internal unit-economics anchor: Paid L1 (75 × €0.33 ≈ €25), "
                         "L2 (150 × €0.33 ≈ €50), L3 (250 × €0.33 ≈ €80). Must stay "
                         "above infra + support cost per member — revisit if Cloud Run / "
                         "Cloud SQL unit costs change. Not shown to end-users.",
                 "group": "economics"},
                {"name": "break_even_members_paid_l1", "label": "Break-even members for L1", "type": "integer", "value": 8,
                 "help": "With €25 revenue/mo on a ~€3 per-active-member cost basis "
                         "(Cloud Run + egress + Steve weight), L1 turns profit around "
                         "member #8. Keeps the cheapest paid tier from being a loss leader "
                         "at low member counts.",
                 "group": "economics"},
                {"name": "break_even_members_paid_l2", "label": "Break-even members for L2", "type": "integer", "value": 17, "group": "economics"},
                {"name": "break_even_members_paid_l3", "label": "Break-even members for L3", "type": "integer", "value": 27, "group": "economics"},

                # Paid-community trial (separate from the user-tier trial).
                {"name": "paid_trial_duration_days", "label": "Paid-community trial duration (days)", "type": "integer", "value": 14,
                 "help": "One per billing customer across *all* communities they own — "
                         "prevents owners cycling trials by cancelling and re-creating.",
                 "group": "trial"},
                {"name": "paid_trial_one_per_customer", "label": "One trial per customer lifetime", "type": "boolean", "value": True, "group": "trial"},
                {"name": "paid_trial_auto_convert", "label": "Auto-convert to paid at end", "type": "boolean", "value": True,
                 "help": "If a valid payment method is on file. Otherwise see non-payment lifecycle below.",
                 "group": "trial"},

                # Paid · Steve package (add-on)
                {"name": "paid_steve_package_price_eur_monthly", "label": "Package price / month", "type": "decimal", "prefix": "€", "value": 20, "tbd": True, "group": "paid_steve_package"},
                {"name": "paid_steve_package_monthly_credit_pool", "label": "Community credit pool / month", "type": "integer", "value": 300,
                 "help": "Shared across all members. Same weights as Credits & Entitlements.", "group": "paid_steve_package"},
                {"name": "paid_steve_package_free_member_access", "label": "Free members can use pool", "type": "boolean", "value": True, "group": "paid_steve_package"},
                {"name": "paid_steve_package_premium_priority", "label": "Premium members spend pool before personal credits", "type": "boolean", "value": True, "group": "paid_steve_package"},
                {"name": "paid_steve_package_fallback_when_empty", "label": "When pool is empty: Premium members fall back to personal credits", "type": "boolean", "value": True, "group": "paid_steve_package"},
                {"name": "paid_steve_package_free_members_blocked_when_empty", "label": "When pool is empty: free members blocked", "type": "boolean", "value": True, "group": "paid_steve_package"},

                # Paid · Content generation
                {"name": "paid_content_gen_free_allowance_credits_monthly", "label": "Free allowance (credits / month)", "type": "integer", "value": 20,
                 "help": "Small allowance to drive adoption. Debited from the Steve pool if package present, else from a separate allowance.", "group": "paid_content_gen"},
                {"name": "paid_content_gen_pool_reserve_cap_pct", "label": "Max % of Steve pool usable for content-gen", "type": "percent", "value": 50,
                 "help": "Prevents content jobs from starving interactive Steve.", "group": "paid_content_gen"},
                {"name": "paid_content_gen_runs_per_day_max", "label": "Runs per day (max)", "type": "integer", "value": 5, "group": "paid_content_gen"},
                {"name": "paid_content_gen_autopause_threshold_pct", "label": "Autopause when pool remaining <", "type": "percent", "value": 10, "group": "paid_content_gen"},
                {"name": "paid_content_gen_preview_required", "label": "Always require human preview before publish", "type": "boolean", "value": True, "group": "paid_content_gen"},

                # Enterprise
                {"name": "enterprise_starting_price_eur", "label": "Starting price / month", "type": "decimal", "prefix": "€", "value": 299, "tbd": True, "group": "enterprise"},
                {"name": "enterprise_price_model", "label": "Pricing model", "type": "enum",
                 "allowed_values": ["flat_monthly", "per_seat_monthly", "hybrid"],
                 "value": "flat_monthly",
                 "help": "Per-seat becomes attractive above ~500 members. Default flat keeps sales simple.", "group": "enterprise"},
                {"name": "enterprise_per_seat_price_eur", "label": "Per-seat price (if per-seat model)", "type": "decimal", "prefix": "€", "value": 4.50, "tbd": True,
                 "help": "Must be < Premium standard price to justify the bulk deal.", "group": "enterprise"},
                {"name": "enterprise_min_seats", "label": "Minimum seats", "type": "integer", "value": 50, "tbd": True, "group": "enterprise"},
                {"name": "enterprise_grants_premium_steve", "label": "Members get Premium Steve", "type": "boolean", "value": True, "group": "enterprise"},
                {"name": "enterprise_shared_credit_pool_monthly", "label": "Shared Steve credit pool / month", "type": "integer", "value": 50000, "tbd": True,
                 "help": "Community-wide pool for Enterprise. Members spend here first, never fall back to personal (Enterprise supersedes personal).", "group": "enterprise"},
                {"name": "enterprise_media_gb", "label": "Media quota (GB)", "type": "decimal", "suffix": "GB", "value": 200, "tbd": True, "group": "enterprise"},
                {"name": "enterprise_networking_included", "label": "Networking page included", "type": "boolean", "value": True, "group": "enterprise"},
                {"name": "enterprise_steve_package_included", "label": "Steve package included (larger pool)", "type": "boolean", "value": True, "group": "enterprise"},
                {"name": "enterprise_content_gen_included", "label": "Content generation included (no allowance cap)", "type": "boolean", "value": True, "group": "enterprise"},
                {"name": "enterprise_custom_caps_allowed", "label": "Custom caps on request", "type": "boolean", "value": True, "group": "enterprise"},
                {"name": "enterprise_monthly_spend_ceiling_eur", "label": "Monthly AI spend ceiling / Enterprise community", "type": "decimal", "prefix": "€", "value": 2000, "tbd": True,
                 "help": "Circuit breaker — content-gen autopauses first, then interactive Steve.", "group": "enterprise"},
                {"name": "enterprise_sla_response_hours", "label": "Support SLA (hours)", "type": "integer", "value": 24, "tbd": True, "group": "enterprise"},
                {"name": "enterprise_billing_terms", "label": "Billing terms", "type": "string",
                 "value": "Monthly or annual. Annual via invoice + bank transfer accepted. Stripe for card payments.", "group": "enterprise"},
                {"name": "enterprise_contract_required", "label": "Written contract required", "type": "boolean", "value": True,
                 "help": "DPA + T&Cs. Template lives in Legal drive.", "group": "enterprise"},

                # Lifecycle — non-payment, archive, purge, owner recovery.
                {"name": "nonpay_grace_days", "label": "Non-payment grace period (days)", "type": "integer", "value": 7,
                 "help": "Time we retry the card + email the owner before moving to read-only.",
                 "group": "lifecycle"},
                {"name": "nonpay_readonly_days", "label": "Read-only period after grace (days)", "type": "integer", "value": 30,
                 "help": "Members can still read existing content but no new posts / no new joins. "
                         "Community is hidden from discovery (networking page) while read-only.",
                 "group": "lifecycle"},
                {"name": "nonpay_archive_days", "label": "Auto-archive after (days from delinquency)", "type": "integer", "value": 45,
                 "help": "After read-only expires, the community is archived: removed from "
                         "member feeds, owner sees a one-click Restore (requires valid card).",
                 "group": "lifecycle"},
                {"name": "purge_after_archive_days", "label": "Hard purge after archive (days)", "type": "integer", "value": 365,
                 "help": "One full year in archive before rows are deleted. Ample window for "
                         "owner to restore or export via T&Cs-defined self-service.",
                 "group": "lifecycle"},
                {"name": "free_inactivity_archive_days", "label": "Free community inactivity archive (days)", "type": "integer", "value": 90,
                 "help": "Free communities with zero posts AND zero new members for 90 days "
                         "are auto-archived. Owner keeps one-click restore for the full "
                         "purge window.",
                 "group": "lifecycle"},
                {"name": "free_inactivity_purge_days", "label": "Free archived purge (days)", "type": "integer", "value": 365, "group": "lifecycle"},
                {"name": "nonpay_block_ownership_transfer", "label": "Block ownership transfer while delinquent", "type": "boolean", "value": True,
                 "help": "Prevents an owner from escaping a past-due balance by handing the "
                         "community to a co-admin. Transfer is re-enabled the moment the "
                         "account is current again.",
                 "group": "lifecycle"},
                {"name": "nonpay_grace_uses_per_year", "label": "Grace-period uses per year", "type": "integer", "value": 2,
                 "help": "An owner gets 2 free full grace+read-only cycles per rolling 12 "
                         "months. A third delinquency inside the window skips straight to "
                         "archive (still 365-day purge). Discourages cycling the grace "
                         "period as a free ride.",
                 "group": "lifecycle"},
                {"name": "owner_data_export_policy", "label": "Owner data-export policy", "type": "string",
                 "value": "Self-service: owners can download a JSON + media archive of their "
                         "community from the Settings page *while it is current or read-only*. "
                         "After archive, export is still available via the owner dashboard for "
                         "the full 365-day purge window. T&Cs §7.3 documents the format + "
                         "retention; admin staff never run ad-hoc exports on behalf of "
                         "owners (privacy + auditability).",
                 "group": "lifecycle"},
                {"name": "admin_adhoc_export_allowed", "label": "Admin-triggered ad-hoc exports allowed", "type": "boolean", "value": False,
                 "help": "Staff export flow disabled by design. Prevents the data-access "
                         "loophole where an owner pressures support to extract data they "
                         "could not access themselves.",
                 "group": "lifecycle"},
                {"name": "owner_recovery_cta", "label": "Archived-community owner recovery CTA", "type": "string",
                 "value": "Your community \"{name}\" has been archived due to inactivity. "
                         "Click Restore to bring it back — members and posts are preserved "
                         "for 365 days from today.",
                 "group": "lifecycle"},
                {"name": "owner_recovery_requires_card_for_paid", "label": "Restore requires valid card for Paid tiers", "type": "boolean", "value": True,
                 "help": "Free-tier restores are one-click. Paid-tier restores require a "
                         "current payment method to avoid re-entering the grace cycle "
                         "immediately.",
                 "group": "lifecycle"},
            ],
            "body": (
                "Community tiers are independent from user tiers. Owning a Paid community "
                "does **not** grant the owner Premium Steve — they must subscribe separately. "
                "The Enterprise tier is the only one that grants Premium Steve to its members.\n\n"
                "### Tier matrix\n\n"
                "| Tier | Members | Price | Networking page | Content creation |\n"
                "|---|---|---|---|---|\n"
                "| Free | ≤ 25 | €0 | No | No |\n"
                "| Paid L1 | 26–75 | €25/mo | Add-on | Yes |\n"
                "| Paid L2 | 76–150 | €50/mo | Add-on | Yes |\n"
                "| Paid L3 | 151–250 | €80/mo | Add-on | Yes |\n"
                "| Enterprise | ≥ 251 | Custom (€299+ starting) | Included | Included |\n\n"
                "Prices are derived from the internal `flat_price_per_member_eur = €0.33` "
                "anchor (see Unit economics group) — any tier change must keep margin per "
                "active member above the per-member infra + support cost.\n\n"
                "### Paid community trial\n\n"
                "New Paid subscriptions start with a **14-day trial**, one per billing "
                "customer across all communities they own (prevents trial-recycling via "
                "cancel + re-create). If a valid card is on file the trial auto-converts; "
                "otherwise the community drops to the non-payment lifecycle below.\n\n"
                "### Non-payment lifecycle\n\n"
                "Escalating, reversible, and bounded — designed so an owner who genuinely "
                "wants to come back can always do so, and a bad-faith owner can't keep "
                "running a paid tier for free.\n\n"
                "1. **Grace (7 days)** — card retries + email, community still fully live.\n"
                "2. **Read-only (30 days)** — existing members can read; no new posts, no "
                "new joins, community hidden from discovery. Ownership transfer is "
                "**blocked** while delinquent (`nonpay_block_ownership_transfer`).\n"
                "3. **Archive (day 45)** — community is removed from member feeds. Owner "
                "sees a one-click Restore in their dashboard; Paid-tier restore requires a "
                "current card to avoid looping the grace cycle.\n"
                "4. **Purge (day 365 of archive)** — rows are hard-deleted.\n\n"
                "Owners get **2 full grace+read-only cycles per rolling 12 months**; a third "
                "delinquency inside the same 12-month window skips straight to archive, "
                "which keeps the same 365-day purge window — so no data is ever lost "
                "without the full year of recovery room, even for repeat offenders.\n\n"
                "### Archived-community recovery (Free tier)\n\n"
                "Free communities also auto-archive after 90 days of zero activity "
                "(`free_inactivity_archive_days`). The owner always keeps one-click Restore "
                "from the owner dashboard for the full 365-day purge window. Restoring a "
                "Free community is free and doesn't require a card.\n\n"
                "### Data export + privacy\n\n"
                "Data export is **owner self-service only** — staff never run ad-hoc "
                "exports (`admin_adhoc_export_allowed = false`). This is a deliberate "
                "anti-loophole: it prevents the pattern where a departing owner pressures "
                "support to extract data they otherwise couldn't get. The owner dashboard "
                "keeps the export button enabled throughout grace, read-only, and the "
                "365-day archive window. T&Cs §7.3 documents format, retention, and the "
                "fact that admins cannot bypass this flow.\n\n"
                "### Steve package (Paid only, opt-in add-on)\n\n"
                "Separate product — see the Paid · Steve Package fields above. A Paid "
                "community can operate with or without it; the tier price covers seats + "
                "content creation but not Steve credits. Gives the community a shared "
                "credit pool. Free members can use it; Premium members use the pool first "
                "(saving their personal credits), falling back to personal credits when the "
                "pool is empty. Free members are blocked when the pool hits zero.\n\n"
                "### Content generation (Paid only)\n\n"
                "Opt-in feature with a small free allowance to drive adoption. Debited from "
                "the Steve pool if the package is active; otherwise from the standalone "
                "allowance. Safety knobs (`paid_content_gen_pool_reserve_cap_pct`, "
                "`paid_content_gen_runs_per_day_max`, `paid_content_gen_autopause_threshold_pct`) "
                "prevent content jobs from burning the budget or starving interactive Steve.\n\n"
                "### Open decisions\n\n"
                "- Steve package price and pool size.\n"
                "- Media quotas per tier.\n"
                "- Enterprise starting price (quote-based; we publish a \"starting at\" figure)."
            ),
        },
        {
            "slug": "networking-page",
            "title": "Networking Page",
            "category": "product",
            "icon": "fa-globe",
            "description": "Community discovery page — included in Enterprise, add-on for Paid.",
            "sort_order": 30,
            "fields": [
                {"name": "min_members_to_appear", "label": "Minimum members to appear", "type": "integer", "value": 50,
                 "help": "Filters out early-stage and abandoned communities."},
                {"name": "included_in_enterprise", "label": "Included in Enterprise", "type": "boolean", "value": True},
                {"name": "available_as_paid_addon", "label": "Available as Paid add-on", "type": "boolean", "value": True},
                {"name": "paid_addon_price_eur_monthly", "label": "Paid add-on price / month", "type": "decimal", "prefix": "€", "value": 15, "tbd": True},
                {"name": "free_community_visibility", "label": "Free communities visible", "type": "boolean", "value": False},
                {"name": "calls_per_user_per_24h", "label": "Networking-page calls / user / 24h", "type": "integer", "value": 50,
                 "help": "A \"call\" is a page load or search that hits our listing endpoint."},
                {"name": "calls_per_user_per_month", "label": "Networking-page calls / user / month", "type": "integer", "value": 1000},
                {"name": "connection_requests_per_user_per_24h", "label": "Connection / join requests / user / 24h", "type": "integer", "value": 20,
                 "help": "Prevents networking-page abuse for community spam."},
                {"name": "connection_requests_per_community_per_24h", "label": "Connection requests received / community / 24h", "type": "integer", "value": 200, "tbd": True},
                {"name": "discovery_card_fields", "label": "Discovery card fields", "type": "string",
                 "value": "name, bio, owner, member_count, categories, last_activity"},
                {"name": "steve_search_enabled", "label": "Steve-powered natural-language search", "type": "boolean", "value": False, "tbd": True,
                 "help": "Future — would add a new Steve cost line. Recompute pricing if enabled."},
            ],
            "body": (
                "The Networking Page is C-Point's public community directory. It's the "
                "growth surface: communities find members, members find communities.\n\n"
                "**Who appears**\n\n"
                "- Community has ≥ `min_members_to_appear` members.\n"
                "- Community tier includes networking: **Enterprise** (bundled) or "
                "**Paid + networking add-on**.\n"
                "- Free communities never appear — keeps the directory high-signal.\n\n"
                "**Rate limits** protect against scraping and spam (see fields above). "
                "Steve-powered search is a future feature; enabling it changes the cost "
                "model — re-check Credits & Entitlements before launch.\n\n"
                "**Pricing**: €{paid_addon_price_eur_monthly}/month for Paid communities, "
                "included for Enterprise. Price is still TBD and should be validated "
                "against what communities are willing to pay for 'discoverable' status."
            ),
        },

        # ── Pricing ─────────────────────────────────────────────────
        {
            "slug": "credits-entitlements",
            "title": "Credits & Entitlements",
            "category": "pricing",
            "icon": "fa-coins",
            "description": "User-facing Steve allowance, internal weighted pool, and model costs.",
            "sort_order": 10,
            "field_groups": [
                {"id": "user_allowance", "label": "User-facing allowance", "icon": "fa-user-check"},
                {"id": "internal_pool", "label": "Internal credit pool", "icon": "fa-scale-balanced"},
                {"id": "content_gen_weights", "label": "Content generation weights", "icon": "fa-pen-nib"},
                {"id": "community_pool_logic", "label": "Community Steve package · priority logic", "icon": "fa-robot"},
                {"id": "safety", "label": "Safety & ceilings", "icon": "fa-shield-halved"},
                {"id": "model_costs", "label": "Model costs (source of truth for the math)", "icon": "fa-dollar-sign"},
            ],
            "fields": [
                # User allowance
                {"name": "steve_uses_per_month_user_facing", "label": "Allowance (Steve uses / month)", "type": "integer", "value": 100, "group": "user_allowance"},
                {"name": "whisper_minutes_per_month", "label": "Whisper minutes / month", "type": "integer", "value": 100, "group": "user_allowance"},
                {"name": "display_format", "label": "Displayed to user as", "type": "string",
                 "value": "\"X of 100 Steve uses · Y of 100 voice minutes — resets on [date]\"", "group": "user_allowance"},

                # Internal pool
                {"name": "credit_pool_internal_min", "label": "Internal credit pool (min)", "type": "integer", "value": 150, "group": "internal_pool"},
                {"name": "credit_pool_internal_max", "label": "Internal credit pool (max)", "type": "integer", "value": 250, "group": "internal_pool"},
                {"name": "internal_weights", "label": "Internal credit weights (per action)", "type": "weighted_map",
                 "value": {
                     "dm": 1,
                     "group": 3,
                     "feed": 3,
                     "post_summary": 2,
                     "voice_minute": 1,
                 },
                 "group": "internal_pool",
                 "help": "DM=1, group=3, feed=3, post summary=2, voice minute=1. Tune as Grok pricing shifts."},

                # Content gen weights
                {"name": "content_gen_weights", "label": "Content-generation weights (per run)", "type": "weighted_map",
                 "value": {
                     "content_motivation_dm": 2,
                     "content_compliment_feed": 2,
                     "content_news_roundup": 4,
                     "content_opinion_roundup": 5,
                     "content_steve_takes": 3,
                 },
                 "group": "content_gen_weights",
                 "help": "Debited from the Paid community's Steve pool (or content-gen allowance if no pool)."},
                {"name": "content_gen_charged_against", "label": "Debited against", "type": "enum",
                 "allowed_values": ["steve_package_pool", "standalone_allowance", "enterprise_unlimited"],
                 "value": "steve_package_pool", "group": "content_gen_weights",
                 "help": "If Steve package active → pool. Else → standalone allowance (see Community Tiers). Enterprise → unlimited."},

                # Community pool logic
                {"name": "community_pool_priority_order", "label": "Priority order when user calls Steve in a paid community", "type": "string",
                 "value": "1) community pool (if Steve package active) → 2) user's personal credits (Premium) → 3) blocked (Free user)",
                 "group": "community_pool_logic"},
                {"name": "community_pool_free_member_rule", "label": "Free member rule", "type": "string",
                 "value": "Only spends community pool. Never personal (they have none). Blocked on empty.",
                 "group": "community_pool_logic"},
                {"name": "community_pool_premium_member_rule", "label": "Premium member rule", "type": "string",
                 "value": "Spends community pool first; falls through to personal credits when pool empty; only hits personal allowance ceiling after both exhausted.",
                 "group": "community_pool_logic"},

                # Safety
                {"name": "monthly_spend_ceiling_eur", "label": "Monthly AI spend ceiling / user", "type": "decimal", "prefix": "€", "value": 3.99,
                 "help": "Hard circuit-breaker on xAI + Whisper spend per user per month.", "group": "safety"},
                {"name": "target_net_profit_min_eur", "label": "Target minimum net profit / user / month", "type": "decimal", "prefix": "€", "value": 1.50, "group": "safety"},
                {"name": "overage_allowed", "label": "Overage billing allowed", "type": "boolean", "value": False,
                 "help": "v1: hard stop when credits run out. Future: top-up packs.", "group": "safety"},
                {"name": "topup_pack_price_eur", "label": "Credit top-up pack price (future)", "type": "decimal", "prefix": "€", "value": 4.99, "tbd": True, "group": "safety"},
                {"name": "topup_pack_credits", "label": "Credit top-up pack size (future)", "type": "integer", "value": 50, "tbd": True, "group": "safety"},

                # Model costs — single source of truth
                {"name": "model_primary", "label": "Primary model", "type": "string", "value": "grok-4-1-fast-reasoning", "group": "model_costs"},
                {"name": "model_primary_input_per_m_usd", "label": "Primary model — input $/1M tokens", "type": "decimal", "prefix": "$", "value": 0.20, "group": "model_costs"},
                {"name": "model_primary_output_per_m_usd", "label": "Primary model — output $/1M tokens", "type": "decimal", "prefix": "$", "value": 0.50, "group": "model_costs"},
                {"name": "model_heavy", "label": "Heavy model (reasoning)", "type": "string", "value": "grok-4-20-reasoning", "group": "model_costs"},
                {"name": "model_heavy_input_per_m_usd", "label": "Heavy model — input $/1M", "type": "decimal", "prefix": "$", "value": 2.00, "group": "model_costs"},
                {"name": "model_heavy_output_per_m_usd", "label": "Heavy model — output $/1M", "type": "decimal", "prefix": "$", "value": 6.00, "group": "model_costs"},
                {"name": "whisper_per_minute_usd", "label": "OpenAI Whisper ($/minute)", "type": "decimal", "prefix": "$", "value": 0.006, "group": "model_costs"},
                {"name": "tool_call_per_1000_usd", "label": "Web / X / code-exec tool calls ($/1000 calls)", "type": "decimal", "prefix": "$", "value": 5.00, "group": "model_costs"},
                {"name": "usd_to_eur_rate", "label": "USD → EUR rate", "type": "decimal", "value": 0.92, "group": "model_costs",
                 "help": "Used by the calculator to convert xAI/OpenAI bills to €."},
                {"name": "model_costs_last_checked", "label": "Model costs last checked", "type": "date", "value": "2026-04-19", "group": "model_costs"},
                {"name": "model_costs_source", "label": "Source of pricing", "type": "string",
                 "value": "x.ai/pricing + openai.com/pricing — re-verify monthly.", "group": "model_costs"},
            ],
            "body": (
                "**What the user sees**: ~`steve_uses_per_month_user_facing` Steve uses per month, "
                "plus `whisper_minutes_per_month` minutes of voice transcription.\n\n"
                "**What runs internally**: a weighted credit pool. A DM reply costs 1 credit; a "
                "group-chat reply costs 3; a feed comment/post reply costs 3; a post summary "
                "costs 2; a Whisper minute costs 1. Pool size is set so average users never hit "
                "the ceiling, and heavy users hit the ceiling before the xAI bill does.\n\n"
                "**Why the weighting works**: group and feed calls burn ~3× the tokens of a DM "
                "(200-message context + tools). Pricing them as 3× credits internally keeps a "
                "€7.99 subscription's worst case below the €3.99 AI spend cap.\n\n"
                "**Model Costs**: this page is the single source of truth for the math. "
                "When you edit any model cost, the Calculator (under Planning → Calculator) "
                "updates automatically. Re-verify `model_costs_source` every month.\n\n"
                "**When credits run out**: hard stop. User sees \"you've used your monthly Steve "
                "allowance — resets on [date].\" No overage billing in v1 (too risky). "
                "Future: optional credit top-up packs at `topup_pack_price_eur` / "
                "`topup_pack_credits`."
            ),
        },
        {
            "slug": "monetization-math",
            "title": "Monetization Math",
            "category": "pricing",
            "icon": "fa-calculator",
            "description": "Sales channel fees, taxes, and worked margin examples.",
            "sort_order": 20,
            "fields": [
                {"name": "apple_fee_pct_year1", "label": "Apple IAP fee (year 1, non-SMB)", "type": "percent", "value": 30},
                {"name": "apple_fee_pct_year2plus", "label": "Apple IAP fee (year 2+, or SMB)", "type": "percent", "value": 15},
                {"name": "google_fee_pct_year1", "label": "Google Play fee (year 1)", "type": "percent", "value": 30},
                {"name": "google_fee_pct_year2plus", "label": "Google Play fee (year 2+)", "type": "percent", "value": 15},
                {"name": "stripe_fee_pct", "label": "Stripe fee (percent)", "type": "percent", "value": 1.5},
                {"name": "stripe_fee_fixed_eur", "label": "Stripe fee (fixed per transaction)", "type": "decimal", "prefix": "€", "value": 0.25},
                {"name": "irish_vat_pct", "label": "Irish VAT (consumer)", "type": "percent", "value": 23},
                {"name": "irish_corp_tax_pct", "label": "Irish corporation tax", "type": "percent", "value": 12.5},
                {"name": "same_public_price_all_channels", "label": "Same public price across all channels", "type": "boolean", "value": True,
                 "help": "We absorb store fees rather than surcharge users."},
            ],
            "body": (
                "**Worked example — €7.99 Premium, worst-case user, iOS channel (year 2+)**\n\n"
                "| Step | € |\n"
                "|---|---|\n"
                "| Gross price | 7.99 |\n"
                "| − App Store fee (15%) | −1.20 |\n"
                "| − VAT (23% of net-of-fee) | ~−1.27 |\n"
                "| = Net revenue | ~5.52 |\n"
                "| − AI cost ceiling (xAI + Whisper) | −3.99 |\n"
                "| = Pre-tax margin | ~1.53 |\n"
                "| − Corp tax (12.5% of margin) | −0.19 |\n"
                "| = **Net profit / user / month** | **~1.34** |\n\n"
                "**Web channel** (Stripe only, no 15% store cut) gives **~€2.50+ net** on the "
                "same user. That's the gap that justifies driving web signups.\n\n"
                "**Early-adopter variant (€4.99)**: AI cost must be capped lower to keep €1.50 "
                "net — roughly €1.99 AI ceiling. That's why the early-adoption credit pool is "
                "softer-weighted, not a bigger allowance."
            ),
        },

        # ── Policy ──────────────────────────────────────────────────
        {
            "slug": "hard-limits",
            "title": "Hard Limits & Technical Caps",
            "category": "policy",
            "icon": "fa-shield-halved",
            "description": "Per-turn, per-day, and per-month technical caps across tiers.",
            "sort_order": 10,
            "field_groups": [
                {"id": "per_turn", "label": "Per-turn caps", "icon": "fa-message"},
                {"id": "per_user_premium", "label": "Per-user caps (Premium / Trial / Free)", "icon": "fa-user"},
                {"id": "per_user_special", "label": "Per-user caps (Special)", "icon": "fa-star"},
                {"id": "per_community", "label": "Per-community caps", "icon": "fa-people-group"},
            ],
            "fields": [
                # Per-turn
                {"name": "max_output_tokens_dm", "label": "Max output tokens — DM", "type": "integer", "value": 600, "group": "per_turn"},
                {"name": "max_output_tokens_feed", "label": "Max output tokens — community feed", "type": "integer", "value": 600, "group": "per_turn"},
                {"name": "max_output_tokens_group", "label": "Max output tokens — group chat", "type": "integer", "value": 1500, "group": "per_turn"},
                {"name": "max_tool_invocations_per_turn", "label": "Max tool invocations per turn", "type": "integer", "value": 3,
                 "help": "Hard cap on web/X/code-exec calls per single Steve turn. Caps worst-case spend.", "group": "per_turn"},
                {"name": "max_context_messages", "label": "Max context messages passed to model", "type": "integer", "value": 200, "group": "per_turn"},
                {"name": "max_images_per_turn", "label": "Max images per turn", "type": "integer", "value": 5, "group": "per_turn"},

                # Per-user (Premium / Trial / Free)
                {"name": "ai_daily_limit", "label": "AI_DAILY_LIMIT (calls / 24h)", "type": "integer", "value": 10,
                 "help": "Also lives in bodybuilding_app.py:25992 — keep in sync.", "group": "per_user_premium"},
                {"name": "monthly_spend_ceiling_eur", "label": "Monthly AI spend ceiling (circuit breaker)", "type": "decimal", "prefix": "€", "value": 3.99,
                 "help": "Freeze AI for remainder of period if crossed. No bill shock, ever.", "group": "per_user_premium"},
                {"name": "rpm_per_user", "label": "Rate limit (requests / minute / user)", "type": "integer", "value": 10, "group": "per_user_premium"},
                {"name": "hpm_per_user", "label": "Rate limit (requests / hour / user)", "type": "integer", "value": 60, "group": "per_user_premium"},

                # Per-user (Special)
                {"name": "ai_daily_limit_special", "label": "AI daily limit (Special)", "type": "integer", "value": 200,
                 "help": "Still bounded — protects against runaway bugs on our own accounts.", "group": "per_user_special"},
                {"name": "monthly_spend_ceiling_eur_special", "label": "Monthly AI spend ceiling (Special)", "type": "decimal", "prefix": "€", "value": 50,
                 "help": "Generous but bounded. Alerts fire well before the cap.", "group": "per_user_special"},
                {"name": "max_tool_invocations_per_turn_special", "label": "Max tool invocations per turn (Special)", "type": "integer", "value": 5, "group": "per_user_special"},
                {"name": "rpm_per_user_special", "label": "Rate limit (rpm, Special)", "type": "integer", "value": 60, "group": "per_user_special"},

                # Per-community
                {"name": "community_ai_calls_per_day", "label": "Steve calls / day / community (soft ceiling)", "type": "integer", "value": 500, "tbd": True, "group": "per_community"},
                {"name": "community_spend_ceiling_eur_monthly", "label": "Monthly AI spend ceiling / community", "type": "decimal", "prefix": "€", "value": 200, "tbd": True,
                 "help": "For Enterprise / Paid+Steve-package. Prevents a single community from burning all budget.", "group": "per_community"},
            ],
            "body": (
                "These are *technical* caps — they apply regardless of business tier. Even "
                "Special users hit these (with relaxed values). They exist to prevent bugs, "
                "runaway loops, and outright abuse from bankrupting us.\n\n"
                "**Per-turn worst-case envelope**: group reply + 200 message context + 5 "
                "images + reasoning + 1500 output + 3 tool calls. Recompute € cost via the "
                "Calculator with current Grok 4.1 pricing before every pricing change.\n\n"
                "**Circuit breaker**: if a user's rolling 30-day AI cost crosses "
                "`monthly_spend_ceiling_eur` (Premium) or `monthly_spend_ceiling_eur_special` "
                "(Special), AI is frozen for the remainder of the period. UI shows: "
                "\"Your monthly Steve credits are used up. Resets [date].\"\n\n"
                "**Community circuit breaker**: Paid-with-Steve-package and Enterprise "
                "communities have their own monthly spend ceiling. Hitting it disables "
                "content-gen automation first (autopause), then interactive Steve."
            ),
        },
        {
            "slug": "trial-abuse-prevention",
            "title": "Trial & Abuse Prevention",
            "category": "policy",
            "icon": "fa-user-shield",
            "description": "One-email-one-account policy and signal stack.",
            "sort_order": 20,
            "field_groups": [
                {"id": "identity", "label": "Identity signals", "icon": "fa-id-card"},
                {"id": "rate_limits", "label": "Signup rate limits", "icon": "fa-stopwatch"},
                {"id": "trial_policy", "label": "Trial policy", "icon": "fa-gift"},
            ],
            "fields": [
                # Identity
                {"name": "email_normalization_enabled", "label": "Email normalization (lowercase + strip dots/plus)", "type": "boolean", "value": True,
                 "help": "\"Foo.Bar+spam@gmail.com\" → \"foobar@gmail.com\". Blocks the basic dot/alias trick.", "group": "identity"},
                {"name": "disposable_email_blocked", "label": "Block disposable email domains", "type": "boolean", "value": True, "group": "identity"},
                {"name": "disposable_domains_blocklist_source", "label": "Blocklist source", "type": "string",
                 "value": "github.com/disposable-email-domains/disposable-email-domains — refresh quarterly.",
                 "group": "identity"},
                {"name": "disposable_domains_blocklist_extra", "label": "Extra blocked domains (admin-curated)", "type": "string",
                 "value": "",
                 "help": "One domain per line (or comma-separated). Unioned with the bundled file at backend/data/disposable_email_domains.txt. Edit here to add abuse hotspots without a redeploy — reload() in backend.services.disposable_email refreshes the in-process cache on KB save.",
                 "group": "identity"},
                {"name": "device_fingerprint_enabled", "label": "Device fingerprint enabled", "type": "boolean", "value": True, "group": "identity"},
                {"name": "device_fingerprint_library", "label": "Device fingerprint library", "type": "string",
                 "value": "FingerprintJS open-source (client) + server-side normalization", "group": "identity"},
                {"name": "phone_verification_required", "label": "Phone verification required", "type": "boolean", "value": False, "tbd": True,
                 "help": "Highest-friction anti-abuse signal. Hold until abuse shows up.", "group": "identity"},
                {"name": "card_authorize_for_trial", "label": "Card authorization required to start trial", "type": "boolean", "value": False, "tbd": True,
                 "help": "€0 auth + auto-charge at end. Cuts abuse ~80% but hurts top-of-funnel. Enable if free-trial burn is >5% of AI budget.", "group": "identity"},

                # Rate limits
                {"name": "ip_signup_per_hour_max", "label": "Signups per IP per hour (max)", "type": "integer", "value": 5, "group": "rate_limits"},
                {"name": "ip_signup_per_day_max", "label": "Signups per IP per day (max)", "type": "integer", "value": 20, "group": "rate_limits"},
                {"name": "ip_signup_per_asn_per_day_max", "label": "Signups per ASN per day (max)", "type": "integer", "value": 200, "tbd": True, "group": "rate_limits"},
                {"name": "trials_per_device_fp", "label": "Trials per device fingerprint", "type": "integer", "value": 1, "group": "rate_limits"},
                {"name": "trials_per_canonical_email", "label": "Trials per canonical email", "type": "integer", "value": 1, "group": "rate_limits"},

                # Trial policy
                {"name": "trial_duration_days", "label": "Trial duration (days)", "type": "integer", "value": 30, "group": "trial_policy"},
                {"name": "trial_community_max", "label": "Max communities owned during trial", "type": "integer", "value": 5,
                 "help": "Intentionally capped at free-tier level — not Premium's 10.", "group": "trial_policy"},
                {"name": "trial_email_verification_required", "label": "Verified email required to start trial", "type": "boolean", "value": True, "group": "trial_policy"},
                {"name": "trial_community_lapse_policy", "label": "Trial community lapse policy", "type": "string",
                 "value": "Communities created during trial that exceed Free limits (>5 owned, >50 members) lock read-only until user subscribes or trims down.",
                 "group": "trial_policy"},
                {"name": "trial_conversion_email_days", "label": "Conversion reminder email days", "type": "string",
                 "value": "7, 14, 25, 28", "group": "trial_policy"},
            ],
            "body": (
                "**Known loopholes in a naive \"one email, one account\" rule**\n\n"
                "1. **Gmail dots/plus aliasing** — same account, infinite aliases. "
                "Mitigation: `email_normalization_enabled`.\n"
                "2. **Disposable email services** (temp-mail, 10minutemail, etc.) — "
                "Mitigation: `disposable_email_blocked` against a maintained blocklist.\n"
                "3. **Custom-domain catch-alls** — attacker owns `abuser.com`, all "
                "addresses deliver to them. Mitigation: device fingerprint + IP + ASN "
                "rate limits. Can't fully block without card auth.\n"
                "4. **IP rotation (VPNs / residential proxies)** — per-IP caps are weak "
                "against this. Mitigation: ASN-level caps + device fingerprint.\n"
                "5. **Device fingerprint spoofing** — possible with effort; the cost of "
                "doing it repeatedly exceeds the value of a €4.99 trial.\n\n"
                "**Policy**: we combine signals — no single signal is definitive. Three "
                "of (canonical email, device FP, IP, phone) all matching a known abuser "
                "flags the account. We err on letting marginal accounts through; the "
                "worst case is €3.99 of Steve credits, which is bounded by the circuit "
                "breaker.\n\n"
                "**If abuse becomes material** (>5% of monthly AI spend), enable "
                "`card_authorize_for_trial` — friction we accept in exchange for "
                "cutting abuse ~80%."
            ),
        },
        {
            "slug": "special-users",
            "title": "Special Users",
            "category": "policy",
            "icon": "fa-star",
            "description": "Users with unlimited business-level access (admins, founder, friends/family).",
            "sort_order": 30,
            "field_groups": [
                {"id": "list", "label": "Special user list", "icon": "fa-list"},
                {"id": "caps", "label": "Technical caps (still enforced)", "icon": "fa-shield-halved"},
                {"id": "policy", "label": "Grant / revoke policy", "icon": "fa-gavel"},
            ],
            "fields": [
                {"name": "special_users", "label": "Special users", "type": "list_of_objects",
                 "group": "list",
                 "schema": [
                    {"name": "username", "type": "string", "label": "Username"},
                    {"name": "display_name", "type": "string", "label": "Display name"},
                    {"name": "category", "type": "enum", "label": "Category",
                     "allowed_values": ["admin", "founder", "staff", "friends_family", "testing"]},
                    {"name": "granted_by", "type": "string", "label": "Granted by"},
                    {"name": "granted_at", "type": "date", "label": "Granted at"},
                    {"name": "reason", "type": "string", "label": "Reason"},
                    {"name": "expires_at", "type": "date", "label": "Expires at (optional)"},
                 ],
                 "value": [
                    {"username": "admin", "display_name": "Admin", "category": "admin",
                     "granted_by": "paulo", "granted_at": "2026-04-19",
                     "reason": "Landlord account", "expires_at": ""},
                    {"username": "paulo", "display_name": "Paulo (founder)", "category": "founder",
                     "granted_by": "paulo", "granted_at": "2026-04-19",
                     "reason": "Founder account", "expires_at": ""},
                 ]},

                # Caps
                {"name": "ai_daily_limit_special", "label": "AI daily limit", "type": "integer", "value": 200,
                 "help": "Higher than Premium (10) but still bounded. Mirrors Hard Limits page.", "group": "caps"},
                {"name": "monthly_spend_ceiling_eur_special", "label": "Monthly AI spend ceiling", "type": "decimal", "prefix": "€", "value": 50,
                 "help": "Mirrors Hard Limits page. Alerts fire at 80%.", "group": "caps"},
                {"name": "max_tool_invocations_per_turn_special", "label": "Max tool invocations per turn", "type": "integer", "value": 5, "group": "caps"},
                {"name": "communities_unlimited", "label": "Unlimited communities (business-level)", "type": "boolean", "value": True, "group": "caps"},
                {"name": "members_per_community_unlimited", "label": "Unlimited members per owned community", "type": "boolean", "value": True, "group": "caps"},
                {"name": "media_quota_unlimited", "label": "Unlimited media quota", "type": "boolean", "value": True, "group": "caps"},
                {"name": "content_gen_unlimited", "label": "Unlimited content generation", "type": "boolean", "value": True, "group": "caps"},

                # Policy
                {"name": "who_can_grant", "label": "Who can grant Special", "type": "string",
                 "value": "Landlord (admin) only. Every grant is logged in special_access_log.",
                 "group": "policy"},
                {"name": "reason_required_on_grant", "label": "Reason required on grant", "type": "boolean", "value": True, "group": "policy"},
                {"name": "reason_required_on_revoke", "label": "Reason required on revoke", "type": "boolean", "value": True, "group": "policy"},
                {"name": "shows_special_badge", "label": "Show 'Special' badge on profile", "type": "boolean", "value": False,
                 "help": "Default discreet — Special is internal, not a public flex.", "group": "policy"},
                {"name": "revoke_locks_communities", "label": "Revoking Special locks over-limit communities", "type": "boolean", "value": False,
                 "help": "Default false — we trust them; their communities stay live even after revoke.", "group": "policy"},
                {"name": "auto_revoke_expired", "label": "Auto-revoke when expires_at passes", "type": "boolean", "value": True, "group": "policy"},
                {"name": "audit_log_table", "label": "Audit log table", "type": "string", "value": "special_access_log", "group": "policy"},
            ],
            "body": (
                "**Definition**\n\n"
                "A *Special* user bypasses **business** entitlements — unlimited "
                "communities, unlimited Steve, no monthly allowance cap — but still has "
                "**technical** safeguards (daily call limit, monthly spend ceiling, "
                "per-turn tool cap). This way, a bug on our own account can't bankrupt "
                "us, but we can still use the product without friction.\n\n"
                "**Categories**\n\n"
                "- `admin` — service accounts (@admin)\n"
                "- `founder` — Paulo\n"
                "- `staff` — future team\n"
                "- `friends_family` — small hand-picked list\n"
                "- `testing` — QA / load-test accounts\n\n"
                "**How edits here affect the system**\n\n"
                "When you save this page, the backend diffs the `special_users` list "
                "against the previous version and mirrors it into the `users` table: "
                "newly-added users get `is_special = true`, removed users get "
                "`is_special = false`. Every add / remove / modify appends a row to "
                "`special_access_log` with actor, reason, and timestamp.\n\n"
                "**Revoke behavior**\n\n"
                "Revoking Special sets `is_special = false`; their data stays. "
                "`revoke_locks_communities` governs whether communities over Free "
                "limits get locked (default: `false` — we don't punish trusted users).\n\n"
                "**Expiry**\n\n"
                "Entries with `expires_at` in the past are auto-revoked by a nightly "
                "job (when `auto_revoke_expired` is on). Useful for `testing` category."
            ),
        },

        # ── Policy · Enterprise lifecycle ───────────────────────────
        {
            "slug": "enterprise-seat-join",
            "title": "Enterprise Seat — Join Flow",
            "category": "policy",
            "icon": "fa-right-to-bracket",
            "description": "What happens when a Premium user accepts an Enterprise invite. IAP vs Stripe divergence.",
            "sort_order": 40,
            "field_groups": [
                {"id": "general", "label": "General policy", "icon": "fa-compass"},
                {"id": "stripe", "label": "Stripe (web) path", "icon": "fa-credit-card"},
                {"id": "iap", "label": "Mobile IAP (Apple / Google) path", "icon": "fa-mobile-screen"},
                {"id": "copy", "label": "Notification copy", "icon": "fa-envelope"},
            ],
            "fields": [
                # General
                {"name": "allow_join_while_premium", "label": "Allow Premium user to join Enterprise", "type": "boolean", "value": True,
                 "help": "We never block the join — we resolve the double-pay on the billing side.", "group": "general"},
                {"name": "inherited_tier_label", "label": "Label shown after joining", "type": "string",
                 "value": "Premium (via Enterprise)", "group": "general"},
                {"name": "community_ownership_inherit", "label": "Enterprise membership raises personal community-ownership cap", "type": "boolean", "value": False,
                 "help": "Ownership is personal. Enterprise gives Steve, not community ownership.", "group": "general"},

                # Stripe
                {"name": "stripe_action_on_join", "label": "Action on join (Stripe personal sub)", "type": "enum",
                 "allowed_values": ["cancel_at_period_end", "cancel_immediately_prorate", "do_nothing"],
                 "value": "cancel_at_period_end",
                 "help": "Default: keep paid access through period end, then cancel. No refunds.", "group": "stripe"},
                {"name": "stripe_one_click_confirm", "label": "One-click confirmation required", "type": "boolean", "value": True, "group": "stripe"},
                {"name": "stripe_cancel_reason_code", "label": "Cancellation reason stored on Stripe sub", "type": "string",
                 "value": "joined_enterprise_community", "group": "stripe"},

                # IAP
                {"name": "iap_grace_days", "label": "Grace period (days) to cancel IAP sub", "type": "integer", "value": 7,
                 "help": "User is already inside Enterprise; we nag daily and let store billing run until they cancel.", "group": "iap"},
                {"name": "iap_daily_nag_enabled", "label": "Daily nag push/notification", "type": "boolean", "value": True, "group": "iap"},
                {"name": "iap_nag_channel", "label": "Nag channels", "type": "string", "value": "push + in-app banner + email", "group": "iap"},
                {"name": "iap_nag_stop_after_days", "label": "Stop nagging after (days)", "type": "integer", "value": 7,
                 "help": "After the grace window we stop the daily nag — user has been informed. They choose to pay twice or not.", "group": "iap"},
                {"name": "iap_auto_cancel_possible", "label": "Can we cancel the IAP subscription automatically?", "type": "boolean", "value": False,
                 "help": "No. Apple / Google require user-initiated cancellation from the store. We must guide.", "group": "iap"},
                {"name": "iap_deep_link_ios", "label": "Deep link — iOS subscriptions settings", "type": "string",
                 "value": "https://apps.apple.com/account/subscriptions", "group": "iap"},
                {"name": "iap_deep_link_android", "label": "Deep link — Google Play subscriptions", "type": "string",
                 "value": "https://play.google.com/store/account/subscriptions", "group": "iap"},

                # Copy
                {"name": "copy_join_banner_ios", "label": "In-app banner copy (iOS / Android)", "type": "markdown",
                 "value": (
                    "**You're now a member of {enterprise_name}.** Your personal Premium subscription is "
                    "still active on the App Store — but you no longer need it: Premium benefits are "
                    "already included through your Enterprise seat.\n\n"
                    "**Please cancel your personal subscription in your App Store settings** so you're "
                    "not charged next cycle.\n\n"
                    "[Open subscriptions]"
                 ), "group": "copy"},
                {"name": "copy_join_banner_stripe", "label": "In-app banner copy (Stripe)", "type": "markdown",
                 "value": (
                    "**You're now a member of {enterprise_name}.** Premium benefits are already included "
                    "through your Enterprise seat. Your personal subscription will end on "
                    "**{period_end_date}** — no action needed.\n\n"
                    "[Review]"
                 ), "group": "copy"},
                {"name": "copy_push_join", "label": "Push notification on join", "type": "string",
                 "value": "Welcome to {enterprise_name} — Premium is included. Please cancel your personal App Store sub to avoid double billing.",
                 "group": "copy"},
            ],
            "body": (
                "**Why this exists**\n\n"
                "A user with a personal €7.99 Premium subscription who joins an Enterprise community "
                "would otherwise pay twice — once personally, once through the Enterprise seat's "
                "Premium inclusion. Policy: **Enterprise supersedes personal Premium**, and we "
                "resolve the double-pay on the billing side.\n\n"
                "**Stripe (web)** — we cancel the personal subscription at period end (user keeps "
                "the month they already paid for), one-click confirm. No refund; standard SaaS norm.\n\n"
                "**Mobile IAP** — Apple/Google don't let us cancel on the user's behalf. We let them "
                "into the Enterprise community immediately, then nag daily (`iap_grace_days`) with a "
                "deep link to the store subscriptions page. If they ignore the nag past "
                "`iap_nag_stop_after_days`, we stop — we've done our duty, they're informed.\n\n"
                "**Community ownership is not inherited** — Enterprise gives Steve, not ownership. "
                "Users keep their personal `premium_communities_max` cap."
            ),
        },
        {
            "slug": "enterprise-seat-end",
            "title": "Enterprise Seat — End Flow",
            "category": "policy",
            "icon": "fa-right-from-bracket",
            "description": "Scenarios when an Enterprise seat ends — CTA, grace, winback promo.",
            "sort_order": 50,
            "field_groups": [
                {"id": "grace", "label": "Grace windows", "icon": "fa-hourglass-half"},
                {"id": "winback", "label": "Winback promo", "icon": "fa-gift"},
                {"id": "scenarios", "label": "Scenarios matrix", "icon": "fa-table"},
                {"id": "copy", "label": "Copy templates", "icon": "fa-envelope"},
            ],
            "fields": [
                # Grace
                {"name": "grace_days_voluntary_leave", "label": "Grace days — user left voluntarily", "type": "integer", "value": 0,
                 "help": "User chose to leave; no reason to extend Premium.", "group": "grace"},
                {"name": "grace_days_removed_by_admin", "label": "Grace days — removed by admin", "type": "integer", "value": 3,
                 "help": "Softens involuntary removal.", "group": "grace"},
                {"name": "grace_days_community_downgrade", "label": "Grace days — community dropped Enterprise", "type": "integer", "value": 7,
                 "help": "Whole community loses Enterprise; members get 7 days Premium to decide.", "group": "grace"},
                {"name": "grace_days_nonpayment", "label": "Grace days — Enterprise non-payment", "type": "integer", "value": 3, "group": "grace"},
                {"name": "grace_notification_schedule", "label": "Notifications during grace", "type": "string",
                 "value": "Day 0 (trigger), Day 1, Day N-1, Day N (final).", "group": "grace"},

                # Winback
                {"name": "winback_enabled", "label": "Winback promo enabled", "type": "boolean", "value": True, "group": "winback"},
                {"name": "winback_one_time_only", "label": "One-time only per user", "type": "boolean", "value": True, "group": "winback"},
                {"name": "winback_eligibility", "label": "Eligibility", "type": "string",
                 "value": "User cancelled personal Premium specifically to join Enterprise (return-intent flag set at join), and seat has now ended.",
                 "group": "winback"},
                {"name": "winback_first_month_price_eur", "label": "First month promo price", "type": "decimal", "prefix": "€", "value": 3.99, "group": "winback"},
                {"name": "winback_then_price_eur", "label": "Renewal price after promo", "type": "decimal", "prefix": "€", "value": 7.99, "group": "winback"},
                {"name": "winback_expires_days", "label": "Promo expires after (days)", "type": "integer", "value": 14, "group": "winback"},
                {"name": "winback_promo_code_prefix", "label": "Promo code prefix", "type": "string", "value": "WINBACK-", "group": "winback"},

                # Scenarios
                {"name": "scenarios_matrix", "label": "Scenarios", "type": "list_of_objects",
                 "group": "scenarios",
                 "schema": [
                     {"name": "scenario", "type": "string", "label": "Scenario"},
                     {"name": "trigger", "type": "string", "label": "Trigger"},
                     {"name": "grace_days", "type": "integer", "label": "Grace days"},
                     {"name": "winback_eligible", "type": "boolean", "label": "Winback eligible"},
                     {"name": "cta", "type": "string", "label": "Primary CTA"},
                     {"name": "notes", "type": "string", "label": "Notes"},
                 ],
                 "value": [
                     {"scenario": "User leaves community voluntarily", "trigger": "user.leave", "grace_days": 0,
                      "winback_eligible": True,
                      "cta": "Subscribe to Premium — first month €3.99",
                      "notes": "Seat ends immediately. Show winback on the leave confirmation."},
                     {"scenario": "User removed by Enterprise admin", "trigger": "admin.remove_member", "grace_days": 3,
                      "winback_eligible": True,
                      "cta": "Continue with Premium — first month €3.99",
                      "notes": "3-day Premium grace. In-app + email on day 0, 2, 3."},
                     {"scenario": "User removed for misconduct (admin)", "trigger": "admin.remove_member.flag_abuse", "grace_days": 0,
                      "winback_eligible": False,
                      "cta": "Subscribe to Premium",
                      "notes": "No grace, no winback. Admin flag disables promo."},
                     {"scenario": "Community drops from Enterprise → Paid", "trigger": "community.downgrade_enterprise", "grace_days": 7,
                      "winback_eligible": True,
                      "cta": "Keep Premium benefits — first month €3.99",
                      "notes": "All members get 7-day grace + winback. Big event, fair window."},
                     {"scenario": "Community cancels entirely", "trigger": "community.cancel", "grace_days": 7,
                      "winback_eligible": True,
                      "cta": "Keep Premium — first month €3.99",
                      "notes": "As above."},
                     {"scenario": "Enterprise subscription lapses (non-payment)", "trigger": "enterprise.payment_failed_final", "grace_days": 3,
                      "winback_eligible": True,
                      "cta": "Subscribe to Premium to stay with Steve",
                      "notes": "Short grace; owner still has 14-day dunning separately."},
                     {"scenario": "Seat reassigned to someone else", "trigger": "enterprise.seat_reassigned", "grace_days": 0,
                      "winback_eligible": True,
                      "cta": "Continue Premium — first month €3.99",
                      "notes": "Admin action; no fault of user."},
                     {"scenario": "User account deleted", "trigger": "user.delete", "grace_days": 0,
                      "winback_eligible": False,
                      "cta": "—",
                      "notes": "No CTA (account gone)."},
                     {"scenario": "User was on Enterprise but ALSO kept personal IAP running", "trigger": "any_seat_end + iap_active",
                      "grace_days": 0,
                      "winback_eligible": False,
                      "cta": "(none — they're already paying)",
                      "notes": "They never cancelled IAP despite nag; no winback owed."},
                     {"scenario": "User was on Enterprise but ALSO kept personal Stripe running", "trigger": "any_seat_end + stripe_active",
                      "grace_days": 0,
                      "winback_eligible": False,
                      "cta": "(none)",
                      "notes": "Edge case — if cancel-at-period-end didn't fire. Log it for investigation."},
                     {"scenario": "Admin downgrades enterprise seat type but user stays", "trigger": "enterprise.seat_type_downgrade",
                      "grace_days": 0,
                      "winback_eligible": False,
                      "cta": "(none)",
                      "notes": "Still in community; no seat end."},
                     {"scenario": "Enterprise community migrated to new owner (no interruption)", "trigger": "enterprise.owner_transfer",
                      "grace_days": 0,
                      "winback_eligible": False,
                      "cta": "(none)",
                      "notes": "No seat change for members."},
                     {"scenario": "Community Enterprise → Free (rare; usually Paid intermediate)", "trigger": "community.downgrade_to_free",
                      "grace_days": 7,
                      "winback_eligible": True,
                      "cta": "Keep Premium — first month €3.99",
                      "notes": "Same as Enterprise → Paid."},
                     {"scenario": "User joined Enterprise < 7 days ago and leaves", "trigger": "user.leave.short_tenure",
                      "grace_days": 0,
                      "winback_eligible": True,
                      "cta": "Subscribe to Premium — first month €3.99",
                      "notes": "Winback still available; helps trial-like UX."},
                     {"scenario": "Enterprise trial expires without conversion", "trigger": "enterprise.trial_expired",
                      "grace_days": 3,
                      "winback_eligible": True,
                      "cta": "Subscribe personally — first month €3.99",
                      "notes": "Owner decided not to buy; members get soft landing."},
                 ]},

                # Copy
                {"name": "copy_seat_end_cta", "label": "Push / banner on seat end", "type": "markdown",
                 "value": (
                    "**Your Enterprise seat at {community_name} has ended.**\n\n"
                    "To keep Steve, voice summaries, and your Premium perks, subscribe now — "
                    "first month is €{winback_first_month_price_eur}.\n\n"
                    "[Continue with Premium]"
                 ), "group": "copy"},
                {"name": "copy_email_seat_end", "label": "Email — seat end", "type": "markdown",
                 "value": (
                    "Hi {display_name},\n\n"
                    "Thanks for trusting us with your Steve usage through {community_name}. Your "
                    "Enterprise seat has ended, so Steve will pause in {grace_days} day(s) unless "
                    "you subscribe.\n\n"
                    "As a thank-you, your first month of Premium is €{winback_first_month_price_eur} "
                    "(then €{winback_then_price_eur}/month). Promo expires in {winback_expires_days} "
                    "days.\n\n"
                    "[Subscribe now]\n\n"
                    "— The C-Point team"
                 ), "group": "copy"},
                {"name": "copy_no_winback", "label": "Seat-end copy when not winback-eligible", "type": "markdown",
                 "value": (
                    "**Your Enterprise seat at {community_name} has ended.**\n\n"
                    "Steve and voice/post summaries will pause. You can subscribe to Premium any "
                    "time to continue.\n\n"
                    "[Subscribe]"
                 ), "group": "copy"},
            ],
            "body": (
                "**Principle**: every user leaving Enterprise gets a CTA. We never silently cut "
                "Steve — that feels broken.\n\n"
                "**Grace days** vary by trigger (see `scenarios_matrix`). The rule of thumb:\n\n"
                "- Voluntary leave → 0 days (user chose this).\n"
                "- Admin removal → 3 days (softens involuntary).\n"
                "- Community-wide change → 7 days (big event, fair window).\n"
                "- Non-payment → 3 days.\n\n"
                "**Winback promo** (`winback_*`): one-time-only, `winback_first_month_price_eur` for "
                "the first month, then standard price. Eligible when the user cancelled their "
                "personal Premium *specifically* to join Enterprise (return-intent flag set at "
                "join time). One-time per user to prevent abuse.\n\n"
                "**Not winback-eligible**: users removed for misconduct, users who never had "
                "personal Premium pre-Enterprise, users who double-paid through Enterprise (they "
                "don't need a discount — they need a refund discussion, case by case).\n\n"
                "**Copy tokens** (`{community_name}`, `{grace_days}`, `{winback_*}`) are expanded "
                "by the notification service. All templates are editable — change here, no deploy."
            ),
        },

        # ── Planning ────────────────────────────────────────────────
        {
            "slug": "product-roadmap",
            "title": "Product Roadmap",
            "category": "planning",
            "icon": "fa-map",
            "description": "Phased plan for upcoming features.",
            "sort_order": 10,
            "fields": [
                {
                    "name": "roadmap_items",
                    "label": "Roadmap items",
                    "type": "list_of_objects",
                    "schema": [
                        {"name": "title", "type": "string", "label": "Title"},
                        {"name": "phase", "type": "enum", "label": "Phase",
                         "allowed_values": ["now", "next", "later", "exploring"]},
                        {"name": "status", "type": "enum", "label": "Status",
                         "allowed_values": ["not_started", "ongoing", "completed"]},
                        {"name": "effort", "type": "enum", "label": "Effort",
                         "allowed_values": ["S", "M", "L", "XL"]},
                        {"name": "target_quarter", "type": "string", "label": "Target quarter"},
                        # Test traceability — Option C hybrid: the roadmap
                        # row points at *the* canonical behaviour in the
                        # Tests page (free-text ref, kept short), plus a
                        # stand-alone rollup status so the roadmap alone
                        # tells you whether shipping it broke anything.
                        {"name": "test", "type": "string", "label": "Test",
                         "help": "Short ref to the matching Tests-page row (e.g. 'ai_usage:whisper_minutes')."},
                        {"name": "test_status", "type": "enum", "label": "Test status",
                         "allowed_values": ["not_run", "successful", "unsuccessful"]},
                        {"name": "notes", "type": "markdown", "label": "Notes"},
                    ],
                    "value": [
                        {"title": "Admin-web: Knowledge Base (this system)", "phase": "now", "status": "completed", "effort": "M", "target_quarter": "2026-Q2", "notes": "The page you're reading. Seeded + editable + changelog."},
                        {"title": "KB: field groups, networking page, Steve package, content-gen safety, special users", "phase": "now", "status": "ongoing", "effort": "M", "target_quarter": "2026-Q2", "notes": "Round 2 of KB content."},
                        {"title": "Usage / credit calculator (admin)", "phase": "now", "status": "ongoing", "effort": "M", "target_quarter": "2026-Q2", "notes": "Single-call, month sim, pricing what-if."},
                        {"title": "Entitlements service reads directly from KB", "phase": "now", "status": "ongoing", "effort": "M", "target_quarter": "2026-Q2", "notes": "resolve_entitlements(username). Whitelist of KB fields."},
                        {"title": "Special users table + audit log", "phase": "now", "status": "ongoing", "effort": "S", "target_quarter": "2026-Q2", "notes": "users.is_special + special_access_log."},
                        {"title": "Membership management UI (account settings)", "phase": "now", "status": "not_started", "effort": "M", "target_quarter": "2026-Q2", "notes": "Plan switcher, cancel, invoice history."},
                        {"title": "Stripe integration (web subscriptions + portal)", "phase": "now", "status": "not_started", "effort": "L", "target_quarter": "2026-Q2", "notes": "Web-only first; IAP comes in Phase 2."},
                        {"title": "Credit tracking + display (X / 100 Steve uses)", "phase": "now", "status": "not_started", "effort": "M", "target_quarter": "2026-Q2", "notes": "Requires ai_usage_log extension with credit weights."},
                        {"title": "Admin-web: Premium / Special columns on Users tab", "phase": "now", "status": "not_started", "effort": "S", "target_quarter": "2026-Q2", "notes": "Grant/Revoke Special from row action."},
                        {"title": "Trial countdown + soft conversion flow", "phase": "now", "status": "not_started", "effort": "M", "target_quarter": "2026-Q2", "notes": "Email sequence at days 7 / 14 / 25 / 28."},
                        {"title": "Email normalization + canonical_email on users", "phase": "now", "status": "ongoing", "effort": "S", "target_quarter": "2026-Q2", "test": "signup:canonical_uniqueness", "test_status": "not_run", "notes": "Shipped: backend/services/email_normalization.py + users.canonical_email column + signup uniqueness on canonical. Blocks the Gmail dot/plus alias trick. Flip to completed after CI is green + a staging signup smoke run."},
                        {"title": "Disposable-email blocklist enforcement", "phase": "now", "status": "ongoing", "effort": "S", "target_quarter": "2026-Q2", "test": "signup:disposable_email_blocked", "test_status": "not_run", "notes": "Shipped: backend/services/disposable_email.py + bundled list at backend/data/disposable_email_domains.txt + KB-driven toggle + extras. Refresh the bundled list quarterly from github.com/disposable-email-domains."},
                        {"title": "Paid community subscriptions + community billing", "phase": "next", "status": "not_started", "effort": "L", "target_quarter": "2026-Q3", "notes": ""},
                        {"title": "Paid community Steve package add-on (shared pool)", "phase": "next", "status": "not_started", "effort": "L", "target_quarter": "2026-Q3", "notes": "Pool-first priority for Premium members."},
                        {"title": "Networking page (public directory)", "phase": "next", "status": "not_started", "effort": "L", "target_quarter": "2026-Q3", "notes": "Included in Enterprise; add-on for Paid."},
                        {"title": "Content generation feature (paid community)", "phase": "next", "status": "not_started", "effort": "L", "target_quarter": "2026-Q3", "notes": "Option A allowance + safety knobs + autopause."},
                        {"title": "Media quota enforcement (per-community, Slack-style)", "phase": "next", "status": "not_started", "effort": "M", "target_quarter": "2026-Q3", "notes": ""},
                        {"title": "Apple IAP + Google Play integration", "phase": "next", "status": "not_started", "effort": "L", "target_quarter": "2026-Q3", "notes": "Same public price across channels."},
                        {"title": "max_tool_invocations hard cap", "phase": "next", "status": "not_started", "effort": "S", "target_quarter": "2026-Q3", "notes": "Prevents worst-case per-turn cost."},
                        {"title": "Per-user monthly spend circuit breaker", "phase": "next", "status": "not_started", "effort": "M", "target_quarter": "2026-Q3", "notes": ""},
                        {"title": "Device fingerprint + IP/ASN signup throttle", "phase": "next", "status": "not_started", "effort": "M", "target_quarter": "2026-Q3", "notes": "Activate only if free-trial abuse materializes."},
                        {"title": "Nightly cron: auto-revoke expired Special grants", "phase": "next", "status": "not_started", "effort": "S", "target_quarter": "2026-Q3", "notes": ""},
                        {"title": "Annual plan promotion + discount flow", "phase": "later", "status": "not_started", "effort": "M", "target_quarter": "2026-Q4", "notes": ""},
                        {"title": "Credit top-up packs (overage)", "phase": "later", "status": "not_started", "effort": "M", "target_quarter": "2026-Q4", "notes": ""},
                        {"title": "Enterprise onboarding + custom pricing flow", "phase": "later", "status": "not_started", "effort": "L", "target_quarter": "2026-Q4", "notes": ""},
                        {"title": "Voice calls (Steve-moderated / 1:1 / group)", "phase": "later", "status": "not_started", "effort": "XL", "target_quarter": "2027-Q1", "notes": "Will change cost model — revisit Credits page before launch."},
                        {"title": "Steve-powered networking search", "phase": "later", "status": "not_started", "effort": "L", "target_quarter": "2027-Q1", "notes": "Adds a new cost line. Re-check Credits."},
                        {"title": "Local/self-hosted Whisper to reduce OpenAI cost", "phase": "exploring", "status": "not_started", "effort": "L", "target_quarter": "TBD", "notes": ""},
                        {"title": "Group 'catch me up' summaries (last 24h)", "phase": "exploring", "status": "not_started", "effort": "M", "target_quarter": "TBD", "notes": ""},
                        {"title": "Card authorization for trials (if abuse > 5%)", "phase": "exploring", "status": "not_started", "effort": "M", "target_quarter": "TBD", "notes": ""},
                        {"title": "Referral credits", "phase": "exploring", "status": "not_started", "effort": "M", "target_quarter": "TBD", "notes": ""},
                    ],
                },
            ],
            "body": (
                "Phases:\n\n"
                "- **Now** — Phase 1, next 4–6 weeks\n"
                "- **Next** — Phase 2, Q3\n"
                "- **Later** — Phase 3, Q4+\n"
                "- **Exploring** — not committed, evaluating\n\n"
                "Each item has a phase, rough effort (S/M/L/XL), and target quarter."
            ),
        },

        # ── Reference ───────────────────────────────────────────────
        {
            "slug": "glossary",
            "title": "Glossary",
            "category": "reference",
            "icon": "fa-book",
            "description": "Canonical terms — the page Steve reads to stop hallucinating.",
            "sort_order": 10,
            "fields": [
                {
                    "name": "terms",
                    "label": "Terms",
                    "type": "list_of_objects",
                    "schema": [
                        {"name": "term", "type": "string", "label": "Term"},
                        {"name": "definition", "type": "string", "label": "Definition"},
                    ],
                    "value": [
                        {"term": "Steve call", "definition": "Any inference request to Steve that produces a user-visible reply (DM, group, feed, post summary, voice summary). Counts as 1 user-facing use; internal cost varies by weight."},
                        {"term": "Credit", "definition": "Internal accounting unit. Not exposed to users. DM=1, group=3, feed=3, post summary=2, voice minute=1. Content-gen weights live on Credits & Entitlements."},
                        {"term": "Free community", "definition": "≤50 members, no content creation, not listed on networking, low media quota."},
                        {"term": "Paid community", "definition": "Subscription-based. No hard member limit. Content creation opt-in with free allowance. Networking page + Steve package sold as add-ons."},
                        {"term": "Enterprise community", "definition": "Custom subscription. Members get Premium Steve. Steve package + networking page + content generation all bundled."},
                        {"term": "Steve package", "definition": "Paid-community add-on (~€20/month). Gives the community a shared Steve credit pool that members use before their personal credits."},
                        {"term": "Networking page", "definition": "Public directory of C-Point communities. Appears for communities with ≥50 members. Included in Enterprise; €15/month add-on for Paid."},
                        {"term": "Premium user", "definition": "Subscriber of €4.99 (early-adoption, first 3 months) / €7.99 (standard). Steve + voice/post summaries + 10 owned communities."},
                        {"term": "Free trial", "definition": "30-day Premium-equivalent access on signup. Community ownership capped at 5 (not Premium's 10)."},
                        {"term": "Free user", "definition": "No Steve. Up to 5 free communities owned."},
                        {"term": "Special user", "definition": "Admin / founder / staff / friends & family with unlimited business entitlements but still-enforced technical caps. See Policy → Special Users."},
                        {"term": "AI daily limit", "definition": "AI_DAILY_LIMIT = 10 calls / 24h for Premium; 200 for Special. Hard per-user cap."},
                        {"term": "Circuit breaker", "definition": "Monthly AI spend hard stop: €3.99/user (Premium) or €50 (Special). Freezes AI for the rest of the period."},
                        {"term": "Canonical email", "definition": "Lowercased, dot-stripped, plus-stripped version of the user's email. Used for one-account-per-person enforcement."},
                        {"term": "Content generation", "definition": "Automated content drafts for paid communities (motivation DMs, news roundups, Steve takes). Debited from the community Steve pool or a small free allowance. Paid communities only; Enterprise unlimited."},
                        {"term": "Enterprise seat", "definition": "A Premium-equivalent AI entitlement a user gets by being a member of an Enterprise community. Ends when the user leaves, is removed, or the community loses Enterprise status."},
                        {"term": "Effective tier", "definition": "The tier the entitlements system actually applies. Computed: Special > Enterprise-derived > Personal Premium > Trial > Free. Shown in Account Settings."},
                        {"term": "Personal Premium", "definition": "A Premium subscription paid directly by the user (Stripe web or mobile IAP). Distinct from 'Premium via Enterprise'."},
                        {"term": "IAP nag", "definition": "Daily in-app banner + push reminding a user to cancel their personal Apple/Google Premium subscription after they join Enterprise. Runs for `iap_grace_days`. Stops after `iap_nag_stop_after_days`."},
                        {"term": "Grace window", "definition": "Period between an Enterprise seat ending and Steve actually pausing. Duration depends on trigger (see Enterprise Seat — End Flow)."},
                        {"term": "Winback promo", "definition": "One-time €3.99 first-month offer for users whose Enterprise seat ended and who had cancelled personal Premium to join. Expires in 14 days."},
                        {"term": "Return-intent flag", "definition": "Set on the user row when a Premium user cancels personal Premium specifically to join Enterprise. Used at seat-end time to decide winback eligibility."},
                        {"term": "Cancel at period end", "definition": "Stripe cancellation that leaves the subscription active until its current period's end, then stops billing. Our default action when a Premium user joins Enterprise."},
                    ],
                },
            ],
            "body": "Short, canonical, one line each. This page should be readable by Steve as retrieval context when a user asks about limits, pricing, or tier definitions.",
        },

        # ── Audit ───────────────────────────────────────────────────
        {
            "slug": "tests",
            "title": "Tests",
            "category": "audit",
            "icon": "fa-vial-circle-check",
            "description": (
                "Authoritative test tracker — one row per behaviour the "
                "platform promises. 'Run now' re-executes the associated "
                "pytest / smoke script and updates the status pill."
            ),
            "sort_order": 5,
            "fields": [
                {
                    "name": "tests",
                    "label": "Test suites",
                    "type": "list_of_objects",
                    "schema": [
                        {"name": "id", "type": "string", "label": "ID",
                         "help": "Stable key used by scripts to update status (e.g. 'ai_usage:whisper_minutes')."},
                        {"name": "feature", "type": "string", "label": "Feature",
                         "help": "Which KB page / product area this test covers."},
                        {"name": "behaviour", "type": "string", "label": "Behaviour under test"},
                        {"name": "runner", "type": "enum", "label": "Runner",
                         "allowed_values": ["pytest", "powershell", "manual"]},
                        {"name": "target", "type": "string", "label": "Target",
                         "help": "pytest node-id OR script path. e.g. 'tests/test_ai_usage_counters.py::TestWhisperMinutes'."},
                        {"name": "status", "type": "enum", "label": "Status",
                         "allowed_values": ["not_run", "successful", "unsuccessful"]},
                        {"name": "last_run_at", "type": "string", "label": "Last run (UTC)"},
                        {"name": "last_run_by", "type": "string", "label": "Last run by"},
                        {"name": "last_run_notes", "type": "markdown", "label": "Last run notes"},
                    ],
                    "value": [
                        {
                            "id": "ai_usage:whisper_minutes",
                            "feature": "Credits & Entitlements",
                            "behaviour": "whisper_minutes_this_month sums successful whisper rows only.",
                            "runner": "pytest",
                            "target": "tests/test_ai_usage_counters.py::TestWhisperMinutes",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "ai_usage:daily_vs_monthly",
                            "feature": "Credits & Entitlements",
                            "behaviour": "daily_count is scoped to STEVE_SURFACES and never exceeds monthly_steve_count.",
                            "runner": "pytest",
                            "target": "tests/test_ai_usage_counters.py::TestDailyMonthlyConsistency",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "ai_usage:blocked_rows_excluded",
                            "feature": "Credits & Entitlements",
                            "behaviour": "Rows with success=0 are logged but excluded from counters.",
                            "runner": "pytest",
                            "target": "tests/test_ai_usage_counters.py::TestBlockedRowsExcluded",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "ai_usage:summary_consistency",
                            "feature": "Manage Membership — AI Usage",
                            "behaviour": "current_month_summary() matches the individual counters.",
                            "runner": "pytest",
                            "target": "tests/test_ai_usage_counters.py::TestCurrentMonthSummary",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "entitlements:tier_resolution",
                            "feature": "User Tiers",
                            "behaviour": "Tier priority Special > Premium > Trial > Free.",
                            "runner": "pytest",
                            "target": "tests/test_entitlements_resolve.py::TestTierResolution",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "entitlements:enterprise_seat",
                            "feature": "Enterprise Seat lifecycle",
                            "behaviour": "Enterprise seat flips Free → Premium and stamps inherited_from.",
                            "runner": "pytest",
                            "target": "tests/test_entitlements_resolve.py::TestEnterpriseSeatInteraction",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "entitlements:kb_driven_config",
                            "feature": "Credits & Entitlements",
                            "behaviour": "KB edits to caps flow into resolve_entitlements() without redeploy.",
                            "runner": "pytest",
                            "target": "tests/test_entitlements_resolve.py::TestKBDrivenConfiguration",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "entitlements:invariants",
                            "feature": "Hard Limits",
                            "behaviour": "Every tier gets technical safety caps + weights.",
                            "runner": "pytest",
                            "target": "tests/test_entitlements_resolve.py::TestCrossCuttingInvariants",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "entitlements:per_tier_member_caps",
                            "feature": "User Tiers — community caps decoupled from subscription",
                            "behaviour": "resolve_entitlements() reads free_members_per_owned_community from the KB for Free/Trial; Premium / Special report members_per_owned_community = None because per-community member caps now live on the community's own tier (Free 25, Paid L1 75 / L2 150 / L3 250, Enterprise unlimited), not on the owner's user tier. Locks both the original 100-member bug and the Phase-3 (April 2026) decoupling.",
                            "runner": "pytest",
                            "target": "tests/test_entitlements_resolve.py::TestPerTierMemberCaps",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "staging:webhooks_not_401",
                            "feature": "Stripe / Apple / Google webhooks",
                            "behaviour": "Webhook endpoints reject unsigned requests with 400 (not 401 from session middleware).",
                            "runner": "powershell",
                            "target": "scripts/staging_smoke.ps1",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "staging:cron_auth",
                            "feature": "Cloud Scheduler cron",
                            "behaviour": "Cron endpoints require X-Cron-Secret (403 without, 200 with).",
                            "runner": "powershell",
                            "target": "scripts/staging_smoke.ps1",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "staging:kb_auth",
                            "feature": "Knowledge Base admin API",
                            "behaviour": "GET /api/admin/kb/pages denies unauthenticated callers with 401.",
                            "runner": "powershell",
                            "target": "scripts/staging_smoke.ps1",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "manual:voice_note_ui",
                            "feature": "Voice-note DM / group / feed",
                            "behaviour": "Uploading a voice note adds whisper minutes AND a voice_summary row (verified via Manage Membership modal).",
                            "runner": "manual",
                            "target": "QA_CHECKLIST.md §3",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "manual:enterprise_invite_nag",
                            "feature": "Enterprise Seat — Join flow",
                            "behaviour": "Joining an Enterprise community while holding personal IAP Premium shows the daily nag banner.",
                            "runner": "manual",
                            "target": "QA_CHECKLIST.md §5",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "signup:email_normalization",
                            "feature": "Trial & Abuse Prevention",
                            "behaviour": "canonical_email() collapses Gmail dot/plus aliases and lowercases; non-Gmail domains keep their dots.",
                            "runner": "pytest",
                            "target": "tests/test_email_normalization.py",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "signup:disposable_email_blocked",
                            "feature": "Trial & Abuse Prevention",
                            "behaviour": "Signup rejects addresses on the bundled disposable-domain list; KB toggle gates enforcement; legitimate providers pass.",
                            "runner": "pytest",
                            "target": "tests/test_disposable_email.py",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                        {
                            "id": "signup:canonical_uniqueness",
                            "feature": "Trial & Abuse Prevention",
                            "behaviour": "Signup uniqueness check collides on canonical_email, blocking Gmail dot/plus alias abuse while allowing distinct users.",
                            "runner": "pytest",
                            "target": "tests/test_signup_canonical_uniqueness.py",
                            "status": "not_run",
                            "last_run_at": "", "last_run_by": "", "last_run_notes": "",
                        },
                    ],
                },
            ],
            "body": (
                "Each row is one **observable behaviour**, not one code path. "
                "Update the ``status`` pill after each run — the 'Run now' "
                "button on the admin-web calls ``PATCH /api/admin/kb/tests/<id>/status`` "
                "and, for pytest / powershell runners, can optionally kick off "
                "the actual run via the CI.\n\n"
                "Add new rows whenever you ship a new feature. The ``id`` is a "
                "stable key — never rename one once shipped; create a new row "
                "if the behaviour changes substantively.\n\n"
                "See also: ``docs/QA_CHECKLIST.md`` for manual verification "
                "steps that aren't tracked as individual rows."
            ),
        },

        {
            "slug": "changelog",
            "title": "Changelog",
            "category": "audit",
            "icon": "fa-clock-rotate-left",
            "description": "Read-only view of every KB edit. Auto-populated on save.",
            "sort_order": 10,
            "fields": [],
            "body": (
                "This page is **auto-generated** from the `kb_changelog` table. Every time any "
                "field or body is saved on any page, a row is appended here with:\n\n"
                "- timestamp\n"
                "- page\n"
                "- editor\n"
                "- version number\n"
                "- list of field changes (from → to)\n"
                "- reason (required at save time)\n\n"
                "No manual editing on this page. See the Changelog viewer at the top of the "
                "KB sidebar."
            ),
        },
    ]


def seed_default_pages(force: bool = False) -> Dict[str, int]:
    """Idempotent seeding with auto-upgrade of untouched pages.

    Behavior per page:
      * Page does NOT exist                    → INSERT (counted as inserted).
      * Page exists, version == 1, updated_by == 'system-seed'  → UPDATE with
        latest seed content, preserving the existing version number
        (counted as auto_upgraded). Admin has not yet edited, so safe to
        replace.
      * Page exists and has been edited         → SKIP, unless force=True.
      * force=True                              → overwrite regardless.
    """
    ensure_tables()
    ph = get_sql_placeholder()
    seeds = _seed_pages()
    inserted = 0
    auto_upgraded = 0
    force_updated = 0
    skipped = 0

    with get_db_connection() as conn:
        c = conn.cursor()
        for seed in seeds:
            c.execute(
                f"SELECT version, updated_by FROM kb_pages WHERE slug = {ph}",
                (seed["slug"],),
            )
            row = c.fetchone()
            now = _utc_now_str()
            fields_json = json.dumps(seed.get("fields") or [])
            field_groups_json = json.dumps(seed.get("field_groups") or [])
            body = seed.get("body") or ""

            if row is None:
                c.execute(
                    f"""
                    INSERT INTO kb_pages
                        (slug, title, category, icon, description, sort_order,
                         fields_json, field_groups_json, body_markdown,
                         version, updated_by, created_at, updated_at)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph},
                            1, {ph}, {ph}, {ph})
                    """,
                    (
                        seed["slug"], seed["title"], seed["category"], seed.get("icon"),
                        seed.get("description"), seed.get("sort_order", 0),
                        fields_json, field_groups_json, body,
                        "system-seed", now, now,
                    ),
                )
                inserted += 1
                continue

            # Row exists — decide whether to overwrite.
            existing_version = row["version"] if hasattr(row, "keys") else row[0]
            existing_updated_by = row["updated_by"] if hasattr(row, "keys") else row[1]
            is_untouched = (int(existing_version or 1) == 1
                            and (existing_updated_by or "").strip().lower() == "system-seed")

            if not force and not is_untouched:
                skipped += 1
                continue

            c.execute(
                f"""
                UPDATE kb_pages SET
                    title = {ph}, category = {ph}, icon = {ph},
                    description = {ph}, sort_order = {ph},
                    fields_json = {ph}, field_groups_json = {ph},
                    body_markdown = {ph},
                    updated_by = {ph}, updated_at = {ph}
                WHERE slug = {ph}
                """,
                (
                    seed["title"], seed["category"], seed.get("icon"),
                    seed.get("description"), seed.get("sort_order", 0),
                    fields_json, field_groups_json, body,
                    "system-seed", now, seed["slug"],
                ),
            )
            if is_untouched and not force:
                auto_upgraded += 1
            else:
                force_updated += 1

        try:
            conn.commit()
        except Exception:
            pass

    return {
        "inserted": inserted,
        "auto_upgraded": auto_upgraded,
        "force_updated": force_updated,
        "skipped": skipped,
        "total_seeds": len(seeds),
    }


def get_categories() -> List[Dict[str, str]]:
    return list(CATEGORIES)
