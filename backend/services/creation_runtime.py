"""Brokered data runtime for Steve Build creations.

Generated artifacts never get a raw database. They call the host-side CPoint
bridge, and this service maps those calls onto small, bounded JSON primitives:
shared state, collection rows, and append-only form submissions.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder

_MAX_KEY_LEN = 64
_MAX_NAME_LEN = 40
_MAX_SHARED_BYTES = 100_000
_MAX_ROW_BYTES = 25_000
_MAX_FORM_BYTES = 25_000
_MAX_COLLECTION_ROWS = 300
_MAX_FORM_SUBMISSIONS = 1_000


def _now() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _slug(value: Any, *, fallback: str, max_len: int) -> str:
    text = re.sub(r"[^a-z0-9_.:-]+", "_", str(value or "").strip().lower())
    text = re.sub(r"_+", "_", text).strip("_.:-")
    return (text or fallback)[:max_len]


def normalize_key(value: Any) -> str:
    return _slug(value, fallback="main", max_len=_MAX_KEY_LEN)


def normalize_name(value: Any) -> str:
    return _slug(value, fallback="items", max_len=_MAX_NAME_LEN)


def _row_to_dict(row: Any, cols: Tuple[str, ...]) -> Dict[str, Any]:
    if hasattr(row, "keys"):
        return {k: row[k] for k in row.keys()}
    return {col: row[i] for i, col in enumerate(cols)}


def _json_dumps(value: Any, max_bytes: int) -> str:
    try:
        raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid_json") from exc
    if len(raw.encode("utf-8")) > max_bytes:
        raise ValueError("value_too_large")
    return raw


def _json_loads(raw: Optional[str]) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def ensure_tables() -> None:
    ph_id = "INT AUTO_INCREMENT PRIMARY KEY" if USE_MYSQL else "INTEGER PRIMARY KEY AUTOINCREMENT"
    text = "MEDIUMTEXT" if USE_MYSQL else "TEXT"
    varchar = "VARCHAR" if USE_MYSQL else "TEXT"
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            CREATE TABLE IF NOT EXISTS creation_runtime_data (
                id {ph_id},
                creation_id INT NOT NULL,
                community_id INT NOT NULL,
                kind {varchar}(24) NOT NULL,
                name {varchar}(64) NOT NULL DEFAULT '',
                row_id {varchar}(64) NOT NULL DEFAULT '',
                owner_username {varchar}(191) NOT NULL DEFAULT '',
                value_json {text},
                version INT NOT NULL DEFAULT 1,
                created_at {varchar}(32) NOT NULL,
                updated_at {varchar}(32) NOT NULL
            )
            """
        )
        if USE_MYSQL:
            for stmt in (
                "DROP INDEX uq_runtime_item ON creation_runtime_data",
                "DROP INDEX idx_runtime_list ON creation_runtime_data",
                "CREATE UNIQUE INDEX uq_runtime_item_scoped ON creation_runtime_data (creation_id, community_id, kind, name, row_id)",
                "CREATE INDEX idx_runtime_list_scoped ON creation_runtime_data (creation_id, community_id, kind, name, updated_at)",
            ):
                try:
                    c.execute(stmt)
                except Exception:
                    pass
        else:
            for stmt in (
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_runtime_item_scoped ON creation_runtime_data (creation_id, community_id, kind, name, row_id)",
                "CREATE INDEX IF NOT EXISTS idx_runtime_list_scoped ON creation_runtime_data (creation_id, community_id, kind, name, updated_at)",
            ):
                c.execute(stmt)
        conn.commit()


def get_shared_state(*, creation_id: int, community_id: int = 0, key: Any) -> Dict[str, Any]:
    ensure_tables()
    name = normalize_key(key)
    ph = get_sql_placeholder()
    cols = ("value_json", "version", "updated_at")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT value_json, version, updated_at FROM creation_runtime_data
                WHERE creation_id = {ph} AND community_id = {ph}
                  AND kind = 'shared' AND name = {ph} AND row_id = ''""",
            (creation_id, community_id, name),
        )
        row = c.fetchone()
    if not row:
        return {"key": name, "value": None, "version": 0, "updated_at": ""}
    data = _row_to_dict(row, cols)
    return {
        "key": name,
        "value": _json_loads(data.get("value_json")),
        "version": int(data.get("version") or 0),
        "updated_at": str(data.get("updated_at") or ""),
    }


def update_shared_state(*, creation_id: int, community_id: int, username: str,
                        key: Any, value: Any, expected_version: Optional[int] = None) -> Dict[str, Any]:
    ensure_tables()
    name = normalize_key(key)
    value_json = _json_dumps(value, _MAX_SHARED_BYTES)
    now = _now()
    ph = get_sql_placeholder()
    current = get_shared_state(creation_id=creation_id, community_id=community_id, key=name)
    current_version = int(current.get("version") or 0)
    if expected_version is not None and int(expected_version) != current_version:
        raise ValueError("version_conflict")
    next_version = current_version + 1
    with get_db_connection() as conn:
        c = conn.cursor()
        if current_version == 0:
            c.execute(
                f"""INSERT INTO creation_runtime_data
                    (creation_id, community_id, kind, name, row_id, owner_username, value_json, version, created_at, updated_at)
                    VALUES ({ph}, {ph}, 'shared', {ph}, '', {ph}, {ph}, {ph}, {ph}, {ph})""",
                (creation_id, community_id, name, username, value_json, next_version, now, now),
            )
        else:
            c.execute(
                f"""UPDATE creation_runtime_data SET value_json = {ph}, version = {ph}, updated_at = {ph}
                    WHERE creation_id = {ph} AND kind = 'shared' AND name = {ph}
                      AND row_id = '' AND community_id = {ph}""",
                (value_json, next_version, now, creation_id, name, community_id),
            )
        conn.commit()
    return get_shared_state(creation_id=creation_id, community_id=community_id, key=name)


def list_collection(*, creation_id: int, community_id: int = 0, name: Any, limit: int = 100) -> Dict[str, Any]:
    ensure_tables()
    collection = normalize_name(name)
    limit = max(1, min(int(limit or 100), _MAX_COLLECTION_ROWS))
    ph = get_sql_placeholder()
    cols = ("row_id", "owner_username", "value_json", "version", "created_at", "updated_at")
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT row_id, owner_username, value_json, version, created_at, updated_at
                FROM creation_runtime_data
                WHERE creation_id = {ph} AND community_id = {ph}
                  AND kind = 'collection' AND name = {ph}
                ORDER BY updated_at DESC LIMIT {limit}""",
            (creation_id, community_id, collection),
        )
        rows = c.fetchall() or []
    items = []
    for row in rows:
        data = _row_to_dict(row, cols)
        items.append({
            "id": str(data.get("row_id") or ""),
            "value": _json_loads(data.get("value_json")),
            "version": int(data.get("version") or 0),
            "created_by": str(data.get("owner_username") or ""),
            "created_at": str(data.get("created_at") or ""),
            "updated_at": str(data.get("updated_at") or ""),
        })
    return {"name": collection, "items": items}


