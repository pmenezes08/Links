#!/usr/bin/env python3
"""Inspect recent high-debit ai_usage_log rows and enumerate max credit combos."""
from __future__ import annotations

import json
import os
import sys

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _REPO)
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(_REPO, ".env"))
except ImportError:
    pass
os.environ.setdefault("STEVE_WEIGHTED_CREDITS_ENABLED", "true")

from backend.services import steve_credit_weights as scw  # noqa: E402


def main() -> None:
    rules = scw.load_credit_rules()
    print("=== KB credit rules (from load_credit_rules) ===")
    print(
        json.dumps(
            {
                "tier_slim_max": rules.tier_slim_max,
                "tier_standard_max": rules.tier_standard_max,
                "tier_slim": rules.tier_slim,
                "tier_standard": rules.tier_standard,
                "tier_heavy": rules.tier_heavy,
                "addon_web": rules.addon_web,
                "addon_x": rules.addon_x,
                "addon_router": rules.addon_router,
                "max_per_call": rules.max_per_call,
                "surface_weights": rules.surface_weights,
            },
            indent=2,
        )
    )

    print("\n=== Combinations with debit >= 9.5 (single row) ===")
    for surf in ("dm", "feed", "group"):
        for ti in (1000, 5000, 15000, 50000):
            for web in (False, True):
                for x in (False, True):
                    for router in (False, True):
                        deb, meta = scw.compute_credits_debited(
                            surface=surf,
                            request_type="steve_dm_reply" if surf == "dm" else "steve_post_reply",
                            tokens_in=ti,
                            tools_web_search=web,
                            tools_x_search=x,
                            router_pass_in_turn=router,
                            rules=rules,
                        )
                        if deb >= 9.5:
                            print(
                                f"  deb={deb} surface={surf} tokens_in={ti} "
                                f"web={web} x={x} router_on_row={router} meta={meta}"
                            )

    print("\n=== Recent ai_usage_log (credits_debited >= 3, last 30) ===")
    try:
        from backend.services.database import get_db_connection

        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                """
                SELECT id, username, surface, request_type, tokens_in, tokens_out,
                       credits_debited, credits_meta, cost_usd, model, created_at
                FROM ai_usage_log
                WHERE credits_debited IS NOT NULL AND credits_debited >= 3
                ORDER BY id DESC
                LIMIT 30
                """
            )
            rows = c.fetchall()
        print(f"rows: {len(rows)}")
        for row in rows:
            d = dict(row) if hasattr(row, "keys") else row
            print(json.dumps(d, default=str))
    except Exception as exc:
        print(f"DB unavailable: {type(exc).__name__}: {exc}")

    username_filter = os.environ.get("INSPECT_CREDITS_USER", "").strip()
    if username_filter:
        print(f"\n=== Recent rows for user={username_filter!r} (last 40) ===")
        try:
            from backend.services.database import get_db_connection

            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute(
                    """
                    SELECT id, username, surface, request_type, tokens_in, tokens_out,
                           credits_debited, credits_meta, cost_usd, model, created_at
                    FROM ai_usage_log
                    WHERE username = %s AND surface IN ('dm','feed','group','post_summary','voice_summary','translation','networking_steve')
                    ORDER BY id DESC
                    LIMIT 40
                    """,
                    (username_filter,),
                )
                rows = c.fetchall()
            print(f"rows: {len(rows)}")
            session_sum = 0.0
            for row in rows:
                d = dict(row) if hasattr(row, "keys") else row
                deb = float(d.get("credits_debited") or 0)
                session_sum += deb
                print(json.dumps(d, default=str))
            print(f"sum credits_debited (last {len(rows)} steve rows): {session_sum}")
        except Exception as exc:
            print(f"DB unavailable: {type(exc).__name__}: {exc}")

    print("\n=== Rows with credits_debited = 10 exactly (last 20) ===")
    try:
        from backend.services.database import get_db_connection

        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                """
                SELECT id, username, surface, request_type, tokens_in, tokens_out,
                       credits_debited, credits_meta, cost_usd, model, created_at
                FROM ai_usage_log
                WHERE credits_debited = 10 OR credits_debited = 10.0
                ORDER BY id DESC
                LIMIT 20
                """
            )
            rows = c.fetchall()
        print(f"rows: {len(rows)}")
        for row in rows:
            d = dict(row) if hasattr(row, "keys") else row
            print(json.dumps(d, default=str))
    except Exception as exc:
        print(f"DB unavailable: {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main()
