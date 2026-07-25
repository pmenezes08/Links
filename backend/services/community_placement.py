"""Guided placement — deterministic sub-community allocation for Enterprise networks.

An Enterprise root owner defines up to MAX_QUESTIONS questions; every option
maps to one or more sub-communities of that root. When a new member is
accepted into the root (invite accept or join-request approval) a *pending
placement* opens. On their next app open Steve welcomes them and asks the
questions; the answers resolve to the union of the selected options' target
sub-communities and the memberships are inserted through the canonical join
chokepoint. Pure lookup — no AI call is ever made, so the same answers always
produce the same placement and nothing touches ai_usage_log.

Privacy: sub-communities are invisible to non-members, so the member-facing
question payload strips target ids — only the owner-authored option labels
travel. Target names are revealed exclusively in the respond() result, at
which point the member already holds the memberships.

The gate re-checks tier + KB policy + active questions at every read: if a
community stops being Enterprise (or the owner deactivates the questions) a
stale pending row dissolves silently instead of locking anyone out.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

from redis_cache import invalidate_user_cache

from backend.services.community import (
    COMMUNITY_TIER_ENTERPRISE,
    CommunityMembershipLimitError,
    get_community_tier,
    get_parent_chain_ids,
    render_member_cap_error,
)
from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

MAX_QUESTIONS = 3
MAX_OPTIONS_PER_QUESTION = 6
MIN_OPTIONS_PER_QUESTION = 2
PROMPT_MAX_LEN = 200
OPTION_LABEL_MAX_LEN = 80
KB_INCLUDED_FIELD = "enterprise_guided_placement_included"

STATUS_PENDING = "pending"
STATUS_COMPLETED = "completed"


@lru_cache(maxsize=1)
def _legacy_helpers():
    from bodybuilding_app import (  # type: ignore import-not-found
        add_user_to_community,
        has_community_management_permission,
    )

    return {
        "add_user_to_community": add_user_to_community,
        "has_community_management_permission": has_community_management_permission,
    }


def _row_value(row: Any, key: str, index: int, default: Any = None) -> Any:
    if row is None:
        return default
    if hasattr(row, "keys") and key in row.keys():
        return row[key]
    if isinstance(row, dict):
        return row.get(key, default)
    if isinstance(row, (list, tuple)) and len(row) > index:
        return row[index]
    return default


def _now_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def ensure_tables() -> None:
    """Create the placement tables if missing (idempotent, MySQL + SQLite)."""
    with get_db_connection() as conn:
        c = conn.cursor()
        try:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_placement_questions (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    community_id INT NOT NULL,
                    position INT NOT NULL DEFAULT 0,
                    prompt VARCHAR(200) NOT NULL,
                    allow_multi TINYINT(1) NOT NULL DEFAULT 0,
                    options_json MEDIUMTEXT NOT NULL,
                    is_active TINYINT(1) NOT NULL DEFAULT 1,
                    updated_by VARCHAR(191) NULL,
                    updated_at DATETIME NULL,
                    INDEX idx_placement_q_comm (community_id, is_active)
                )
                """
            )
        except Exception:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_placement_questions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    community_id INTEGER NOT NULL,
                    position INTEGER NOT NULL DEFAULT 0,
                    prompt VARCHAR(200) NOT NULL,
                    allow_multi INTEGER NOT NULL DEFAULT 0,
                    options_json TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    updated_by VARCHAR(191) NULL,
                    updated_at DATETIME NULL
                )
                """
            )
        try:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_placement_responses (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    community_id INT NOT NULL,
                    username VARCHAR(191) NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'pending',
                    inviter_username VARCHAR(191) NULL,
                    answers_json MEDIUMTEXT NULL,
                    allocated_ids_json TEXT NULL,
                    created_at DATETIME NULL,
                    completed_at DATETIME NULL,
                    UNIQUE KEY uq_placement_resp (community_id, username),
                    INDEX idx_placement_resp_user (username, status)
                )
                """
            )
        except Exception:
            c.execute(
                """
                CREATE TABLE IF NOT EXISTS community_placement_responses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    community_id INTEGER NOT NULL,
                    username VARCHAR(191) NOT NULL,
                    status VARCHAR(16) NOT NULL DEFAULT 'pending',
                    inviter_username VARCHAR(191) NULL,
                    answers_json TEXT NULL,
                    allocated_ids_json TEXT NULL,
                    created_at DATETIME NULL,
                    completed_at DATETIME NULL,
                    UNIQUE (community_id, username)
                )
                """
            )
        try:
            conn.commit()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Gate
