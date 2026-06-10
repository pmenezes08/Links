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
- The skip list (``paulo``, ``admin``, ``steve``) suppresses owner DMs only.
  In-feed activation content still renders so staging/operator communities can
  exercise the same cold-start loop as real users.
- Steve is never referred to as an assistant. See ``docs/STEVE_PERSONA.md``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from backend.services.content_generation.delivery import ensure_steve_user, send_steve_dm
from backend.services.database import get_db_connection, get_sql_placeholder
from backend.services.firestore_writes import write_post
from backend.services import i18n
from backend.services.user_locale import get_preferred_locale
from redis_cache import invalidate_community_cache

logger = logging.getLogger(__name__)


WELCOME_CARD_VERSION = 1
COLD_START_CARD_VERSION = 1

CARD_KEY_ROOT = "welcome.root"
CARD_KEY_SUB = "welcome.sub"
CARD_KEY_BUSINESS = "welcome.business"
CARD_KEY_COLD_START_POLL = "cold_start.poll.v1"
CARD_KEY_INTRODUCE_YOURSELF = "cold_start.introduce_yourself.v1"
CARD_KEY_ROLLING_WELCOME = "cold_start.rolling_welcome.v1"

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
        "ALTER TABLE communities ADD COLUMN cold_start_poll_post_id INTEGER",
        "ALTER TABLE communities ADD COLUMN introduce_thread_post_id INTEGER",
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

def _owner_locale(creator_username: Optional[str], *, fallback: str = "en") -> str:
    """Resolve the community owner's preferred locale for system copy."""
    uname = (creator_username or "").strip()
    if not uname:
        return fallback
    return get_preferred_locale(uname) or fallback


def _poll_copy(category: str, locale: str) -> tuple[str, list[str]]:
    prefix = f"steve_welcome.poll.{category}"
    question = i18n.t(f"{prefix}.question", locale)
    options = [
        i18n.t(f"{prefix}.option_{idx}", locale)
        for idx in range(1, 5)
    ]
    return question, options


def render_welcome_post(
    *,
    card_key: str,
    community_name: str,
    parent_community_name: Optional[str] = None,
    locale: str = "en",
) -> str:
    """Render the welcome-post body for a given card variant.

    Pure function. No DB access. The output is the markdown shipped to the
    feed. Don't add LLM rewriting here — see persona / drift guarantees.
    """
    name = (community_name or "").strip() or i18n.t(
        "steve_welcome.welcome.community_fallback", locale,
    )
    header = (
        f"{i18n.t('steve_welcome.welcome.header', locale, name=name)}\n"
        f"{i18n.t('steve_welcome.posted_by', locale)}\n"
    )

    bullets = i18n.t("steve_welcome.welcome.bullets_base", locale)
    if card_key == CARD_KEY_BUSINESS:
        bullets = bullets + i18n.t("steve_welcome.welcome.bullet_business_extra", locale)
    bullets = bullets + i18n.t("steve_welcome.welcome.bullets_tail", locale)

    sub_intro = ""
    if card_key == CARD_KEY_SUB and parent_community_name:
        parent = parent_community_name.strip()
        sub_intro = i18n.t("steve_welcome.welcome.sub_intro", locale, parent=parent)

    tour = i18n.t("steve_welcome.welcome.tour_intro", locale)
    closer = i18n.t("steve_welcome.welcome.closer", locale)
    return f"{header}{sub_intro}\n{tour}\n\n{bullets}\n{closer}"


def render_owner_dm(
    *,
    community_name: str,
    owner_first_name: str,
    variant: str,
    locale: str = "en",
) -> str:
    """Render the owner DM body. ``variant`` is 'standard' or 'late'."""
    name = (community_name or "").strip() or i18n.t(
        "steve_welcome.welcome.community_fallback", locale,
    )
    who = (owner_first_name or "").strip() or i18n.t(
        "steve_welcome.owner_dm.who_fallback", locale,
    )
    key = "steve_welcome.owner_dm.late" if variant == "late" else "steve_welcome.owner_dm.standard"
    return i18n.t(key, locale, who=who, name=name)


