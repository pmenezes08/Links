"""One-off: count ai_usage_log rows with request_type=steve_thread_summary."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for name in (".env.local", ".env"):
    p = ROOT / name
    if not p.exists():
        continue
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

backend = os.environ.get("DB_BACKEND", "sqlite")
print(f"DB_BACKEND={backend}")
if backend.lower() != "mysql":
    print("No MySQL configured locally — cannot query ai_usage_log.")
    raise SystemExit(0)

from backend.services.database import get_db_connection, get_sql_placeholder

ph = get_sql_placeholder()
with get_db_connection() as conn:
    c = conn.cursor()
    c.execute(
        f"SELECT COUNT(*) AS cnt FROM ai_usage_log WHERE request_type = {ph}",
        ("steve_thread_summary",),
    )
    row = c.fetchone()
    cnt = row["cnt"] if hasattr(row, "keys") else row[0]
    print(f"steve_thread_summary row count: {cnt}")

    c.execute(
        f"""
        SELECT id, username, surface, request_type, success,
               tokens_in, tokens_out, cost_usd, model, created_at
        FROM ai_usage_log
        WHERE request_type = {ph}
        ORDER BY id DESC
        LIMIT 10
        """,
        ("steve_thread_summary",),
    )
    rows = c.fetchall() or []
    print(f"Recent rows (max 10): {len(rows)}")
    for r in rows:
        if hasattr(r, "keys"):
            print(dict(r))
        else:
            print(r)
