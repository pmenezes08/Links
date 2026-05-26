"""Patch Firestore chat reads with file_path/file_name from MySQL when missing."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Sequence, Tuple

from backend.services.database import get_sql_placeholder

logger = logging.getLogger(__name__)


def _needs_document_enrichment(msg: dict) -> bool:
    fp = msg.get("file_path") or msg.get("document")
    return not fp


def enrich_messages_with_mysql_documents(
    cursor: Any,
    messages: Sequence[dict],
    *,
    dm_pair: Optional[Tuple[str, str]] = None,
    group_id: Optional[int] = None,
) -> List[dict]:
    """Fill file_path/file_name on messages from MySQL when Firestore payload lacks them."""
    if not messages:
        return list(messages)

    missing_ids = [
        int(m["id"])
        for m in messages
        if m.get("id") and _needs_document_enrichment(m)
    ]
    if not missing_ids:
        return list(messages)

    ph = get_sql_placeholder()
    placeholders = ", ".join([ph] * len(missing_ids))
    doc_by_id: Dict[int, Tuple[Optional[str], Optional[str]]] = {}

    try:
        if dm_pair is not None:
            user_a, user_b = dm_pair
            cursor.execute(
                f"""
                SELECT id, file_path, file_name
                FROM messages
                WHERE id IN ({placeholders})
                  AND file_path IS NOT NULL AND file_path != ''
                  AND (
                    (sender = {ph} AND receiver = {ph})
                    OR (sender = {ph} AND receiver = {ph})
                  )
                """,
                tuple(missing_ids) + (user_a, user_b, user_b, user_a),
            )
        elif group_id is not None:
            cursor.execute(
                f"""
                SELECT id, file_path, file_name
                FROM group_chat_messages
                WHERE group_id = {ph}
                  AND id IN ({placeholders})
                  AND file_path IS NOT NULL AND file_path != ''
                  AND is_deleted = 0
                """,
                (group_id,) + tuple(missing_ids),
            )
        else:
            return list(messages)

        for row in cursor.fetchall() or []:
            if hasattr(row, "keys"):
                mid = int(row["id"])
                fp, fn = row.get("file_path"), row.get("file_name")
            else:
                mid = int(row[0])
                fp = row[1] if len(row) > 1 else None
                fn = row[2] if len(row) > 2 else None
            if fp:
                doc_by_id[mid] = (fp, fn)
    except Exception as e:
        logger.warning("chat document MySQL merge failed: %s", e)
        return list(messages)

    if not doc_by_id:
        return list(messages)

    enriched: List[dict] = []
    for msg in messages:
        mid = msg.get("id")
        if mid and int(mid) in doc_by_id and _needs_document_enrichment(msg):
            fp, fn = doc_by_id[int(mid)]
            patched = dict(msg)
            patched["file_path"] = fp
            if fn:
                patched["file_name"] = fn
            if group_id is not None:
                patched["document"] = fp
            enriched.append(patched)
        else:
            enriched.append(msg)
    return enriched