def _pick_card_key(community_type: Optional[str], parent_community_id) -> str:
    ctype = (community_type or "").strip().lower()
    if ctype == "business":
        return CARD_KEY_BUSINESS
    if parent_community_id:
        return CARD_KEY_SUB
    return CARD_KEY_ROOT


def _community_category(community_type: Optional[str], community_name: Optional[str] = None) -> str:
    raw = f"{community_type or ''} {community_name or ''}".strip().lower()
    if any(token in raw for token in ("gym", "fitness", "sport", "sports", "crossfit", "training", "bodybuilding")):
        return "fitness"
    if any(token in raw for token in ("business", "professional", "founder", "investor", "alumni", "work", "company")):
        return "professional"
    return "generic"


def render_cold_start_poll(
    *,
    community_type: Optional[str],
    community_name: Optional[str] = None,
    locale: str = "en",
) -> tuple[str, list[str]]:
    """Return Steve's deterministic first poll question and options."""
    category = _community_category(community_type, community_name)
    return _poll_copy(category, locale)


def render_introduce_yourself_thread(*, community_name: str, locale: str = "en") -> str:
    name = (community_name or "").strip() or i18n.t(
        "steve_welcome.introduce.community_fallback", locale,
    )
    parts = [
        i18n.t("steve_welcome.introduce.title", locale),
        i18n.t("steve_welcome.posted_by", locale),
        "",
        i18n.t("steve_welcome.introduce.lead", locale),
        "",
        i18n.t("steve_welcome.introduce.prompt_intro", locale),
        "",
        i18n.t("steve_welcome.introduce.bullet_name", locale),
        i18n.t("steve_welcome.introduce.bullet_why", locale, name=name),
        i18n.t("steve_welcome.introduce.bullet_working", locale),
        "",
        i18n.t("steve_welcome.introduce.no_bio", locale),
        "",
        i18n.t("steve_welcome.introduce.pinned_closer", locale),
    ]
    return "\n".join(parts)


def render_rolling_welcome_post(
    *,
    community_name: str,
    member_names: list[str],
    locale: str = "en",
) -> str:
    name = (community_name or "").strip() or i18n.t(
        "steve_welcome.rolling.community_fallback", locale,
    )
    clean_names = [n.strip() for n in member_names if n and n.strip()]
    visible = clean_names[:5]
    if not visible:
        names_text = i18n.t("steve_welcome.rolling.names_few", locale)
    elif len(clean_names) > 5:
        names_text = i18n.t(
            "steve_welcome.rolling.names_overflow",
            locale,
            names=", ".join(visible),
            count=len(clean_names) - 5,
        )
    elif len(visible) == 1:
        names_text = visible[0]
    else:
        names_text = i18n.t(
            "steve_welcome.rolling.names_and_last",
            locale,
            prefix=", ".join(visible[:-1]),
            last=visible[-1],
        )
    header = i18n.t("steve_welcome.rolling.header", locale, name=name)
    joined = i18n.t("steve_welcome.rolling.joined_line", locale, names=names_text)
    new_members = i18n.t("steve_welcome.rolling.new_members", locale)
    existing = i18n.t("steve_welcome.rolling.existing_members", locale)
    return (
        f"{header}\n"
        f"{i18n.t('steve_welcome.posted_by', locale)}\n\n"
        f"{joined}\n\n"
        f"{new_members}\n\n"
        f"{existing}"
    )


# ---------------------------------------------------------------------------
# Eligibility helpers
# ---------------------------------------------------------------------------

def _should_skip_owner_dm(creator_username: Optional[str]) -> bool:
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


