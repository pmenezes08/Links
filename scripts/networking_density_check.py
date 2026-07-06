# -*- coding: utf-8 -*-
"""Networking concierge density check — the GATE 1 re-open trigger.

The proactive networking concierge (July 2026 plan) was shelved at GATE 1:
0 of 40 root networks had >= 12 "matchable" members (content-active in 30d
AND basic-profile complete). Its build trigger is a DENSITY event, not a
date: re-open the plan when >= 5 root networks clear the bar.

Run monthly (read-only; SELECT only):

    python scripts/networking_density_check.py

Requires gcloud auth (password comes from Secret Manager) and pymysql.
Prod + staging share this DB, so founder/test communities inflate nothing —
the matchable predicate already filters inactives.
"""

from __future__ import annotations

import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta

import pymysql

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "34.78.168.84"
USER = "app_user"
DB = "cpoint"

MIN_MATCHABLE = 12      # per-community eligibility bar (mirrors the plan)
GATE_COMMUNITIES = 5    # re-open the concierge plan at this many eligible roots
BATCH = 3               # suggestions per digest, for pair-runway math


def _password() -> str:
    out = subprocess.run(
        ["gcloud", "secrets", "versions", "access", "latest",
         "--secret=mysql-password", "--project=cpoint-127c2"],
        capture_output=True, text=True, check=True, shell=(sys.platform == "win32"),
    )
    return out.stdout.strip()


def main() -> None:
    now = datetime.utcnow()
    d30 = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    conn = pymysql.connect(
        host=HOST, user=USER, password=_password(), database=DB,
        charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
        read_timeout=120, connect_timeout=15,
    )
    cur = conn.cursor()

    cur.execute("SELECT id, name, parent_community_id FROM communities")
    rows = cur.fetchall()
    parent = {r["id"]: r["parent_community_id"] for r in rows}
    names = {r["id"]: r["name"] for r in rows}

    def root_of(cid):
        seen = set()
        while cid is not None and cid not in seen:
            seen.add(cid)
            p = parent.get(cid)
            if not p:
                return cid
            cid = p
        return cid

    cur.execute(
        """
        SELECT uc.community_id, u.username, u.first_name, u.last_name, up.profile_picture
        FROM user_communities uc
        JOIN users u ON u.id = uc.user_id
        LEFT JOIN user_profiles up ON up.username = u.username
        WHERE LOWER(u.username) NOT IN ('steve','admin')
        """
    )
    members, complete = defaultdict(set), defaultdict(set)
    for r in cur.fetchall():
        root = root_of(r["community_id"])
        members[root].add(r["username"])
        if (r["first_name"] or "").strip() and (r["last_name"] or "").strip() \
                and (r["profile_picture"] or "").strip():
            complete[root].add(r["username"])

    active30 = defaultdict(set)
    for sql in (
        f"SELECT username, community_id FROM posts WHERE timestamp >= '{d30}'",
        f"""SELECT r.username, p.community_id FROM replies r
            JOIN posts p ON p.id = r.post_id WHERE r.timestamp >= '{d30}'""",
        f"""SELECT gm.sender_username AS username, gc.community_id
            FROM group_chat_messages gm JOIN group_chats gc ON gc.id = gm.group_id
            WHERE gm.created_at >= '{d30}' AND gc.community_id IS NOT NULL""",
    ):
        try:
            cur.execute(sql)
            for r in cur.fetchall():
                if r["community_id"] is None:
                    continue
                u = (r["username"] or "")
                if u.lower() in ("steve", "admin"):
                    continue
                active30[root_of(r["community_id"])].add(u)
        except Exception as exc:
            print(f"[warn] activity leg failed: {exc}")

    conn.close()

    eligible = []
    print(f"{'root':>6} {'name':<30} {'members':>8} {'active30':>9} {'matchable':>10} {'runway_w':>9}")
    for root in sorted(members, key=lambda r: -len(members[r])):
        matchable = active30.get(root, set()) & complete.get(root, set()) & members[root]
        mm = len(matchable)
        runway = round((mm * (mm - 1) / 2) / (BATCH * mm), 1) if mm else 0.0
        flag = "  <== ELIGIBLE" if mm >= MIN_MATCHABLE else ""
        if mm >= MIN_MATCHABLE:
            eligible.append(root)
        if len(members[root]) >= 3 or mm:
            print(f"{root:>6} {str(names.get(root) or '?')[:30]:<30} {len(members[root]):>8} "
                  f"{len(active30.get(root, set()) & members[root]):>9} {mm:>10} {runway:>9}{flag}")

    print(f"\nEligible roots (matchable >= {MIN_MATCHABLE}): {len(eligible)} / gate = {GATE_COMMUNITIES}")
    if len(eligible) >= GATE_COMMUNITIES:
        print("*** GATE OPEN: re-open the networking concierge plan "
              "(see the July 2026 delivery plan / STEVE docs). ***")
    else:
        print("Gate closed - the concierge stays shelved. Re-run next month.")


if __name__ == "__main__":
    main()
