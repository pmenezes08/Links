from __future__ import annotations

import pytest

from backend.services import community_admin_notifications
from backend.services.database import get_db_connection, get_sql_placeholder
from tests.fixtures import make_community, make_user


pytestmark = pytest.mark.usefixtures("mysql_dsn")


def test_notify_owner_of_admin_action_creates_support_notification():
    make_user("admin", is_admin=True)
    make_user("owner_notice")
    cid = make_community("Owner Notice", creator_username="owner_notice")

    sent = community_admin_notifications.notify_owner_of_admin_action(
        community_id=cid,
        action="frozen",
        actor_username="admin",
    )

    assert sent is True
    row = _notification_for("owner_notice", cid)
    assert row is not None
    assert "froze your community" in row["message"]
    assert "support@c-point.co" in row["message"]


def test_owner_action_does_not_notify_owner():
    make_user("owner_self")
    cid = make_community("Owner Self", creator_username="owner_self")

    sent = community_admin_notifications.notify_owner_of_admin_action(
        community_id=cid,
        action="frozen",
        actor_username="owner_self",
    )

    assert sent is False
    assert _notification_for("owner_self", cid) is None


def _notification_for(username: str, community_id: int):
    ph = get_sql_placeholder()
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute(
            f"""
            SELECT user_id, message
            FROM notifications
            WHERE user_id = {ph} AND community_id = {ph}
            """,
            (username, community_id),
        )
        row = c.fetchone()
    if not row:
        return None
    if hasattr(row, "keys"):
        return {"user_id": row["user_id"], "message": row["message"]}
    return {"user_id": row[0], "message": row[1]}