def _existing_system_post_id(
    cursor,
    community_id: int,
    *,
    column_name: str,
    card_key: str,
) -> Optional[int]:
    """Return a live system post id tracked by a community column or card key."""
    ph = get_sql_placeholder()
    candidate = None
    try:
        cursor.execute(
            f"SELECT {column_name} FROM communities WHERE id = {ph}",
            (community_id,),
        )
        row = cursor.fetchone()
        if row:
            candidate = row[column_name] if hasattr(row, "keys") else row[0]
    except Exception:
        candidate = None
    if candidate:
        cursor.execute(f"SELECT id FROM posts WHERE id = {ph}", (candidate,))
        if cursor.fetchone():
            return int(candidate)

    try:
        cursor.execute(
            f"""
            SELECT id FROM posts
            WHERE community_id = {ph}
              AND is_system_post = 1
              AND author_kind = {ph}
              AND welcome_card_key = {ph}
            ORDER BY id ASC
            LIMIT 1
            """,
            (community_id, "system", card_key),
        )
        row = cursor.fetchone()
        if row:
            found = row["id"] if hasattr(row, "keys") else row[0]
            try:
                cursor.execute(
                    f"UPDATE communities SET {column_name} = {ph} WHERE id = {ph}",
                    (found, community_id),
                )
            except Exception:
                pass
            return int(found)
    except Exception:
        return None
    return None


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


def _insert_system_post(
    cursor,
    *,
    community_id: int,
    content: str,
    timestamp_str: str,
    card_key: str,
) -> int:
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
            1, "system", card_key, COLD_START_CARD_VERSION,
        ),
    )
    return int(cursor.lastrowid)


