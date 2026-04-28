"""Community calendar data access and event operations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import os
import re
from typing import Any

from backend.services.database import USE_MYSQL, get_db_connection, get_sql_placeholder
from backend.services.notifications import create_notification, send_push_to_user


class CalendarError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class EventInput:
    title: str
    date: str
    end_date: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    timezone: str | None = None
    description: str | None = None
    notification_preferences: str = "all"
    community_id: int | None = None
    group_id: int | None = None
    invite_all: bool = False
    invited_members: list[str] | None = None


def row_value(row: Any, key: str, index: int | None = None, default: Any = None) -> Any:
    if row is None:
        return default
    if hasattr(row, "keys"):
        try:
            return row[key]
        except Exception:
            return default
    if index is not None:
        try:
            return row[index]
        except Exception:
            return default
    return default


def extract_time(value: Any) -> str | None:
    if not value or str(value) in {"None", "00:00", "00:00:00", "0000-00-00 00:00:00"}:
        return None
    text = str(value)
    if " " in text:
        return text.split(" ", 1)[1][:5]
    return text[:5]


def validate_event_input(data: EventInput) -> None:
    if not data.title or not data.date:
        raise CalendarError("Title and start date are required")
    try:
        start_dt = datetime.strptime(data.date, "%Y-%m-%d")
    except ValueError as exc:
        raise CalendarError("Invalid start date format") from exc
    if data.end_date:
        try:
            end_dt = datetime.strptime(data.end_date, "%Y-%m-%d")
        except ValueError as exc:
            raise CalendarError("Invalid end date format") from exc
        if end_dt < start_dt:
            raise CalendarError("End date cannot be before start date")
    for label, value in (("start", data.start_time), ("end", data.end_time)):
        if value:
            try:
                datetime.strptime(value, "%H:%M")
            except ValueError as exc:
                raise CalendarError(f"Invalid {label} time format") from exc
    if data.start_time and data.end_time:
        end_date = data.end_date or data.date
        start_value = f"{data.date} {data.start_time}:00"
        end_value = f"{end_date} {data.end_time}:00"
        if end_value < start_value:
            raise CalendarError("End time cannot be before start time")
    if data.notification_preferences not in {"none", "1_week", "1_day", "1_hour", "all"}:
        data.notification_preferences = "all"


def _datetime_value(date: str, time_value: str | None) -> str | None:
    if not time_value:
        return None
    return f"{date} {time_value}:00"


def _rsvp_counts(cursor, event_id: int) -> dict[str, int]:
    ph = get_sql_placeholder()
    cursor.execute(
        f"""
        SELECT response, COUNT(*) as count
        FROM event_rsvps
        WHERE event_id = {ph}
        GROUP BY response
        """,
        (event_id,),
    )
    counts = {"going": 0, "maybe": 0, "not_going": 0}
    for row in cursor.fetchall() or []:
        response = row_value(row, "response", 0)
        if response in counts:
            counts[response] = int(row_value(row, "count", 1, 0) or 0)

    cursor.execute(
        f"SELECT COUNT(DISTINCT invited_username) as cnt FROM event_invitations WHERE event_id = {ph}",
        (event_id,),
    )
    invited_row = cursor.fetchone()
    total_invited = int(row_value(invited_row, "cnt", 0, 0) or 0) + 1
    cursor.execute(
        f"SELECT COUNT(DISTINCT username) as cnt FROM event_rsvps WHERE event_id = {ph}",
        (event_id,),
    )
    responded_row = cursor.fetchone()
    responded = int(row_value(responded_row, "cnt", 0, 0) or 0)
    counts["no_response"] = max(0, total_invited - responded)
    counts["total_invited"] = total_invited
    return counts


def _user_rsvp(cursor, event_id: int, username: str | None) -> str | None:
    if not username:
        return None
    ph = get_sql_placeholder()
    cursor.execute(
        f"SELECT response FROM event_rsvps WHERE event_id = {ph} AND username = {ph}",
        (event_id, username),
    )
    row = cursor.fetchone()
    return row_value(row, "response", 0)


def shape_event(row: Any, cursor, username: str | None, *, include_community_name: bool = False) -> dict[str, Any]:
    event_id = int(row_value(row, "id", 0))
    counts = _rsvp_counts(cursor, event_id)
    user_rsvp = _user_rsvp(cursor, event_id, username)
    creator = row_value(row, "username", 1)
    event = {
        "id": event_id,
        "username": creator,
        "title": row_value(row, "title", 2),
        "date": row_value(row, "date", 3),
        "end_date": row_value(row, "end_date", 4) or row_value(row, "date", 3),
        "time": row_value(row, "time", 7),
        "start_time": extract_time(row_value(row, "start_time", 5) or row_value(row, "time", 7)),
        "end_time": extract_time(row_value(row, "end_time", 6)),
        "timezone": row_value(row, "timezone", 11),
        "description": row_value(row, "description", 8),
        "created_at": row_value(row, "created_at", 9),
        "community_id": row_value(row, "community_id", 10),
        "rsvp_counts": counts,
        "user_rsvp": user_rsvp,
        "total_rsvps": counts["going"] + counts["maybe"] + counts["not_going"],
        "is_creator": str(creator or "").strip().lower() == str(username or "").strip().lower(),
    }
    if include_community_name:
        event["community_name"] = row_value(row, "community_name", 12)
        event["background_color"] = row_value(row, "background_color", 13)
    return event


def list_visible_events(username: str | None, *, upcoming_only: bool = False) -> list[dict[str, Any]]:
    if not username:
        return []
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        date_filter = "AND ce.date >= CURDATE()" if USE_MYSQL else "AND ce.date >= date('now')"
        query = f"""
            SELECT DISTINCT ce.id, ce.username, ce.title, ce.date,
                   COALESCE(ce.end_date, ce.date) as end_date,
                   COALESCE(ce.start_time, ce.time) as start_time,
                   ce.end_time, ce.time, ce.description, ce.created_at,
                   ce.community_id, ce.timezone
            FROM calendar_events ce
            LEFT JOIN event_invitations ei ON ce.id = ei.event_id
            WHERE (ce.username = {ph} OR ei.invited_username = {ph})
              {date_filter if upcoming_only else ""}
            ORDER BY ce.date ASC, COALESCE(ce.start_time, ce.time) ASC
        """
        cursor.execute(query, (username, username))
        return [shape_event(row, cursor, username) for row in cursor.fetchall() or []]


def list_all_member_events(username: str) -> list[dict[str, Any]]:
    events = list_visible_events(username, upcoming_only=True)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        cursor.execute(
            f"""
            SELECT uc.community_id, c.name as community_name
            FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            JOIN communities c ON c.id = uc.community_id
            WHERE LOWER(u.username) = LOWER({ph})
            """,
            (username,),
        )
        names = {row_value(row, "community_id", 0): row_value(row, "community_name", 1) for row in cursor.fetchall() or []}
    for event in events:
        event["community_name"] = names.get(event.get("community_id"), "Unknown")
    return events


def list_group_events(username: str | None, group_id: int) -> list[dict[str, Any]]:
    if not username:
        return []
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        groups_table = "`groups`" if USE_MYSQL else "groups"
        cursor.execute(f"SELECT community_id FROM {groups_table} WHERE id = {ph}", (group_id,))
        group_row = cursor.fetchone()
        if not group_row:
            raise CalendarError("Group not found", 404)
        community_id = row_value(group_row, "community_id", 0)
    return [
        event for event in list_visible_events(username)
        if str(event.get("community_id") or "") == str(community_id or "")
    ]


def ensure_user_can_view_event(event_id: int, username: str | None) -> None:
    """Ensure ``username`` may view this event (creator, invitee, or app admin).

    Matches the visibility rules of :func:`list_visible_events`.
    """
    if not username:
        raise CalendarError("Forbidden", 403)
    un = str(username).strip()
    if un.lower() == "admin":
        return
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        cursor.execute(
            f"""
            SELECT 1 FROM calendar_events ce
            WHERE ce.id = {ph}
              AND (
                LOWER(ce.username) = LOWER({ph})
                OR EXISTS (
                    SELECT 1 FROM event_invitations ei
                    WHERE ei.event_id = ce.id
                      AND LOWER(ei.invited_username) = LOWER({ph})
                )
              )
            """,
            (event_id, un, un),
        )
        if not cursor.fetchone():
            raise CalendarError("You cannot access this event", 403)


def _ics_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
        .replace("\r", "")
    )


def _ics_dtstamp_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _ics_parse_hm(value: Any) -> tuple[int, int] | None:
    if not value:
        return None
    s = str(value).strip()
    if s in {"00:00", "00:00:00"}:
        return None
    if " " in s:
        s = s.split(" ", 1)[1][:5]
    m = re.match(r"^(\d{1,2}):(\d{2})$", s)
    if not m:
        return None
    hh, mm = int(m.group(1)), int(m.group(2))
    if hh > 23 or mm > 59:
        return None
    return hh, mm


def format_event_ics(event: dict[str, Any], *, public_base_url: str) -> str:
    """Build an iCalendar (RFC 5545) document for one event (METHOD:PUBLISH)."""
    event_id = int(event["id"])
    title = _ics_escape(str(event.get("title") or "C-Point event"))
    desc_parts: list[str] = []
    raw_desc = event.get("description")
    if raw_desc:
        desc_parts.append(str(raw_desc).strip())
    tz_label = str(event.get("timezone") or "").strip()
    if tz_label:
        desc_parts.append(f"Timezone: {tz_label}")
    comm = str(event.get("community_name") or "").strip()
    if comm:
        desc_parts.append(f"Community: {comm}")
    base = (public_base_url or "").strip().rstrip("/") or "https://www.c-point.co"
    desc_parts.append(f"Open in C-Point: {base}/event/{event_id}")
    description = _ics_escape("\n".join(desc_parts)) if desc_parts else ""

    start_date = str(event.get("date") or "")[:10]
    if not start_date or len(start_date) < 10:
        start_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    end_date_field = event.get("end_date")
    end_date = str(end_date_field or event.get("date") or start_date)[:10]
    if "0000-00-00" in {start_date, end_date}:
        start_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        end_date = start_date

    start_hm = _ics_parse_hm(event.get("start_time"))
    end_hm = _ics_parse_hm(event.get("end_time"))
    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//C-Point//Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:cpoint-event-{event_id}@c-point.calendar",
        f"DTSTAMP:{_ics_dtstamp_utc()}",
        f"SUMMARY:{title}",
    ]
    if description:
        lines.append(f"DESCRIPTION:{description}")
    if comm:
        lines.append(f"LOCATION:{_ics_escape(comm)}")

    d0 = datetime.strptime(start_date, "%Y-%m-%d")
    d1 = datetime.strptime(end_date, "%Y-%m-%d")
    if start_hm:
        hh, mm = start_hm
        ds = start_date.replace("-", "")
        lines.append(f"DTSTART:{ds}T{hh:02d}{mm:02d}00")
        if end_hm:
            hh2, mm2 = end_hm
            de = end_date.replace("-", "")
            lines.append(f"DTEND:{de}T{hh2:02d}{mm2:02d}00")
        else:
            naive_start = datetime(d0.year, d0.month, d0.day, hh, mm, 0)
            naive_end = naive_start + timedelta(hours=1)
            lines.append(
                f"DTEND:{naive_end.strftime('%Y%m%dT%H%M%S')}"
            )
    else:
        lines.append(f"DTSTART;VALUE=DATE:{d0.strftime('%Y%m%d')}")
        end_exclusive = d1 + timedelta(days=1)
        lines.append(f"DTEND;VALUE=DATE:{end_exclusive.strftime('%Y%m%d')}")
    lines.append(f"URL:{_ics_escape(f'{base}/event/{event_id}')}")
    lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def public_calendar_base_url() -> str:
    """Public app origin for deep links inside .ics (env override)."""
    return (os.environ.get("PUBLIC_BASE_URL") or "").strip().rstrip("/") or "https://www.c-point.co"


def get_event(event_id: int, username: str | None, *, mark_viewed: bool = False) -> dict[str, Any]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        cursor.execute(
            f"""
            SELECT ce.*, c.name as community_name, c.background_color, c.creator_username
            FROM calendar_events ce
            LEFT JOIN communities c ON ce.community_id = c.id
            WHERE ce.id = {ph}
            """,
            (event_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise CalendarError("Event not found", 404)
        event = shape_event(row, cursor, username, include_community_name=True)
        event["can_edit"] = can_manage_event(cursor, username, event_id)
        if mark_viewed and username:
            cursor.execute(
                f"UPDATE event_invitations SET viewed = 1 WHERE event_id = {ph} AND invited_username = {ph}",
                (event_id, username),
            )
            conn.commit()
        return event


def can_manage_event(cursor, username: str | None, event_id: int) -> bool:
    if not username:
        return False
    if username == "admin":
        return True
    ph = get_sql_placeholder()
    cursor.execute(
        f"""
        SELECT e.username, e.community_id, c.creator_username
        FROM calendar_events e
        LEFT JOIN communities c ON e.community_id = c.id
        WHERE e.id = {ph}
        """,
        (event_id,),
    )
    row = cursor.fetchone()
    if not row:
        return False
    event_owner = row_value(row, "username", 0)
    community_id = row_value(row, "community_id", 1)
    community_owner = row_value(row, "creator_username", 2)
    if username in {event_owner, community_owner}:
        return True
    if community_id:
        cursor.execute(
            f"SELECT 1 FROM community_admins WHERE community_id = {ph} AND username = {ph}",
            (community_id, username),
        )
        return cursor.fetchone() is not None
    return False


def _community_name(cursor, community_id: int | None) -> str:
    if not community_id:
        return ""
    ph = get_sql_placeholder()
    cursor.execute(f"SELECT name FROM communities WHERE id = {ph}", (community_id,))
    row = cursor.fetchone()
    return str(row_value(row, "name", 0, "") or "")


def _invite_users(cursor, data: EventInput, creator: str) -> list[str]:
    if not data.community_id:
        return []
    ph = get_sql_placeholder()
    if data.invite_all:
        cursor.execute(
            f"""
            SELECT DISTINCT u.username
            FROM user_communities uc
            JOIN users u ON uc.user_id = u.id
            WHERE uc.community_id = {ph} AND u.username != {ph}
            """,
            (data.community_id, creator),
        )
        return [str(row_value(row, "username", 0)) for row in cursor.fetchall() or []]
    return [member for member in (data.invited_members or []) if member and member != creator]


def create_event(username: str, data: EventInput) -> dict[str, Any]:
    validate_event_input(data)
    end_date = data.end_date or None
    start_datetime = _datetime_value(data.date, data.start_time)
    end_datetime = _datetime_value(end_date or data.date, data.end_time)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        created_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute(
            f"""
            INSERT INTO calendar_events
                (username, title, date, end_date, time, start_time, end_time, description, created_at, community_id, timezone, notification_preferences)
            VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph}, {ph})
            """,
            (
                username,
                data.title,
                data.date,
                end_date,
                data.start_time,
                start_datetime,
                end_datetime,
                data.description or None,
                created_at,
                data.community_id,
                data.timezone or None,
                data.notification_preferences or "all",
            ),
        )
        event_id = int(cursor.lastrowid)
        invited_users = _invite_users(cursor, data, username)
        community_name = _community_name(cursor, data.community_id)
        for invited_user in invited_users:
            try:
                cursor.execute(
                    f"""
                    INSERT INTO event_invitations (event_id, invited_username, invited_by, invited_at)
                    VALUES ({ph}, {ph}, {ph}, {ph})
                    """,
                    (event_id, invited_user, username, datetime.utcnow().isoformat()),
                )
                message = (
                    f"{username} invited you to an event in {community_name}: {data.title}"
                    if community_name else f"{username} invited you to the event: {data.title}"
                )
                link = f"/event/{event_id}"
                cursor.execute(
                    f"""
                    INSERT INTO notifications (user_id, from_user, message, created_at, is_read, link, type, community_id)
                    VALUES ({ph}, {ph}, {ph}, {ph}, 0, {ph}, 'event_invitation', {ph})
                    """,
                    (invited_user, username, message, datetime.utcnow().isoformat(), link, data.community_id),
                )
                try:
                    send_push_to_user(
                        invited_user,
                        {
                            "title": f"{community_name} - Event Invitation" if community_name else "Event Invitation",
                            "body": f"{username} invited you to: {data.title}",
                            "url": link,
                            "tag": f"event-invite-{event_id}-{invited_user}",
                        },
                    )
                except Exception:
                    pass
            except Exception:
                continue
        conn.commit()
    return {"event_id": event_id, "invited_count": len(invited_users)}


def update_event(username: str, event_id: int, data: EventInput) -> None:
    validate_event_input(data)
    end_date = data.end_date or None
    start_datetime = _datetime_value(data.date, data.start_time)
    end_datetime = _datetime_value(end_date or data.date, data.end_time)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if not can_manage_event(cursor, username, event_id):
            raise CalendarError("You do not have permission to edit this event", 403)
        ph = get_sql_placeholder()
        cursor.execute(
            f"""
            UPDATE calendar_events
            SET title = {ph}, date = {ph}, end_date = {ph}, start_time = {ph}, end_time = {ph},
                time = {ph}, description = {ph}, timezone = {ph}
            WHERE id = {ph}
            """,
            (
                data.title,
                data.date,
                end_date,
                start_datetime,
                end_datetime,
                data.start_time,
                data.description or None,
                data.timezone or None,
                event_id,
            ),
        )
        conn.commit()


def delete_event(username: str, event_id: int) -> None:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if not can_manage_event(cursor, username, event_id):
            raise CalendarError("You do not have permission to delete this event", 403)
        ph = get_sql_placeholder()
        cursor.execute(f"DELETE FROM event_rsvps WHERE event_id = {ph}", (event_id,))
        cursor.execute(f"DELETE FROM event_invitations WHERE event_id = {ph}", (event_id,))
        cursor.execute(f"DELETE FROM event_notification_log WHERE event_id = {ph}", (event_id,))
        cursor.execute(
            f"DELETE FROM notifications WHERE type = 'event_invitation' AND link = {ph}",
            (f"/event/{event_id}",),
        )
        cursor.execute(f"DELETE FROM calendar_events WHERE id = {ph}", (event_id,))
        conn.commit()


def rsvp_event(username: str, event_id: int, response: str, note: str = "") -> dict[str, Any]:
    if response not in {"going", "maybe", "not_going"}:
        raise CalendarError("Invalid response")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        cursor.execute(f"SELECT username FROM calendar_events WHERE id = {ph}", (event_id,))
        row = cursor.fetchone()
        if not row:
            raise CalendarError("Event not found", 404)
        creator = row_value(row, "username", 0)
        if username != creator:
            cursor.execute(
                f"SELECT 1 FROM event_invitations WHERE event_id = {ph} AND invited_username = {ph}",
                (event_id, username),
            )
            if not cursor.fetchone():
                raise CalendarError("You are not invited to this event", 403)
        if USE_MYSQL:
            cursor.execute(
                f"""
                INSERT INTO event_rsvps (event_id, username, response, note, responded_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph})
                ON DUPLICATE KEY UPDATE response=VALUES(response), note=VALUES(note), responded_at=VALUES(responded_at)
                """,
                (event_id, username, response, note, datetime.utcnow().isoformat()),
            )
        else:
            cursor.execute(
                f"""
                INSERT INTO event_rsvps (event_id, username, response, note, responded_at)
                VALUES ({ph}, {ph}, {ph}, {ph}, {ph})
                ON CONFLICT(event_id, username)
                DO UPDATE SET response=excluded.response, note=excluded.note, responded_at=excluded.responded_at
                """,
                (event_id, username, response, note, datetime.utcnow().isoformat()),
            )
        counts = _rsvp_counts(cursor, event_id)
        conn.commit()
    return {"counts": counts, "user_rsvp": response}


def cancel_rsvp(username: str, event_id: int) -> dict[str, Any]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        cursor.execute(
            f"DELETE FROM event_rsvps WHERE event_id = {ph} AND username = {ph}",
            (event_id, username),
        )
        if cursor.rowcount == 0:
            raise CalendarError("No RSVP found", 404)
        counts = _rsvp_counts(cursor, event_id)
        conn.commit()
    return {"counts": counts}


def rsvp_details(event_id: int) -> dict[str, Any]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        cursor.execute(
            f"""
            SELECT r.username, r.response, u.username as display_name
            FROM event_rsvps r
            JOIN users u ON r.username = u.username
            WHERE r.event_id = {ph}
            ORDER BY r.response, u.username
            """,
            (event_id,),
        )
        attendees = {"going": [], "maybe": [], "not_going": [], "no_response": []}
        responded = set()
        for row in cursor.fetchall() or []:
            response = row_value(row, "response", 1)
            username = row_value(row, "username", 0)
            if response in attendees:
                attendees[response].append({"username": row_value(row, "display_name", 2) or username})
                responded.add(username)

        cursor.execute(f"SELECT username FROM calendar_events WHERE id = {ph}", (event_id,))
        event_row = cursor.fetchone()
        creator = row_value(event_row, "username", 0)
        cursor.execute(
            f"""
            SELECT i.invited_username, u.username as display_name
            FROM event_invitations i
            JOIN users u ON i.invited_username = u.username
            WHERE i.event_id = {ph}
            ORDER BY u.username
            """,
            (event_id,),
        )
        invited = list(cursor.fetchall() or [])
        invited_usernames = {row_value(row, "invited_username", 0) for row in invited}
        if creator and creator not in invited_usernames:
            invited.append({"invited_username": creator, "display_name": creator})
        for row in invited:
            invited_username = row_value(row, "invited_username", 0)
            if invited_username not in responded:
                attendees["no_response"].append({"username": row_value(row, "display_name", 1) or invited_username})
        return {
            "attendees": attendees,
            "total_invited": len(invited),
            "total_responded": len(responded),
        }
