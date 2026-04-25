"""Steve community welcome post + owner DM.

Single source of truth for the welcome flow that fires when a community is
created (or back-filled). Card content lives in ``docs/STEVE_COMMUNITY_WELCOME.md``;
copy here is the rendered version of those cards.

Hard invariants (see ``docs/STEVE_COMMUNITY_WELCOME.md`` for the full list):
- Each community has at most one Steve welcome post (tracked by
  ``communities.welcome_post_id``); operations are idempotent.
- Welcome posts are deterministic card renders, not LLM generations.
- Posts are flagged ``is_system_post = 1`` and auto-pinned to the *Key Posts*
  tab via ``community_key_posts``.
- The skip list (``paulo``, ``admin``, ``steve``) suppresses the entire flow.
- Steve is never referred to as an assistant. See ``docs/STEVE_PERSONA.md``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from backend.services.content_generation.delivery import ensure_steve_user, send_steve_dm
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.firestore_writes import write_post
from redis_cache import invalidate_community_cache

logger = logging.getLogger(__name__)


WELCOME_CARD_VERSION = 1

CARD_KEY_ROOT = "welcome.root"
CARD_KEY_SUB = "welcome.sub"
CARD_KEY_BUSINESS = "welcome.business"

SYSTEM_AUTHOR = "steve"

SKIP_OWNERS = frozenset({"paulo", "admin", "steve"})

# Owner DM cohort thresholds (UTC) — see docs/STEVE_COMMUNITY_WELCOME.md.
DM_COHORT_FRESH_HOURS = 48
DM_COHORT_LATE_DAYS = 7

# Window during which the owner / admin cannot delete the welcome post.
WELCOME_POST_DELETE_LOCK_DAYS = 7


# ---------------------------------------------------------------------------
# Schema migrations (idempotent)
# ---------------------------------------------------------------------------

def ensure_welcome_columns(cursor) -> None:
    """Add the welcome-post bookkeeping columns if they're missing.

    We follow the existing migration-light pattern in the monolith: ALTER
    TABLE inside try/except, no Alembic. Calling this is cheap and idempotent.
    """
    statements = (
        "ALTER TABLE posts ADD COLUMN is_system_post TINYINT(1) DEFAULT 0",
        "ALTER TABLE posts ADD COLUMN author_kind VARCHAR(16) DEFAULT 'user'",
        "ALTER TABLE posts ADD COLUMN welcome_card_key VARCHAR(64)",
        "ALTER TABLE posts ADD COLUMN welcome_card_version INTEGER",
        "ALTER TABLE communities ADD COLUMN welcome_post_id INTEGER",
    )
    for stmt in statements:
        try:
            cursor.execute(stmt)
        except Exception:
            # Column already exists (or the engine doesn't support
            # IF NOT EXISTS for ALTER); both are fine.
            pass


# ---------------------------------------------------------------------------
# Card rendering
# ---------------------------------------------------------------------------

_BULLETS_BASE = (
    "- **Posts** — share text, photos, videos, audio, links, or polls.\n"
    "- **Stories** — quick photo/video moments that disappear in 24h.\n"
    "- **Reactions & replies** — long-press any post to react or reply.\n"
    "- **Summarise** — tap the **Summarise** button on long threads to get the gist.\n"
    "- **Key Posts** — pinned highlights live in the *Key Posts* tab so people can find them later.\n"
    "- **Links & Docs** — every link or document shared here, in one tab.\n"
    "- **Media** — every photo and video shared here, in one gallery.\n"
)

_BULLETS_TAIL = (
    "- **Hide or report** — see something off? Hide it just for you, or report it.\n"
    "- **Tag me in** — tag **@steve** in any post or reply if you want my take.\n"
)

_BULLETS_BUSINESS_EXTRA = "- **Member directory** — see who's in the community.\n"

_CLOSER = "I'm also pinned at the top of your chats — **DM me anytime** for anything."


def _pick_card_key(community_type: Optional[str], parent_community_id) -> str:
    ctype = (community_type or "").strip().lower()
    if ctype == "business":
        return CARD_KEY_BUSINESS
    if parent_community_id:
        return CARD_KEY_SUB
    return CARD_KEY_ROOT


def render_welcome_post(
    *,
    card_key: str,
    community_name: str,
    parent_community_name: Optional[str] = None,
) -> str:
    """Render the welcome-post body for a given card variant.

    Pure function. No DB access. The output is the markdown shipped to the
    feed. Don't add LLM rewriting here — see persona / drift guarantees.
    """
    name = (community_name or "").strip() or "your community"
    header = f"**Welcome to {name} \U0001F44B**\n*Posted by Steve.*\n"

    bullets = _BULLETS_BASE
    if card_key == CARD_KEY_BUSINESS:
        # Insert the business-only bullet right before the privacy/tag-me tail.
        bullets = bullets + _BULLETS_BUSINESS_EXTRA
    bullets = bullets + _BULLETS_TAIL

    sub_intro = ""
    if card_key == CARD_KEY_SUB and parent_community_name:
        parent = parent_community_name.strip()
        sub_intro = (
            f"\nThis is a sub-space inside **{parent}** — members of "
            f"{parent} can find their way here.\n"
        )

    return (
        f"{header}{sub_intro}\nA quick tour of what's inside:\n\n"
        f"{bullets}\n{_CLOSER}"
    )


def render_owner_dm(
    *,
    community_name: str,
    owner_first_name: str,
    variant: str,
) -> str:
    """Render the owner DM body. ``variant`` is 'standard' or 'late'."""
    name = (community_name or "").strip() or "your community"
    who = (owner_first_name or "").strip() or "there"

    if variant == "late":
        return (
            f"Hey {who} — quick one about **{name}**.\n\n"
            "I should have done this when you launched, better late than never: "
            "I just published a welcome post in your feed so people landing here "
            "for the first time get the lay of the land. It'll stay in *Key Posts*.\n\n"
            "If you want a hand with cover, description, or first invites, just DM me."
        )

    # Default = standard
    return (
        f"Hey {who} — congrats on **{name}**.\n\n"
        "I just published a quick welcome post in your feed so people landing here "
        "for the first time get the lay of the land. It'll stay in *Key Posts*.\n\n"
        "Want a hand getting started? Just tell me — I can help you invite people, "
        "set a cover image, write the description, or draft your first post."
    )


# ---------------------------------------------------------------------------
# Eligibility helpers
# ---------------------------------------------------------------------------

def _should_skip_welcome(creator_username: Optional[str]) -> bool:
    return (creator_username or "").strip().lower() in SKIP_OWNERS


def _parse_created_at(value) -> Optional[datetime]:
    """Best-effort parse of the communities.created_at value."""
    if value is None:
        return None
    if isinstance(value, datetime):
        # Treat naive timestamps as UTC — the DB writes UTC strings.
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except Exception:
            continue
    try:
        return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _owner_dm_variant(
    *,
    is_brand_new: bool,
    created_at,
    now: Optional[datetime] = None,
) -> Optional[str]:
    """Decide which owner-DM variant (if any) applies.

    Returns ``'standard'``, ``'late'``, or ``None`` if no DM should be sent.
    See `docs/STEVE_COMMUNITY_WELCOME.md` for the cohort table.
    """
    if is_brand_new:
        return "standard"
    when = _parse_created_at(created_at)
    if when is None:
        # If we can't tell how old it is, err on the side of no DM rather than
        # spamming an owner who might have created the community years ago.
        return None
    now = now or datetime.now(timezone.utc)
    age = now - when
    if age <= timedelta(hours=DM_COHORT_FRESH_HOURS):
        return "standard"
    if age <= timedelta(days=DM_COHORT_LATE_DAYS):
        return "late"
    return None


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _fetch_community(cursor, community_id: int) -> Optional[dict]:
    ph = get_sql_placeholder()
    cursor.execute(
        f"""
        SELECT id, name, type, creator_username, parent_community_id, created_at,
               welcome_post_id
        FROM communities
        WHERE id = {ph}
        """,
        (community_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    if hasattr(row, "keys"):
        return dict(row)
    return {
        "id": row[0],
        "name": row[1],
        "type": row[2],
        "creator_username": row[3],
        "parent_community_id": row[4],
        "created_at": row[5],
        "welcome_post_id": row[6],
    }


def _fetch_parent_name(cursor, parent_id) -> Optional[str]:
    if not parent_id:
        return None
    ph = get_sql_placeholder()
    cursor.execute(f"SELECT name FROM communities WHERE id = {ph}", (parent_id,))
    row = cursor.fetchone()
    if not row:
        return None
    return row["name"] if hasattr(row, "keys") else row[0]


def _fetch_owner_first_name(cursor, username: Optional[str]) -> str:
    """Return the owner's first name, falling back to the username."""
    if not username:
        return ""
    ph = get_sql_placeholder()
    try:
        cursor.execute(
            f"SELECT first_name FROM users WHERE username = {ph}",
            (username,),
        )
        row = cursor.fetchone()
        if row:
            first = row["first_name"] if hasattr(row, "keys") else row[0]
            if first and str(first).strip():
                return str(first).strip()
    except Exception:
        pass
    return username