def _mirror_system_post(
    *,
    post_id: int,
    content: str,
    community_id: int,
    timestamp: datetime,
) -> None:
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
            "[STEVE WELCOME] Firestore mirror failed for system post %s: %s",
            post_id, exc,
        )
    try:
        invalidate_community_cache(community_id)
    except Exception:
        pass


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
            owner_locale = _owner_locale(community.get("creator_username"))
            content = render_welcome_post(
                card_key=card_key,
                community_name=community.get("name") or "",
                parent_community_name=parent_name,
                locale=owner_locale,
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


def publish_cold_start_poll(community_id: int) -> Optional[int]:
    """Publish Steve's deterministic first poll for a community.

    The write is notification-silent and idempotent. Poll voting still uses the
    normal poll APIs once the post is visible in the feed.
    """
    if not community_id:
        return None
    timestamp = datetime.utcnow()
    timestamp_str = timestamp.strftime("%Y-%m-%d %H:%M:%S")
    content = ""
    post_id: Optional[int] = None
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ensure_welcome_columns(cursor)
            ensure_steve_user(cursor)

            community = _fetch_community(cursor, community_id)
            if not community:
                return None
            existing = _existing_system_post_id(
                cursor,
                community_id,
                column_name="cold_start_poll_post_id",
                card_key=CARD_KEY_COLD_START_POLL,
            )
            if existing:
                try:
                    conn.commit()
                except Exception:
                    pass
                return existing

            owner_locale = _owner_locale(community.get("creator_username"))
            question, options = render_cold_start_poll(
                community_type=community.get("type"),
                community_name=community.get("name"),
                locale=owner_locale,
            )
            content = f"**{question}**\n{i18n.t('steve_welcome.posted_by', owner_locale)}"
            post_id = _insert_system_post(
                cursor,
                community_id=community_id,
                content=content,
                timestamp_str=timestamp_str,
                card_key=CARD_KEY_COLD_START_POLL,
            )
            ph = get_sql_placeholder()
            try:
                cursor.execute(
                    f"""
                    INSERT INTO polls (post_id, question, created_by, created_at, single_vote, expires_at)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                    """,
                    (post_id, question, SYSTEM_AUTHOR, timestamp_str, 1, None),
                )
            except Exception:
                cursor.execute(
                    f"""
                    INSERT INTO polls (post_id, question, created_by, created_at, single_vote)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph})
                    """,
                    (post_id, question, SYSTEM_AUTHOR, timestamp_str, 1),
                )
            poll_id = int(cursor.lastrowid)
            for option in options:
                try:
                    cursor.execute(
                        f"INSERT INTO poll_options (poll_id, option_text, votes) VALUES ({ph}, {ph}, {ph})",
                        (poll_id, option, 0),
                    )
                except Exception:
                    cursor.execute(
                        f"INSERT INTO poll_options (poll_id, option_text) VALUES ({ph}, {ph})",
                        (poll_id, option),
                    )
            cursor.execute(
                f"UPDATE communities SET cold_start_poll_post_id = {ph} WHERE id = {ph}",
                (post_id, community_id),
            )
            conn.commit()
    except Exception as exc:
        logger.warning(
            "[STEVE WELCOME] failed to publish cold-start poll for community %s: %s",
            community_id, exc, exc_info=True,
        )
        return None

    if post_id is not None:
        _mirror_system_post(
            post_id=post_id,
            content=content,
            community_id=community_id,
            timestamp=timestamp,
        )
    return post_id


def ensure_introduce_yourself_thread(cursor, community_id: int) -> Optional[int]:
    """Create or return the pinned intro thread for a community.

    This helper is designed to run inside invite-acceptance transactions. It
    performs only database work; callers may mirror/invalidate after commit.
    """
    if not community_id:
        return None
    ensure_welcome_columns(cursor)
    ensure_steve_user(cursor)
    community = _fetch_community(cursor, community_id)
    if not community:
        return None
    existing = _existing_system_post_id(
        cursor,
        community_id,
        column_name="introduce_thread_post_id",
        card_key=CARD_KEY_INTRODUCE_YOURSELF,
    )
    if existing:
        _ensure_community_starred(cursor, community_id, existing)
        return existing
    owner_locale = _owner_locale(community.get("creator_username"))
    timestamp_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    content = render_introduce_yourself_thread(
        community_name=community.get("name") or "",
        locale=owner_locale,
    )
    post_id = _insert_system_post(
        cursor,
        community_id=community_id,
        content=content,
        timestamp_str=timestamp_str,
        card_key=CARD_KEY_INTRODUCE_YOURSELF,
    )
    ph = get_sql_placeholder()
    cursor.execute(
        f"UPDATE communities SET introduce_thread_post_id = {ph} WHERE id = {ph}",
        (post_id, community_id),
    )
    _ensure_community_starred(cursor, community_id, post_id)
    return post_id


def mirror_introduce_yourself_thread(post_id: Optional[int], community_id: int) -> None:
    """Best-effort Firestore/cache follow-up after invite acceptance commits."""
    if not post_id or not community_id:
        return
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ph = get_sql_placeholder()
            cursor.execute(
                f"SELECT content, timestamp FROM posts WHERE id = {ph}",
                (post_id,),
            )
            row = cursor.fetchone()
            if not row:
                return
            content = row["content"] if hasattr(row, "keys") else row[0]
            raw_timestamp = row["timestamp"] if hasattr(row, "keys") else row[1]
            timestamp = _parse_created_at(raw_timestamp) or datetime.now(timezone.utc)
            _mirror_system_post(
                post_id=int(post_id),
                content=content or "",
                community_id=community_id,
                timestamp=timestamp,
            )
    except Exception as exc:
        logger.warning(
            "[STEVE WELCOME] intro thread mirror failed for post %s: %s",
            post_id, exc,
        )


def ensure_rolling_welcome_tables(cursor) -> None:
    ph_indexes = (
        "CREATE INDEX idx_uc_community_joined_at ON user_communities (community_id, joined_at)",
        "CREATE INDEX idx_posts_community_system_card ON posts (community_id, is_system_post, welcome_card_key)",
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS community_rolling_welcome_log (
            community_id INTEGER NOT NULL,
            window_start TEXT NOT NULL,
            window_end TEXT NOT NULL,
            post_id INTEGER,
            member_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            UNIQUE(community_id, window_start, window_end)
        )
        """
    )
    for stmt in ph_indexes:
        try:
            cursor.execute(stmt)
        except Exception:
            pass


def dispatch_rolling_welcome_summaries(
    *,
    window_days: int = 7,
    dry_run: bool = False,
    limit: int = 50,
    minimum_members: int = 1,
) -> dict:
    """Publish one weekly Steve welcome summary per community/window."""
    now = datetime.utcnow()
    window_end = now.replace(microsecond=0)
    window_start = window_end - timedelta(days=max(1, int(window_days or 7)))
    start_str = window_start.strftime("%Y-%m-%d %H:%M:%S")
    end_str = window_end.strftime("%Y-%m-%d %H:%M:%S")
    created_at = now.strftime("%Y-%m-%d %H:%M:%S")
    summary = {
        "window_start": start_str,
        "window_end": end_str,
        "dry_run": dry_run,
        "communities_scanned": 0,
        "posted": 0,
        "skipped": 0,
        "items": [],
    }
    posts_to_mirror: list[tuple[int, str, int, datetime]] = []
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            ensure_welcome_columns(cursor)
            ensure_rolling_welcome_tables(cursor)
            ensure_steve_user(cursor)
            ph = get_sql_placeholder()
            cursor.execute(
                f"""
                SELECT
                    uc.community_id,
                    c.name AS community_name,
                    c.creator_username,
                    u.username,
                    u.first_name
                FROM user_communities uc
                JOIN users u ON u.id = uc.user_id
                JOIN communities c ON c.id = uc.community_id
                WHERE uc.joined_at >= {ph}
                  AND uc.joined_at <= {ph}
                  AND LOWER(u.username) NOT IN ({ph}, {ph}, {ph})
                ORDER BY uc.community_id ASC, uc.joined_at ASC
                LIMIT {int(limit) * 50}
                """,
                (start_str, end_str, "steve", "admin", "paulo"),
            )
            grouped: dict[int, dict] = {}
            for row in cursor.fetchall() or []:
                community_id = int(row["community_id"] if hasattr(row, "keys") else row[0])
                item = grouped.setdefault(
                    community_id,
                    {
                        "community_id": community_id,
                        "community_name": row["community_name"] if hasattr(row, "keys") else row[1],
                        "creator_username": row["creator_username"] if hasattr(row, "keys") else row[2],
                        "members": [],
                    },
                )
                username = row["username"] if hasattr(row, "keys") else row[3]
                first_name = row["first_name"] if hasattr(row, "keys") else row[4]
                item["members"].append((first_name or username or "").strip())

            for community in list(grouped.values())[: int(limit)]:
                summary["communities_scanned"] += 1
                community_id = community["community_id"]
                members = [m for m in community["members"] if m]
                if len(members) < max(1, int(minimum_members or 1)):
                    summary["skipped"] += 1
                    continue
                cursor.execute(
                    f"""
                    SELECT post_id FROM community_rolling_welcome_log
                    WHERE community_id = {ph} AND window_start = {ph} AND window_end = {ph}
                    """,
                    (community_id, start_str, end_str),
                )
                if cursor.fetchone():
                    summary["skipped"] += 1
                    continue
                owner_locale = _owner_locale(community.get("creator_username"))
                content = render_rolling_welcome_post(
                    community_name=community.get("community_name") or "",
                    member_names=members,
                    locale=owner_locale,
                )
                if dry_run:
                    summary["items"].append(
                        {
                            "community_id": community_id,
                            "community_name": community.get("community_name"),
                            "member_count": len(members),
                            "would_post": True,
                        }
                    )
                    continue
                post_id = _insert_system_post(
                    cursor,
                    community_id=community_id,
                    content=content,
                    timestamp_str=created_at,
                    card_key=CARD_KEY_ROLLING_WELCOME,
                )
                ensure_introduce_yourself_thread(cursor, community_id)
                cursor.execute(
                    f"""
                    INSERT INTO community_rolling_welcome_log (
                        community_id, window_start, window_end, post_id, member_count, created_at
                    )
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph})
                    """,
                    (community_id, start_str, end_str, post_id, len(members), created_at),
                )
                posts_to_mirror.append((post_id, content, community_id, now))
                summary["posted"] += 1
                summary["items"].append(
                    {
                        "community_id": community_id,
                        "community_name": community.get("community_name"),
                        "member_count": len(members),
                        "post_id": post_id,
                    }
                )
            conn.commit()
    except Exception as exc:
        logger.warning("[STEVE WELCOME] rolling welcome dispatch failed: %s", exc, exc_info=True)
        summary["error"] = "dispatch_failed"
        return summary

    for post_id, content, community_id, timestamp in posts_to_mirror:
        _mirror_system_post(
            post_id=post_id,
            content=content,
            community_id=community_id,
            timestamp=timestamp,
        )
    return summary


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
            if _should_skip_owner_dm(owner):
                return None
            variant = _owner_dm_variant(
                is_brand_new=is_brand_new,
                created_at=community.get("created_at"),
            )
            if variant is None:
                return None
            owner_locale = _owner_locale(owner)
            first_name = _fetch_owner_first_name(cursor, owner)
            body = render_owner_dm(
                community_name=community.get("name") or "",
                owner_first_name=first_name,
                variant=variant,
                locale=owner_locale,
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
        "poll_post_id": None,
        "dm_message_id": None,
        "skipped": False,
    }
    post_id = publish_welcome_post(community_id)
    summary["post_id"] = post_id
    if post_id is None:
        summary["skipped"] = True
        return summary
    summary["poll_post_id"] = publish_cold_start_poll(community_id)
    dm_id = send_owner_welcome_dm(community_id, is_brand_new=is_brand_new)
    summary["dm_message_id"] = dm_id
    return summary


# ---------------------------------------------------------------------------
# Backfill
# ---------------------------------------------------------------------------

def iter_communities_missing_welcome(cursor) -> Iterable[dict]:
    """Yield communities that need a welcome post, oldest-first.

    Sub-communities and root communities are both included; the publisher
    picks the right card. Owner-DM skip-list handling happens later and does
    not suppress in-feed activation content.
    """
    ensure_welcome_columns(cursor)
    query = (
        "SELECT id, name, type, creator_username, parent_community_id, created_at "
        "FROM communities "
        "WHERE welcome_post_id IS NULL "
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
        will_dm = variant is not None and not _should_skip_owner_dm(community.get("creator_username"))
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
    "COLD_START_CARD_VERSION",
    "WELCOME_POST_DELETE_LOCK_DAYS",
    "CARD_KEY_ROOT",
    "CARD_KEY_SUB",
    "CARD_KEY_BUSINESS",
    "CARD_KEY_COLD_START_POLL",
    "CARD_KEY_INTRODUCE_YOURSELF",
    "CARD_KEY_ROLLING_WELCOME",
    "SKIP_OWNERS",
    "ensure_welcome_columns",
    "ensure_rolling_welcome_tables",
    "render_welcome_post",
    "render_owner_dm",
    "render_cold_start_poll",
    "render_introduce_yourself_thread",
    "render_rolling_welcome_post",
    "publish_welcome_post",
    "publish_cold_start_poll",
    "ensure_introduce_yourself_thread",
    "mirror_introduce_yourself_thread",
    "send_owner_welcome_dm",
    "welcome_for_new_community",
    "dispatch_rolling_welcome_summaries",
    "backfill_welcome_posts",
    "iter_communities_missing_welcome",
    "is_within_delete_lock",
    "register_cli",
]