def _count_items(creation_id: int, community_id: int, kind: str, name: str) -> int:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT COUNT(*) FROM creation_runtime_data
                WHERE creation_id = {ph} AND community_id = {ph} AND kind = {ph} AND name = {ph}""",
            (creation_id, community_id, kind, name),
        )
        row = c.fetchone()
    if hasattr(row, "keys"):
        return int(next(iter(row.values())) or 0)
    return int(row[0] if row else 0)


def create_collection_item(*, creation_id: int, community_id: int, username: str,
                           name: Any, value: Any) -> Dict[str, Any]:
    ensure_tables()
    collection = normalize_name(name)
    if _count_items(creation_id, community_id, "collection", collection) >= _MAX_COLLECTION_ROWS:
        raise ValueError("too_many_rows")
    value_json = _json_dumps(value, _MAX_ROW_BYTES)
    row_id = uuid.uuid4().hex[:16]
    now = _now()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""INSERT INTO creation_runtime_data
                (creation_id, community_id, kind, name, row_id, owner_username, value_json, version, created_at, updated_at)
                VALUES ({ph}, {ph}, 'collection', {ph}, {ph}, {ph}, {ph}, 1, {ph}, {ph})""",
            (creation_id, community_id, collection, row_id, username, value_json, now, now),
        )
        conn.commit()
    return {"id": row_id, "value": value, "version": 1, "created_by": username, "created_at": now, "updated_at": now}


def update_collection_item(*, creation_id: int, community_id: int = 0, name: Any, row_id: str, value: Any,
                           expected_version: Optional[int] = None) -> Dict[str, Any]:
    ensure_tables()
    collection = normalize_name(name)
    rid = normalize_key(row_id)
    value_json = _json_dumps(value, _MAX_ROW_BYTES)
    ph = get_sql_placeholder()
    now = _now()
    where = f"creation_id = {ph} AND community_id = {ph} AND kind = 'collection' AND name = {ph} AND row_id = {ph}"
    args: List[Any] = [value_json, now, creation_id, community_id, collection, rid]
    if expected_version is not None:
        where += f" AND version = {ph}"
        args.append(int(expected_version))
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""UPDATE creation_runtime_data SET value_json = {ph}, version = version + 1, updated_at = {ph}
                WHERE {where}""",
            tuple(args),
        )
        if c.rowcount != 1:
            conn.rollback()
            raise ValueError("version_conflict" if expected_version is not None else "row_not_found")
        conn.commit()
    item = next((x for x in list_collection(creation_id=creation_id, community_id=community_id, name=collection, limit=_MAX_COLLECTION_ROWS)["items"]
                 if x["id"] == rid), None)
    if not item:
        raise ValueError("row_not_found")
    return item


def delete_collection_item(*, creation_id: int, community_id: int = 0, name: Any, row_id: str) -> Dict[str, Any]:
    ensure_tables()
    collection = normalize_name(name)
    rid = normalize_key(row_id)
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""DELETE FROM creation_runtime_data
                WHERE creation_id = {ph} AND community_id = {ph}
                  AND kind = 'collection' AND name = {ph} AND row_id = {ph}""",
            (creation_id, community_id, collection, rid),
        )
        deleted = c.rowcount
        conn.commit()
    return {"deleted": bool(deleted)}


def submit_form(*, creation_id: int, community_id: int, username: str,
                name: Any, value: Any) -> Dict[str, Any]:
    ensure_tables()
    form = normalize_name(name)
    if _count_items(creation_id, community_id, "form", form) >= _MAX_FORM_SUBMISSIONS:
        raise ValueError("too_many_submissions")
    value_json = _json_dumps(value, _MAX_FORM_BYTES)
    row_id = uuid.uuid4().hex[:16]
    now = _now()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""INSERT INTO creation_runtime_data
                (creation_id, community_id, kind, name, row_id, owner_username, value_json, version, created_at, updated_at)
                VALUES ({ph}, {ph}, 'form', {ph}, {ph}, {ph}, {ph}, 1, {ph}, {ph})""",
            (creation_id, community_id, form, row_id, username, value_json, now, now),
        )
        conn.commit()
    return {"id": row_id, "name": form, "submitted": True, "created_at": now}