def _existing_welcome_post_id(cursor, community_id: int) -> Optional[int]:
    """Return the live welcome post id for a community, or None.

    Considers a post 'live' iff the row referenced by
    ``communities.welcome_post_id`` still exists in ``posts``. If the FK is
    set but the post row is gone (manual delete + clean-up), returns None so
    the caller knows it can repair the link with a fresh insert.
    """
    ph = get_sql_placeholder()
    cursor.execute(
        f"SELECT welcome_post_id FROM communities WHERE id = {ph}",
        (community_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    candidate = row["welcome_post_id"] if hasattr(row, "keys") else row[0]
    if not candidate:
        return None
    cursor.execute(f"SELECT id FROM posts WHERE id = {ph}", (candidate,))
    return candidate if cursor.fetchone() else None


def _ensure_community_starred(cursor, community_id: int, post_id: int) -> None:
    """Mark the welcome post as community-starred (Key Posts pin)."""
    ph = get_sql_placeholder()
    now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        cursor.execute(
            f"""
            SELECT id FROM community_key_posts
            WHERE community_id = {ph} AND post_id = {ph}
            """,
            (community_id, post_id),
        )
        if cursor.fetchone():
            return
        cursor.execute(
            f"""
            INSERT INTO community_key_posts (community_id, post_id, created_at)
            VALUES ({ph}, {ph}, {ph})
            """,
            (community_id, post_id, now),
        )
    except Exception as exc:
        logger.warning(
            "[STEVE WELCOME] Could not pin welcome post %s for community %s: %s",
            post_id, community_id, exc,
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def publish_welcome_post(community_id: int) -> Optional[int]:
    """Publish (or repair) the Steve welcome post for ``community_id``.

    Idempotent. Returns the welcome post id, or ``None`` if the community is
    in the skip list / not found / publish failed.
    """
    if not community_id:
        return None
    timestamp = datetime.utcnow()
    timestamp_str = timestamp.strftime("%Y-%m-%d %H:%M:%S")
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ensure_welcome_columns(cursor)
            ensure_steve_user(cursor)

            community = _fetch_community(cursor, community_id)
            if not community:
                logger.info("[STEVE WELCOME] community %s not found", community_id)
                return None

            if _should_skip_welcome(community.get("creator_username")):
                logger.info(
                    "[STEVE WELCOME] skipping community %s — owner '%s' is in skip list",
                    community_id, community.get("creator_username"),
                )
                return None

            existing = _existing_welcome_post_id(cursor, community_id)
            if existing:
                logger.info(
                    "[STEVE WELCOME] community %s already has welcome post %s — no-op",
                    community_id, existing,
                )
                return existing

            card_key = _pick_card_key(
                community.get("type"), community.get("parent_community_id"),
            )
            parent_name = _fetch_parent_name(
                cursor, community.get("parent_community_id"),
            )
            content = render_welcome_post(
                card_key=card_key,
                community_name=community.get("name") or "",
                parent_community_name=parent_name,
            )

            ph = get_sql_placeholder()
            cursor.execute(
                f"""
                INSERT INTO posts (
                    username, content, timestamp, community_id,
                    is_system_post, author_kind,
                    welcome_card_key, welcome_card_version
                )
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                """,
                (
                    SYSTEM_AUTHOR, content, timestamp_str, community_id,
                    1, "system",
                    card_key, WELCOME_CARD_VERSION,
                ),
            )
            post_id = cursor.lastrowid
            cursor.execute(
                f"UPDATE communities SET welcome_post_id = {ph} WHERE id = {ph}",
                (post_id, community_id),
            )
            _ensure_community_starred(cursor, community_id, post_id)
            try:
                conn.commit()
            except Exception:
                pass
    except Exception as exc:
        logger.warning(
            "[STEVE WELCOME] failed to publish for community %s: %s",
            community_id, exc, exc_info=True,
        )
        return None

    # Best-effort secondary writes (Firestore + cache bust). System posts
    # deliberately skip notification fan-out — the feed surfaces them via
    # Key Posts and the owner is the only person who's there at creation.
    try:
        write_post(
            post_id=post_id,
            username=SYSTEM_AUTHOR,
            content=content,
            community_id=community_id,
            timestamp=timestamp,
        )
    except Exception as exc:
        logger.warning(
            "[STEVE WELCOME] Firestore mirror failed for post %s: %s",
            post_id, exc,
        )
    try:
        invalidate_community_cache(community_id)
    except Exception:
        pass

    logger.info(
        "[STEVE WELCOME] published post %s for community %s (card=%s v%s)",
        post_id, community_id, card_key, WELCOME_CARD_VERSION,
    )
    return post_id


def send_owner_welcome_dm(
    community_id: int,
    *,
    is_brand_new: bool = False,
) -> Optional[int]:
    """DM the owner about the welcome post, if their cohort qualifies.

    Returns the message id on send, ``None`` otherwise. Never raises.
    """
    if not community_id:
        return None
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            community = _fetch_community(cursor, community_id)
            if not community:
                return None
            owner = community.get("creator_username")
            if _should_skip_welcome(owner):
                return None
            variant = _owner_dm_variant(
                is_brand_new=is_brand_new,
                created_at=community.get("created_at"),
            )
            if variant is None:
                return None
            first_name = _fetch_owner_first_name(cursor, owner)
            body = render_owner_dm(
                community_name=community.get("name") or "",
                owner_first_name=first_name,
                variant=variant,
            )
    except Exception as exc:
        logger.warning(
            "[STEVE WELCOME] could not prepare owner DM for community %s: %s",
            community_id, exc,
        )
        return None

    try:
        return send_steve_dm(receiver_username=owner, content=body)
    except Exception as exc:
        logger.warning(
            "[STEVE WELCOME] DM send failed for community %s owner %s: %s",
            community_id, owner, exc,
        )
        return None


def welcome_for_new_community(
    community_id: int,
    *,
    is_brand_new: bool = True,
) -> dict:
    """Run the full welcome flow (post + owner DM) for a community.

    Best-effort — never raises. Returns a small summary dict for logging /
    backfill output.
    """
    summary = {
        "community_id": community_id,
        "post_id": None,
        "dm_message_id": None,
        "skipped": False,
    }
    post_id = publish_welcome_post(community_id)
    summary["post_id"] = post_id
    if post_id is None:
        summary["skipped"] = True
        return summary
    dm_id = send_owner_welcome_dm(community_id, is_brand_new=is_brand_new)
    summary["dm_message_id"] = dm_id
    return summary


# ---------------------------------------------------------------------------
# Backfill
# ---------------------------------------------------------------------------

def iter_communities_missing_welcome(cursor) -> Iterable[dict]:
    """Yield communities that need a welcome post, oldest-first.

    Skip-list owners are filtered out at SQL level when MySQL is in use,
    otherwise filtered in Python. Sub-communities and root communities are
    both included; the publisher picks the right card.
    """
    ensure_welcome_columns(cursor)
    skip_owners_sql = ", ".join([f"'{u}'" for u in sorted(SKIP_OWNERS)])
    query = (
        "SELECT id, name, type, creator_username, parent_community_id, created_at "
        "FROM communities "
        "WHERE welcome_post_id IS NULL "
        f"AND (creator_username IS NULL OR LOWER(creator_username) NOT IN ({skip_owners_sql})) "
        "ORDER BY created_at ASC"
    )
    cursor.execute(query)
    rows = cursor.fetchall() or []
    for row in rows:
        if hasattr(row, "keys"):
            yield dict(row)
        else:
            yield {
                "id": row[0],
                "name": row[1],
                "type": row[2],
                "creator_username": row[3],
                "parent_community_id": row[4],
                "created_at": row[5],
            }


def backfill_welcome_posts(*, dry_run: bool = False) -> dict:
    """Run the welcome backfill once. Idempotent.

    Returns a summary suitable for the CLI to print:

        {
            "total": N,
            "post_only": N,
            "post_plus_dm": N,
            "errors": N,
            "communities": [ {id, name, action}, ... ],
        }
    """
    summary = {
        "total": 0,
        "post_only": 0,
        "post_plus_dm": 0,
        "errors": 0,
        "skipped": 0,
        "dry_run": dry_run,
        "communities": [],
    }

    # Snapshot the cohort first so a long-running backfill doesn't fight with
    # concurrent writes.
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cohort = list(iter_communities_missing_welcome(cursor))
    except Exception as exc:
        logger.error("[STEVE WELCOME] backfill: cohort query failed: %s", exc)
        summary["errors"] += 1
        return summary

    summary["total"] = len(cohort)

    for community in cohort:
        cid = community["id"]
        variant = _owner_dm_variant(
            is_brand_new=False,
            created_at=community.get("created_at"),
        )
        will_dm = variant is not None
        action = "post+dm" if will_dm else "post"
        entry = {
            "id": cid,
            "name": community.get("name"),
            "owner": community.get("creator_username"),
            "action": action,
        }
        summary["communities"].append(entry)
        if dry_run:
            if will_dm:
                summary["post_plus_dm"] += 1
            else:
                summary["post_only"] += 1
            continue

        post_id = publish_welcome_post(cid)
        if post_id is None:
            summary["errors"] += 1
            entry["error"] = "publish_failed"
            continue
        if will_dm:
            send_owner_welcome_dm(cid, is_brand_new=False)
            summary["post_plus_dm"] += 1
        else:
            summary["post_only"] += 1

    return summary


# ---------------------------------------------------------------------------
# Delete-lock helper
# ---------------------------------------------------------------------------

def is_within_delete_lock(post_row: dict, *, now: Optional[datetime] = None) -> bool:
    """Return True if a system post is still inside its delete-lock window.

    ``post_row`` is expected to be a dict-like row from ``posts`` containing
    at least ``is_system_post`` and ``timestamp``. Non-system posts always
    return False.
    """
    if not post_row:
        return False
    flag = post_row.get("is_system_post") if hasattr(post_row, "get") else None
    try:
        flag = int(flag or 0)
    except Exception:
        flag = 0
    if flag != 1:
        return False
    when = _parse_created_at(post_row.get("timestamp"))
    if when is None:
        return False
    now = now or datetime.now(timezone.utc)
    return (now - when) < timedelta(days=WELCOME_POST_DELETE_LOCK_DAYS)


# ---------------------------------------------------------------------------
# Flask CLI registration
# ---------------------------------------------------------------------------

def register_cli(app) -> None:
    """Register the ``flask backfill-steve-welcome`` management command.

    Called from :func:`backend.init_app`. Idempotent — re-registering the
    same command name on the same app is a no-op in Flask.
    """
    import click

    @app.cli.command("backfill-steve-welcome")
    @click.option(
        "--dry-run", is_flag=True, default=False,
        help="Print the cohort split without writing posts or DMs.",
    )
    def _backfill(dry_run: bool):
        """Publish Steve's welcome post for any community that's missing one.

        See ``docs/STEVE_COMMUNITY_WELCOME.md`` for the cohort rules.
        """
        click.echo(
            f"Steve welcome backfill — {'DRY RUN' if dry_run else 'LIVE'}"
        )
        summary = backfill_welcome_posts(dry_run=dry_run)
        click.echo(
            f"  Total missing: {summary['total']}\n"
            f"  Will post + DM owner: {summary['post_plus_dm']}\n"
            f"  Will post only (no DM): {summary['post_only']}\n"
            f"  Errors: {summary['errors']}\n"
        )
        for entry in summary["communities"]:
            err = f" ERROR={entry['error']}" if entry.get("error") else ""
            click.echo(
                f"  - #{entry['id']:>5}  owner=@{entry.get('owner') or '?':<20}"
                f"  action={entry['action']:<8}  name={entry.get('name')!r}{err}"
            )
        if dry_run:
            click.echo(
                "\nDry-run complete. Re-run without --dry-run to execute."
            )
        else:
            click.echo("\nBackfill complete.")


__all__ = [
    "WELCOME_CARD_VERSION",
    "WELCOME_POST_DELETE_LOCK_DAYS",
    "CARD_KEY_ROOT",
    "CARD_KEY_SUB",
    "CARD_KEY_BUSINESS",
    "SKIP_OWNERS",
    "ensure_welcome_columns",
    "render_welcome_post",
    "render_owner_dm",
    "publish_welcome_post",
    "send_owner_welcome_dm",
    "welcome_for_new_community",
    "backfill_welcome_posts",
    "iter_communities_missing_welcome",
    "is_within_delete_lock",
    "register_cli",
]
