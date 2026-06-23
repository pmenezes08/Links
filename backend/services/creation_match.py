"""Two-player turn-based MATCH primitive for Steve Builder creations.

Game-AGNOSTIC: the build supplies all rules + UI; this service only stores a
shared game-state blob + a move log between exactly two seats, and enforces:
  - seat identity (only the two players can read/act),
  - turn order (only the seat whose turn it is may move),
  - optimistic concurrency (a `version` that must match — rejects stale moves).

Identity is server-brokered (callers pass the session username; the build never
sees raw usernames — opponents are addressed by an OPAQUE handle and shown only
display names). All writes go through the session-authed routes in
backend/blueprints/builder.py.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from backend.services.database import get_db_connection, get_sql_placeholder, USE_MYSQL

logger = logging.getLogger(__name__)

_MATCH_SALT = os.environ.get("SECRET_KEY", "cpoint-match-handle")
_MAX_STATE_BYTES = 200_000
_MAX_MOVE_BYTES = 20_000


def _now() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _cell(row: Any, idx: int) -> Any:
    if row is None:
        return None
    return row[idx]


def _handle(username: str) -> str:
    """Opaque, stable handle for a username — so a build can pick an opponent
    without ever seeing the raw username (which it could exfiltrate)."""
    return hashlib.sha256(f"{_MATCH_SALT}:{username}".encode("utf-8")).hexdigest()[:20]


def _user_display(username: str) -> str:
    ph = get_sql_placeholder()
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(f"SELECT display_name FROM users WHERE username = {ph}", (username,))
            row = c.fetchone()
        name = _cell(row, 0)
        return str(name) if name else username
    except Exception:
        return username


def _member_usernames(community_id: int) -> List[str]:
    """Usernames in a community (the pool a player can challenge) — members
    (`user_communities.user_id` is a numeric FK to `users.id`) plus the creator."""
    ph = get_sql_placeholder()
    names: List[str] = []
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                f"""SELECT u.username FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id WHERE uc.community_id = {ph}""",
                (community_id,),
            )
            names = [str(_cell(r, 0)) for r in (c.fetchall() or []) if _cell(r, 0)]
            c.execute(f"SELECT creator_username FROM communities WHERE id = {ph}", (community_id,))
            creator = _cell(c.fetchone(), 0)
            if creator and str(creator) not in names:
                names.append(str(creator))
    except Exception:
        logger.warning("creation_match: member lookup failed", exc_info=True)
    return names


def list_opponents(creation_id: int, community_id: int, username: str) -> List[Dict[str, str]]:
    """Community members the user can challenge, as opaque handle + display name
    (never raw usernames)."""
    out: List[Dict[str, str]] = []
    seen = set()
    for u in _member_usernames(community_id):
        if u == username or u in seen:
            continue
        seen.add(u)
        out.append({"handle": _handle(u), "name": _user_display(u)})
    out.sort(key=lambda x: x["name"].lower())
    return out


def _resolve_handle(community_id: int, handle: str) -> Optional[str]:
    """Reverse an opaque opponent handle back to a username, but ONLY within the
    community's members (so a build can't target arbitrary users)."""
    for u in _member_usernames(community_id):
        if _handle(u) == handle:
            return u
    return None


_MATCH_COLS = ("id", "creation_id", "community_id", "seat1_username", "seat2_username",
               "status", "turn_seat", "state_json", "version", "last_seq", "winner_seat",
               "created_at", "updated_at", "last_move_at")


def _fetch_match(match_id: int) -> Optional[Dict[str, Any]]:
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(f"SELECT {', '.join(_MATCH_COLS)} FROM creation_matches WHERE id = {ph}", (match_id,))
        row = c.fetchone()
    if not row:
        return None
    return {col: _cell(row, i) for i, col in enumerate(_MATCH_COLS)}


def _seat_of(match: Dict[str, Any], username: str) -> Optional[int]:
    if username and username == match.get("seat1_username"):
        return 1
    if username and username == match.get("seat2_username"):
        return 2
    return None


def _winner_label(winner_seat: Optional[int], my_seat: int) -> Optional[str]:
    if winner_seat is None:
        return None
    w = int(winner_seat)
    if w == 0:
        return "draw"
    return "me" if w == my_seat else "them"


def _view(match: Dict[str, Any], username: str, *, with_state: bool = True) -> Dict[str, Any]:
    """Viewer-relative match dict for the build (no raw usernames)."""
    seat = _seat_of(match, username) or 1
    opp_user = match.get("seat2_username") if seat == 1 else match.get("seat1_username")
    turn = match.get("turn_seat")
    out: Dict[str, Any] = {
        "id": int(match["id"]),
        "status": match.get("status"),
        "your_seat": seat,
        "your_turn": match.get("status") == "active" and turn is not None and int(turn) == seat,
        "opponent": _user_display(str(opp_user)) if opp_user else "",
        "version": int(match.get("version") or 0),
        "last_seq": int(match.get("last_seq") or 0),
        "winner": _winner_label(match.get("winner_seat"), seat),
        "updated_at": str(match.get("updated_at") or ""),
    }
    if with_state:
        raw = match.get("state_json")
        try:
            out["state"] = json.loads(raw) if raw else None
        except Exception:
            out["state"] = None
    return out


def create_match(*, creation_id: int, community_id: int, challenger: str,
                 opponent_handle: str) -> Dict[str, Any]:
    """Challenge a community member. Returns the viewer-relative match dict."""
    opponent = _resolve_handle(community_id, opponent_handle)
    if not opponent:
        raise ValueError("opponent_not_found")
    if opponent == challenger:
        raise ValueError("cannot_challenge_self")
    now = _now()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""INSERT INTO creation_matches
                (creation_id, community_id, seat1_username, seat2_username, status,
                 turn_seat, state_json, version, last_seq, winner_seat,
                 created_at, updated_at, last_move_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, 'pending', NULL, NULL, 0, 0, NULL, {ph}, {ph}, NULL)""",
            (creation_id, community_id, challenger, opponent, now, now),
        )
        match_id = c.lastrowid
        conn.commit()
    _notify(int(match_id), recipient=opponent, event="match_invite", actor=challenger,
            creation_id=creation_id, community_id=community_id)
    match = _fetch_match(int(match_id)) or {}
    return _view(match, challenger)


