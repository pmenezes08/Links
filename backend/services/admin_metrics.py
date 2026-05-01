"""Admin dashboard DAU/MAU, cohorts, and leaderboards (heavy, full-table scans)."""

from __future__ import annotations

from calendar import monthrange
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple


def _scalar_result(row: Any, column_index: int = 0, column_name: Optional[str] = None) -> Any:
    if row is None:
        return None
    if hasattr(row, "keys"):
        if column_name:
            return row[column_name] if column_name in row.keys() else None
        values = list(row)
        return values[column_index] if values else None
    return row[column_index] if len(row) > column_index else None


def compute_admin_metrics(c, tf: str, tp: Tuple) -> Dict[str, Any]:
    """Compute DAU, MAU, cohorts, leaderboards and return a stats dict.

    ``tf`` / ``tp`` must match the monolith's ``_tenant_filter()`` return shape.
    """
    c.execute(f"SELECT COUNT(*) as count FROM users WHERE 1=1{tf}", tp)
    total_users = _scalar_result(c.fetchone(), column_name="count")

    c.execute(f"SELECT COUNT(*) as count FROM users WHERE subscription = 'premium'{tf}", tp)
    premium_users = _scalar_result(c.fetchone(), column_name="count")

    c.execute(f"SELECT COUNT(*) as count FROM communities WHERE 1=1{tf}", tp)
    total_communities = _scalar_result(c.fetchone(), column_name="count")

    c.execute(f"SELECT COUNT(*) as count FROM posts WHERE 1=1{tf}", tp)
    total_posts = _scalar_result(c.fetchone(), column_name="count")

    today = datetime.now().date()
    start_of_day = datetime(today.year, today.month, today.day)
    start_of_30 = start_of_day - timedelta(days=30)

    def get_unique_between(table, field, ts_field, start_ts):
        try:
            q = f"SELECT DISTINCT {field}, {ts_field} FROM {table} WHERE {ts_field} IS NOT NULL"
            c.execute(q)
            rows = c.fetchall() or []
            vals = set()
            for r in rows:
                try:
                    username_val = r[field] if hasattr(r, "keys") else r[0]
                    ts_val = r[ts_field] if hasattr(r, "keys") else (r[1] if len(r) > 1 else None)
                    if not ts_val:
                        continue
                    s = str(ts_val)
                    dtv = None
                    try:
                        dtv = datetime.strptime(s[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S")
                    except Exception:
                        for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%m.%d.%y %H:%M"):
                            try:
                                dtv = datetime.strptime(s, fmt)
                                break
                            except Exception:
                                continue
                    if dtv and dtv >= start_ts:
                        vals.add(username_val)
                except Exception:
                    pass
            return vals
        except Exception:
            return set()

    dau_sets: List[set] = []
    mau_sets: List[set] = []
    for tbl, user_field, ts_field in (
        ("posts", "username", "timestamp"),
        ("reactions", "username", "created_at"),
        ("poll_votes", "username", "voted_at"),
        ("community_visit_history", "username", "visit_time"),
        ("messages", "sender", "timestamp"),
    ):
        dau_sets.append(get_unique_between(tbl, user_field, ts_field, start_of_day))
        mau_sets.append(get_unique_between(tbl, user_field, ts_field, start_of_30))

    dau = len(set().union(*dau_sets))
    mau = len(set().union(*mau_sets))
    dau_pct = round((dau / total_users) * 100, 2) if total_users else 0.0
    mau_pct = round((mau / total_users) * 100, 2) if total_users else 0.0

    def get_unique_between_window(table, field, ts_field, start_ts, end_ts):
        try:
            q = f"SELECT DISTINCT {field}, {ts_field} FROM {table} WHERE {ts_field} IS NOT NULL"
            c.execute(q)
            rows = c.fetchall() or []
            vals = set()
            for r in rows:
                try:
                    username_val = r[field] if hasattr(r, "keys") else r[0]
                    ts_val = r[ts_field] if hasattr(r, "keys") else (r[1] if len(r) > 1 else None)
                    if not ts_val:
                        continue
                    s = str(ts_val)
                    dtv = None
                    try:
                        dtv = datetime.strptime(s[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S")
                    except Exception:
                        for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%m.%d.%y %H:%M"):
                            try:
                                dtv = datetime.strptime(s, fmt)
                                break
                            except Exception:
                                continue
                    if dtv and (dtv >= start_ts) and (dtv < end_ts):
                        vals.add(username_val)
                except Exception:
                    pass
            return vals
        except Exception:
            return set()

    daily_counts = []
    for i in range(0, 30):
        day_start = start_of_day - timedelta(days=i)
        day_end = day_start + timedelta(days=1)
        day_sets = []
        for tbl, user_field, ts_field in (
            ("posts", "username", "timestamp"),
            ("reactions", "username", "created_at"),
            ("poll_votes", "username", "voted_at"),
            ("community_visit_history", "username", "visit_time"),
            ("messages", "sender", "timestamp"),
        ):
            day_sets.append(get_unique_between_window(tbl, user_field, ts_field, day_start, day_end))
        daily_counts.append(len(set().union(*day_sets)))
    avg_dau_30 = round(sum(daily_counts) / len(daily_counts), 2) if daily_counts else 0.0

    def get_activity_users(start_ts, end_ts):
        users_union = set()
        for tbl, user_field, ts_field in (
            ("posts", "username", "timestamp"),
            ("reactions", "username", "created_at"),
            ("poll_votes", "username", "voted_at"),
            ("community_visit_history", "username", "visit_time"),
            ("messages", "sender", "timestamp"),
        ):
            users_union |= get_unique_between_window(tbl, user_field, ts_field, start_ts, end_ts)
        return users_union

    cur_month_start = start_of_day.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if cur_month_start.month == 1:
        prev_month_start = cur_month_start.replace(year=cur_month_start.year - 1, month=12)
    else:
        prev_month_start = cur_month_start.replace(month=cur_month_start.month - 1)
    days_in_prev_month = monthrange(prev_month_start.year, prev_month_start.month)[1]
    prev_month_end = prev_month_start.replace(day=days_in_prev_month, hour=23, minute=59, second=59)
    days_in_cur_month = monthrange(cur_month_start.year, cur_month_start.month)[1]
    cur_month_end = cur_month_start.replace(day=days_in_cur_month, hour=23, minute=59, second=59)

    users_prev_month = get_activity_users(prev_month_start, prev_month_end)
    users_cur_month = get_activity_users(cur_month_start, cur_month_end)
    mau_month = len(users_cur_month)
    mru = len(users_prev_month & users_cur_month)
    mru_repeat_rate = round((mru / mau_month) * 100, 2) if mau_month else 0.0

    weekday = start_of_day.weekday()
    start_of_week = start_of_day.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=weekday)
    prev_week_start = start_of_week - timedelta(days=7)
    prev_week_end = start_of_week - timedelta(seconds=1)
    cur_week_end = start_of_week + timedelta(days=7) - timedelta(seconds=1)
    users_prev_week = get_activity_users(prev_week_start, prev_week_end)
    users_cur_week = get_activity_users(start_of_week, cur_week_end)
    wau = len(users_cur_week)
    wru = len(users_prev_week & users_cur_week)
    wru_repeat_rate = round((wru / wau) * 100, 2) if wau else 0.0

    cohorts = []
    month_starts = []
    ms = cur_month_start
    for _ in range(6):
        month_starts.append(ms)
        if ms.month == 1:
            ms = ms.replace(year=ms.year - 1, month=12)
        else:
            ms = ms.replace(month=ms.month - 1)
    month_starts = list(reversed(month_starts))

    c.execute(f"SELECT username, created_at FROM users WHERE 1=1{tf}", tp)
    all_users = c.fetchall() or []

    def in_month(dt, y, m):
        return dt.year == y and dt.month == m

    month_windows = []
    for ms_ in month_starts:
        y = ms_.year
        m = ms_.month
        days_in_month = monthrange(y, m)[1]
        start = ms_
        end = ms_.replace(day=days_in_month, hour=23, minute=59, second=59)
        month_windows.append((y, m, start, end))

    for i, (y, m, start, end) in enumerate(month_windows):
        cohort_users = set()
        for u in all_users:
            uname = u["username"] if hasattr(u, "keys") else u[0]
            created = u["created_at"] if hasattr(u, "keys") else (u[1] if len(u) > 1 else None)
            if not created:
                continue
            try:
                s = str(created)
                dtc = datetime.strptime(s[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S")
            except Exception:
                try:
                    dtc = datetime.strptime(str(created), "%Y-%m-%d")
                except Exception:
                    continue
            if in_month(dtc, y, m):
                cohort_users.add(uname)
        cohort_size = len(cohort_users)
        retention = []
        if cohort_size:
            for j in range(i, len(month_windows)):
                _, _, ws, we = month_windows[j]
                active = get_activity_users(ws, we)
                retained = len(active & cohort_users)
                retention.append(round((retained / cohort_size) * 100, 2))
        cohorts.append(
            {
                "month": f"{y:04d}-{m:02d}",
                "size": cohort_size,
                "retention": retention,
            }
        )

    def scalar_list(query, params=()):
        c.execute(query, params)
        rows = c.fetchall() or []
        out = []
        for r in rows:
            if hasattr(r, "keys"):
                out.append({"username": r["username"], "count": r["cnt"]})
            else:
                out.append({"username": r[0], "count": r[1]})
        return out

    top_posters = scalar_list(
        "SELECT username, COUNT(*) as cnt FROM posts WHERE LOWER(username) <> 'admin' "
        "GROUP BY username ORDER BY cnt DESC LIMIT 10"
    )
    top_reactors = scalar_list(
        "SELECT username, COUNT(*) as cnt FROM reactions WHERE LOWER(username) <> 'admin' "
        "GROUP BY username ORDER BY cnt DESC LIMIT 10"
    )
    top_voters = scalar_list(
        "SELECT username, COUNT(*) as cnt FROM poll_votes WHERE LOWER(username) <> 'admin' "
        "GROUP BY username ORDER BY cnt DESC LIMIT 10"
    )

    stats: Dict[str, Any] = {
        "total_users": total_users,
        "premium_users": premium_users,
        "total_communities": total_communities,
        "total_posts": total_posts,
        "dau": dau,
        "mau": mau,
        "dau_pct": dau_pct,
        "mau_pct": mau_pct,
        "avg_dau_30": avg_dau_30,
        "mau_month": mau_month,
        "mru": mru,
        "mru_repeat_rate_pct": mru_repeat_rate,
        "wau": wau,
        "wru": wru,
        "wru_repeat_rate_pct": wru_repeat_rate,
        "cohorts": cohorts,
        "leaderboards": {
            "top_posters": top_posters,
            "top_reactors": top_reactors,
            "top_voters": top_voters,
        },
    }

    try:
        c.execute(f"SELECT username, created_at FROM users WHERE 1=1{tf} ORDER BY created_at DESC LIMIT 1", tp)
        last_user_row = c.fetchone()
        if last_user_row:
            stats["last_user"] = {
                "username": last_user_row["username"] if hasattr(last_user_row, "keys") else last_user_row[0],
                "created_at": str(last_user_row["created_at"] if hasattr(last_user_row, "keys") else last_user_row[1])
                if (last_user_row["created_at"] if hasattr(last_user_row, "keys") else last_user_row[1])
                else None,
            }
    except Exception:
        pass

    try:
        c.execute(f"SELECT name, id FROM communities WHERE 1=1{tf} ORDER BY id DESC LIMIT 1", tp)
        last_comm_row = c.fetchone()
        if last_comm_row:
            stats["last_community"] = {
                "name": last_comm_row["name"] if hasattr(last_comm_row, "keys") else last_comm_row[0],
                "id": last_comm_row["id"] if hasattr(last_comm_row, "keys") else last_comm_row[1],
            }
    except Exception:
        pass

    return stats
