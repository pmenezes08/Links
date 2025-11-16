"""Helpers for fetching reaction summaries."""

from __future__ import annotations

from backend.services.database import get_sql_placeholder


def _rows_to_counts(rows) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        if hasattr(row, "keys"):
            reaction = row.get("reaction_type")
            count = row.get("count", 0)
        else:
            reaction = row[0] if row else None
            count = row[1] if len(row) > 1 else 0
        if reaction:
            counts[reaction] = count
    return counts


def _fetch_counts(cursor, table: str, id_column: str, entity_id: int) -> dict[str, int]:
    placeholder = get_sql_placeholder()
    cursor.execute(
        f"""
        SELECT reaction_type, COUNT(*) as count
        FROM {table}
        WHERE {id_column} = {placeholder}
        GROUP BY reaction_type
        """,
        (entity_id,),
    )
    return _rows_to_counts(cursor.fetchall() or [])


def _fetch_user_reaction(cursor, table: str, id_column: str, entity_id: int, username: str) -> str | None:
    placeholder = get_sql_placeholder()
    cursor.execute(
        f"""
        SELECT reaction_type
        FROM {table}
        WHERE {id_column} = {placeholder} AND username = {placeholder}
        """,
        (entity_id, username),
    )
    row = cursor.fetchone()
    if not row:
        return None
    if hasattr(row, "keys"):
        return row.get("reaction_type")
    return row[0]


def get_post_reaction_summary(cursor, post_id: int, username: str | None = None):
    """Return (counts_dict, user_reaction) for a post."""
    counts = _fetch_counts(cursor, "reactions", "post_id", post_id)
    user_reaction = None
    if username:
        user_reaction = _fetch_user_reaction(cursor, "reactions", "post_id", post_id, username)
    return counts, user_reaction


def get_reply_reaction_summary(cursor, reply_id: int, username: str | None = None):
    """Return (counts_dict, user_reaction) for a reply."""
    counts = _fetch_counts(cursor, "reply_reactions", "reply_id", reply_id)
    user_reaction = None
    if username:
        user_reaction = _fetch_user_reaction(cursor, "reply_reactions", "reply_id", reply_id, username)
    return counts, user_reaction