# ---------------------------------------------------------------------------

def _kb_included() -> bool:
    try:
        from backend.services import knowledge_base as kb

        page = kb.get_page("community-tiers")
        for f in (page or {}).get("fields") or []:
            if f.get("name") == KB_INCLUDED_FIELD and "value" in f:
                return bool(f["value"])
    except Exception:
        pass
    return True


def _resolve_root_with_cursor(cursor, community_id: int) -> int:
    chain = get_parent_chain_ids(cursor, int(community_id))
    return int(chain[-1]) if chain else int(community_id)


def _active_question_rows(cursor, root_id: int) -> List[Any]:
    ph = get_sql_placeholder()
    cursor.execute(
        f"""
        SELECT id, position, prompt, allow_multi, options_json
        FROM community_placement_questions
        WHERE community_id = {ph} AND is_active = 1
        ORDER BY position ASC, id ASC
        """,
        (int(root_id),),
    )
    return cursor.fetchall() or []


def placement_gate_root(cursor, community_id: int) -> Optional[int]:
    """Return the enterprise root id when guided placement is live for this
    community, else ``None``. Fails soft (None) on any schema/KB error."""
    try:
        root_id = _resolve_root_with_cursor(cursor, int(community_id))
        if get_community_tier(cursor, root_id) != COMMUNITY_TIER_ENTERPRISE:
            return None
        if not _kb_included():
            return None
        if not _active_question_rows(cursor, root_id):
            return None
        return root_id
    except Exception as exc:
        logger.warning("placement gate check failed for %s: %s", community_id, exc)
        return None


# ---------------------------------------------------------------------------
# Accept-path hook
# ---------------------------------------------------------------------------

def open_pending_placement_if_active(
    cursor, community_id: int, username: str, inviter_username: Optional[str] = None
) -> bool:
    """Open a pending placement for a freshly accepted member.

    Runs inside the caller's accept transaction (same cursor). Best-effort by
    contract: any failure is swallowed so the join itself can never break.
    Idempotent — an existing row (pending or completed) is left untouched.
    """
    try:
        root_id = placement_gate_root(cursor, int(community_id))
        if root_id is None:
            return False
        ph = get_sql_placeholder()
        cursor.execute(
            f"SELECT 1 FROM community_placement_responses WHERE community_id = {ph} AND username = {ph}",
            (root_id, username),
        )
        if cursor.fetchone():
            return False
        cursor.execute(
            f"""
            INSERT INTO community_placement_responses
                (community_id, username, status, inviter_username, created_at)
            VALUES ({ph}, {ph}, 'pending', {ph}, {ph})
            """,
            (root_id, username, inviter_username, _now_str()),
        )
        return True
    except Exception as exc:
        logger.warning("open_pending_placement failed for %s/%s: %s", community_id, username, exc)
        return False


# ---------------------------------------------------------------------------
# Member surface
# ---------------------------------------------------------------------------

def _parse_options(raw: Any) -> List[Dict[str, Any]]:
    try:
        options = json.loads(raw) if isinstance(raw, str) else (raw or [])
        return options if isinstance(options, list) else []
    except Exception:
        return []


def _member_questions(cursor, root_id: int) -> List[Dict[str, Any]]:
    """Questions stripped for the member: no target ids anywhere."""
    out: List[Dict[str, Any]] = []
    for row in _active_question_rows(cursor, root_id):
        options = _parse_options(_row_value(row, "options_json", 4))
        out.append(
            {
                "id": int(_row_value(row, "id", 0)),
                "prompt": _row_value(row, "prompt", 2),
                "allow_multi": bool(_row_value(row, "allow_multi", 3) or 0),
                "options": [
                    {"id": int(o.get("id")), "label": o.get("label")}
                    for o in options
                    if isinstance(o, dict) and o.get("id") is not None
                ],
            }
        )
    return out