def _set_status(match_id: int, *, status: str, turn_seat: Optional[int] = None,
                winner_seat: Optional[int] = None) -> None:
    now = _now()
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""UPDATE creation_matches SET status = {ph}, turn_seat = {ph},
                winner_seat = {ph}, updated_at = {ph} WHERE id = {ph}""",
            (status, turn_seat, winner_seat, now, match_id),
        )
        conn.commit()


def accept_match(match_id: int, username: str) -> Dict[str, Any]:
    match = _fetch_match(match_id)
    if not match:
        raise ValueError("match_not_found")
    if _seat_of(match, username) != 2:
        raise PermissionError("not_invited")
    if match.get("status") != "pending":
        raise ValueError("not_pending")
    _set_status(match_id, status="active", turn_seat=1, winner_seat=None)
    _notify(match_id, recipient=str(match["seat1_username"]), event="match_move", actor=username,
            creation_id=int(match["creation_id"]), community_id=int(match["community_id"]))
    return _view(_fetch_match(match_id) or {}, username)


def decline_match(match_id: int, username: str) -> Dict[str, Any]:
    match = _fetch_match(match_id)
    if not match:
        raise ValueError("match_not_found")
    if _seat_of(match, username) != 2:
        raise PermissionError("not_invited")
    if match.get("status") != "pending":
        raise ValueError("not_pending")
    _set_status(match_id, status="declined", turn_seat=None, winner_seat=None)
    return _view(_fetch_match(match_id) or {}, username)


def resign_match(match_id: int, username: str) -> Dict[str, Any]:
    match = _fetch_match(match_id)
    if not match:
        raise ValueError("match_not_found")
    seat = _seat_of(match, username)
    if seat is None:
        raise PermissionError("not_a_player")
    if match.get("status") not in ("active", "pending"):
        raise ValueError("not_active")
    other = 2 if seat == 1 else 1
    _set_status(match_id, status="finished", turn_seat=None, winner_seat=other)
    _notify(match_id, recipient=str(match["seat1_username"] if seat == 2 else match["seat2_username"]),
            event="match_over", actor=username,
            creation_id=int(match["creation_id"]), community_id=int(match["community_id"]))
    return _view(_fetch_match(match_id) or {}, username)


def list_matches(creation_id: int, username: str) -> List[Dict[str, Any]]:
    """The user's matches for this creation (in-progress + finished), newest first."""
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT {', '.join(_MATCH_COLS)} FROM creation_matches
                WHERE creation_id = {ph} AND (seat1_username = {ph} OR seat2_username = {ph})
                ORDER BY updated_at DESC LIMIT 50""",
            (creation_id, username, username),
        )
        rows = c.fetchall() or []
    matches = [{col: _cell(r, i) for i, col in enumerate(_MATCH_COLS)} for r in rows]
    return [_view(m, username, with_state=False) for m in matches]


def get_match(match_id: int, username: str) -> Dict[str, Any]:
    match = _fetch_match(match_id)
    if not match:
        raise ValueError("match_not_found")
    if _seat_of(match, username) is None:
        raise PermissionError("not_a_player")
    return _view(match, username)


def submit_move(match_id: int, username: str, *, move: Any, state: Any,
                expected_version: int, result: Optional[str] = None) -> Dict[str, Any]:
    """Apply one move. ATOMIC turn + version enforcement: rejects if it isn't the
    caller's turn, the match isn't active, or the version is stale.

    ``result`` (from the mover's POV) ends the game: 'win' | 'lose' | 'draw'.
    """
    match = _fetch_match(match_id)
    if not match:
        raise ValueError("match_not_found")
    seat = _seat_of(match, username)
    if seat is None:
        raise PermissionError("not_a_player")
    if match.get("status") != "active":
        raise ValueError("not_active")

    state_json = json.dumps(state) if state is not None else None
    move_json = json.dumps(move) if move is not None else None
    if state_json is not None and len(state_json.encode("utf-8")) > _MAX_STATE_BYTES:
        raise ValueError("state_too_large")
    if move_json is not None and len(move_json.encode("utf-8")) > _MAX_MOVE_BYTES:
        raise ValueError("move_too_large")

    other = 2 if seat == 1 else 1
    if result == "win":
        winner_seat, new_status, next_turn = seat, "finished", None
    elif result == "lose":
        winner_seat, new_status, next_turn = other, "finished", None
    elif result == "draw":
        winner_seat, new_status, next_turn = 0, "finished", None
    else:
        winner_seat, new_status, next_turn = None, "active", other

    now = _now()
    new_seq = int(match.get("last_seq") or 0) + 1
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        # Conditional update is the concurrency guard — only succeeds if it is still
        # this seat's turn at the expected version.
        c.execute(
            f"""UPDATE creation_matches
                SET state_json = {ph}, turn_seat = {ph}, version = version + 1,
                    last_seq = last_seq + 1, winner_seat = {ph}, status = {ph},
                    updated_at = {ph}, last_move_at = {ph}
                WHERE id = {ph} AND status = 'active' AND turn_seat = {ph} AND version = {ph}""",
            (state_json, next_turn, winner_seat, new_status, now, now,
             match_id, seat, int(expected_version)),
        )
        if c.rowcount != 1:
            conn.rollback()
            # Distinguish stale-version from not-your-turn for a clearer build error.
            cur = _fetch_match(match_id) or {}
            if cur.get("status") != "active":
                raise ValueError("not_active")
            if int(cur.get("turn_seat") or 0) != seat:
                raise PermissionError("not_your_turn")
            raise ValueError("stale_version")
        c.execute(
            f"""INSERT INTO creation_match_moves (match_id, seq, by_seat, move_json, created_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph})""",
            (match_id, new_seq, seat, move_json, now),
        )
        conn.commit()

    recipient = str(match["seat2_username"] if seat == 1 else match["seat1_username"])
    event = "match_over" if new_status == "finished" else "match_move"
    _notify(match_id, recipient=recipient, event=event, actor=username,
            creation_id=int(match["creation_id"]), community_id=int(match["community_id"]))
    return {"ok": True, "version": int(match.get("version") or 0) + 1, "seq": new_seq,
            "status": new_status, "winner": _winner_label(winner_seat, seat)}


def poll_match(match_id: int, username: str, since_seq: int) -> Dict[str, Any]:
    """Lightweight delta for live play: moves after ``since_seq`` + current turn/
    version/status. The opponent's move arrives here within a poll cycle."""
    match = _fetch_match(match_id)
    if not match:
        raise ValueError("match_not_found")
    seat = _seat_of(match, username)
    if seat is None:
        raise PermissionError("not_a_player")
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""SELECT seq, by_seat, move_json FROM creation_match_moves
                WHERE match_id = {ph} AND seq > {ph} ORDER BY seq ASC LIMIT 200""",
            (match_id, int(since_seq)),
        )
        rows = c.fetchall() or []
    moves = []
    for r in rows:
        raw = _cell(r, 2)
        try:
            mv = json.loads(raw) if raw else None
        except Exception:
            mv = None
        moves.append({"seq": int(_cell(r, 0)), "by": ("me" if int(_cell(r, 1)) == seat else "them"),
                      "move": mv})
    turn = match.get("turn_seat")
    return {
        "moves": moves,
        "your_turn": match.get("status") == "active" and turn is not None and int(turn) == seat,
        "version": int(match.get("version") or 0),
        "last_seq": int(match.get("last_seq") or 0),
        "status": match.get("status"),
        "winner": _winner_label(match.get("winner_seat"), seat),
    }


def _notify(match_id: int, *, recipient: str, event: str, actor: str,
            creation_id: int, community_id: int) -> None:
    """Best-effort: in-app notification + push in the RECIPIENT's locale, with a
    deep-link straight into the match. Never raises (a build must not fail because
    a notification didn't send)."""
    try:
        from backend.services import notifications, notification_copy
        link = f"/community/{community_id}/creation/{creation_id}?match={match_id}"
        locale = notification_copy.recipient_locale(recipient)
        actor_name = _user_display(actor)
        msg = notification_copy.in_app_text(event, locale, name=actor_name)
        push = notification_copy.push_payload(event, locale, name=actor_name)
        # post_id = match_id so repeated moves in the SAME match refresh ONE
        # notification row (the dedupe key), instead of spamming.
        notifications.create_notification(
            recipient, actor, event, post_id=match_id, community_id=community_id,
            message=msg, link=link,
        )
        notifications.send_push_to_user(recipient, {
            "title": push.get("title"), "body": push.get("body"),
            "url": link, "tag": f"match-{match_id}",
        })
    except Exception:
        logger.warning("creation_match: notify failed (event=%s match=%s)", event, match_id, exc_info=True)