def list_pending_for_user(username: str) -> Tuple[Dict[str, Any], int]:
    """All live pending placements for a member, welcome context included.

    A pending row whose gate has gone dark (downgraded tier, feature off,
    questions deactivated) is omitted — never surfaced, never a blocker.
    """
    ensure_tables()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"""
                SELECT r.community_id, r.inviter_username, com.name AS community_name
                FROM community_placement_responses r
                JOIN communities com ON com.id = r.community_id
                WHERE r.username = {ph} AND r.status = 'pending'
                ORDER BY r.created_at ASC, r.id ASC
                """,
                (username,),
            )
            rows = c.fetchall() or []
            pending: List[Dict[str, Any]] = []
            for row in rows:
                community_id = int(_row_value(row, "community_id", 0))
                if placement_gate_root(c, community_id) != community_id:
                    continue
                pending.append(
                    {
                        "community_id": community_id,
                        "community_name": _row_value(row, "community_name", 2),
                        "inviter_username": _row_value(row, "inviter_username", 1),
                        "questions": _member_questions(c, community_id),
                    }
                )
            return {"success": True, "pending": pending}, 200
    except Exception as exc:
        logger.error("list_pending_for_user failed for %s: %s", username, exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


def respond(username: str, community_id: int, answers: Any) -> Tuple[Dict[str, Any], int]:
    """Validate the member's answers and apply the owner's mapping.

    ``answers`` is ``{question_id: [option_id, ...]}`` (JSON object keys may
    arrive as strings). Single-choice questions require exactly one option;
    multi-choice accept zero or more. Allocation is the union of the selected
    options' targets, inserted through add_user_to_community in the same
    transaction that completes the response row.
    """
    ensure_tables()
    try:
        answers_map: Dict[int, List[int]] = {}
        for key, value in (answers or {}).items():
            picked = value if isinstance(value, list) else [value]
            answers_map[int(key)] = [int(v) for v in picked]
    except Exception:
        return {"success": False, "error": "invalid_answers", "reason": "invalid_answers"}, 400

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(
                f"SELECT id, status FROM community_placement_responses WHERE community_id = {ph} AND username = {ph}",
                (int(community_id), username),
            )
            resp_row = c.fetchone()
            if not resp_row:
                return {"success": False, "error": "not_found", "reason": "not_found"}, 404
            if _row_value(resp_row, "status", 1) != STATUS_PENDING:
                return {"success": False, "error": "already_completed", "reason": "already_completed"}, 400
            response_id = int(_row_value(resp_row, "id", 0))

            root_id = placement_gate_root(c, int(community_id))
            if root_id != int(community_id):
                # Gate went dark since the row opened — close it quietly.
                c.execute(
                    f"UPDATE community_placement_responses SET status = 'completed', completed_at = {ph} WHERE id = {ph}",
                    (_now_str(), response_id),
                )
                conn.commit()
                return {"success": True, "allocated": [], "gate_inactive": True}, 200

            target_ids: set = set()
            for row in _active_question_rows(c, int(community_id)):
                question_id = int(_row_value(row, "id", 0))
                allow_multi = bool(_row_value(row, "allow_multi", 3) or 0)
                options = {
                    int(o["id"]): o
                    for o in _parse_options(_row_value(row, "options_json", 4))
                    if isinstance(o, dict) and o.get("id") is not None
                }
                picked = answers_map.get(question_id)
                if picked is None or (not allow_multi and len(picked) != 1):
                    return {
                        "success": False,
                        "error": "answers_incomplete",
                        "reason": "answers_incomplete",
                        "question_id": question_id,
                    }, 400
                for option_id in picked:
                    option = options.get(int(option_id))
                    if option is None:
                        return {
                            "success": False,
                            "error": "invalid_option",
                            "reason": "invalid_option",
                            "question_id": question_id,
                        }, 400
                    for target in option.get("target_community_ids") or []:
                        try:
                            target_ids.add(int(target))
                        except Exception:
                            continue

            # The mapping is owner-authored data; harden the write against
            # edits that raced the answer: only live descendants of the root
            # are ever joined, and the root itself is never a target.
            valid_targets: List[Tuple[int, str]] = []
            if target_ids:
                from backend.services.community import get_descendant_community_ids

                descendant_ids = set(get_descendant_community_ids(c, int(community_id)))
                descendant_ids.discard(int(community_id))
                for target in sorted(target_ids):
                    if target not in descendant_ids:
                        continue
                    c.execute(f"SELECT name FROM communities WHERE id = {ph}", (target,))
                    name_row = c.fetchone()
                    if name_row:
                        valid_targets.append((target, _row_value(name_row, "name", 0)))

            c.execute(f"SELECT id FROM users WHERE username = {ph}", (username,))
            user_row = c.fetchone()
            if not user_row:
                return {"success": False, "error": "not_found", "reason": "not_found"}, 404
            user_id = int(_row_value(user_row, "id", 0))

            allocated: List[Dict[str, Any]] = []
            add_user_to_community = _legacy_helpers()["add_user_to_community"]
            for target_id, target_name in valid_targets:
                c.execute(
                    f"SELECT 1 FROM user_communities WHERE user_id = {ph} AND community_id = {ph}",
                    (user_id, target_id),
                )
                if c.fetchone():
                    continue
                try:
                    add_user_to_community(c, user_id, target_id, username=username)
                except CommunityMembershipLimitError as exc:
                    conn.rollback()
                    return render_member_cap_error(exc, session_username=username)
                allocated.append({"id": target_id, "name": target_name})

            c.execute(
                f"""
                UPDATE community_placement_responses
                SET status = 'completed', answers_json = {ph}, allocated_ids_json = {ph}, completed_at = {ph}
                WHERE id = {ph}
                """,
                (
                    json.dumps({str(k): v for k, v in answers_map.items()}),
                    json.dumps([t["id"] for t in allocated]),
                    _now_str(),
                    response_id,
                ),
            )
            conn.commit()
        invalidate_user_cache(username)
        return {"success": True, "allocated": allocated}, 200
    except Exception as exc:
        logger.error("placement respond failed for %s/%s: %s", community_id, username, exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


# ---------------------------------------------------------------------------
# Owner config
# ---------------------------------------------------------------------------

def _manage_denied(username: str, community_id: int) -> Optional[Tuple[Dict[str, Any], int]]:
    if not _legacy_helpers()["has_community_management_permission"](username, int(community_id)):
        return {"success": False, "error": "Forbidden"}, 403
    return None


def _root_enterprise_denied(cursor, community_id: int) -> Optional[Tuple[Dict[str, Any], int]]:
    ph = get_sql_placeholder()
    cursor.execute(
        f"SELECT parent_community_id FROM communities WHERE id = {ph}", (int(community_id),)
    )
    row = cursor.fetchone()
    if not row:
        return {"success": False, "error": "Community not found"}, 404
    if _row_value(row, "parent_community_id", 0) is not None:
        return {
            "success": False,
            "error": "root_only",
            "reason": "root_only",
        }, 400
    if get_community_tier(cursor, int(community_id)) != COMMUNITY_TIER_ENTERPRISE:
        return {
            "success": False,
            "error": "enterprise_required",
            "reason": "enterprise_required",
        }, 403
    return None


def _descendant_options(cursor, root_id: int) -> List[Dict[str, Any]]:
    from backend.services.community import get_descendant_community_ids

    ids = [i for i in get_descendant_community_ids(cursor, int(root_id)) if int(i) != int(root_id)]
    if not ids:
        return []
    ph = get_sql_placeholder()
    placeholders = ", ".join([ph] * len(ids))
    cursor.execute(
        f"SELECT id, name, parent_community_id FROM communities WHERE id IN ({placeholders})",
        tuple(int(i) for i in ids),
    )
    rows = cursor.fetchall() or []
    return sorted(
        (
            {
                "id": int(_row_value(r, "id", 0)),
                "name": _row_value(r, "name", 1),
                "parent_community_id": _row_value(r, "parent_community_id", 2),
            }
            for r in rows
        ),
        key=lambda item: (item["name"] or "").lower(),
    )


def get_config(username: str, community_id: int) -> Tuple[Dict[str, Any], int]:
    denied = _manage_denied(username, community_id)
    if denied:
        return denied
    ensure_tables()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            denied = _root_enterprise_denied(c, community_id)
            if denied:
                return denied
            questions = []
            for row in _active_question_rows(c, int(community_id)):
                questions.append(
                    {
                        "id": int(_row_value(row, "id", 0)),
                        "prompt": _row_value(row, "prompt", 2),
                        "allow_multi": bool(_row_value(row, "allow_multi", 3) or 0),
                        "options": _parse_options(_row_value(row, "options_json", 4)),
                    }
                )
            return {
                "success": True,
                "enabled": bool(questions) and _kb_included(),
                "questions": questions,
                "sub_communities": _descendant_options(c, int(community_id)),
                "limits": {
                    "max_questions": MAX_QUESTIONS,
                    "max_options_per_question": MAX_OPTIONS_PER_QUESTION,
                    "min_options_per_question": MIN_OPTIONS_PER_QUESTION,
                    "prompt_max_len": PROMPT_MAX_LEN,
                    "option_label_max_len": OPTION_LABEL_MAX_LEN,
                },
            }, 200
    except Exception as exc:
        logger.error("placement get_config failed for %s: %s", community_id, exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500


def save_config(username: str, community_id: int, payload: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    """Replace-all save of the owner's questions.

    Option ids are assigned server-side (stable within a save); target ids
    must be existing descendants of the root. An empty questions list turns
    the feature off for this community.
    """
    denied = _manage_denied(username, community_id)
    if denied:
        return denied
    ensure_tables()
    raw_questions = payload.get("questions")
    if not isinstance(raw_questions, list) or len(raw_questions) > MAX_QUESTIONS:
        return {"success": False, "error": "invalid_questions", "reason": "invalid_questions"}, 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            denied = _root_enterprise_denied(c, community_id)
            if denied:
                return denied

            from backend.services.community import get_descendant_community_ids

            descendant_ids = set(get_descendant_community_ids(c, int(community_id)))
            descendant_ids.discard(int(community_id))

            normalized: List[Dict[str, Any]] = []
            option_seq = 0
            for position, raw_q in enumerate(raw_questions):
                if not isinstance(raw_q, dict):
                    return {"success": False, "error": "invalid_questions", "reason": "invalid_questions"}, 400
                prompt = " ".join(str(raw_q.get("prompt") or "").split()).strip()
                if not prompt or len(prompt) > PROMPT_MAX_LEN:
                    return {
                        "success": False,
                        "error": "invalid_prompt",
                        "reason": "invalid_prompt",
                        "max_length": PROMPT_MAX_LEN,
                    }, 400
                raw_options = raw_q.get("options")
                if (
                    not isinstance(raw_options, list)
                    or len(raw_options) < MIN_OPTIONS_PER_QUESTION
                    or len(raw_options) > MAX_OPTIONS_PER_QUESTION
                ):
                    return {"success": False, "error": "invalid_options", "reason": "invalid_options"}, 400
                options: List[Dict[str, Any]] = []
                for raw_o in raw_options:
                    if not isinstance(raw_o, dict):
                        return {"success": False, "error": "invalid_options", "reason": "invalid_options"}, 400
                    label = " ".join(str(raw_o.get("label") or "").split()).strip()
                    if not label or len(label) > OPTION_LABEL_MAX_LEN:
                        return {
                            "success": False,
                            "error": "invalid_option_label",
                            "reason": "invalid_option_label",
                            "max_length": OPTION_LABEL_MAX_LEN,
                        }, 400
                    targets: List[int] = []
                    for raw_t in raw_o.get("target_community_ids") or []:
                        try:
                            target = int(raw_t)
                        except Exception:
                            return {"success": False, "error": "invalid_target", "reason": "invalid_target"}, 400
                        if target not in descendant_ids:
                            return {
                                "success": False,
                                "error": "invalid_target",
                                "reason": "invalid_target",
                                "target_community_id": target,
                            }, 400
                        if target not in targets:
                            targets.append(target)
                    option_seq += 1
                    options.append(
                        {"id": option_seq, "label": label, "target_community_ids": targets}
                    )
                normalized.append(
                    {
                        "position": position,
                        "prompt": prompt,
                        "allow_multi": 1 if raw_q.get("allow_multi") else 0,
                        "options": options,
                    }
                )

            ph = get_sql_placeholder()
            c.execute(
                f"DELETE FROM community_placement_questions WHERE community_id = {ph}",
                (int(community_id),),
            )
            now_value = _now_str()
            for q in normalized:
                c.execute(
                    f"""
                    INSERT INTO community_placement_questions
                        (community_id, position, prompt, allow_multi, options_json, is_active, updated_by, updated_at)
                    VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, 1, {ph}, {ph})
                    """,
                    (
                        int(community_id),
                        q["position"],
                        q["prompt"],
                        q["allow_multi"],
                        json.dumps(q["options"]),
                        username,
                        now_value,
                    ),
                )
            conn.commit()
        return get_config(username, community_id)
    except Exception as exc:
        logger.error("placement save_config failed for %s: %s", community_id, exc, exc_info=True)
        return {"success": False, "error": "Server error"}, 500
