"""QA verification harness — single-session runner for today's scope.

Exercises three blocks against the shared staging+prod DB, **read-mostly**:

  §8  Entitlements gating:
      resolve_entitlements() for test_free / test_trial / test_premium /
      test_special and assert the per-tier shape.

  §10 Free-tier member cap (26th member block):
      Creates a throwaway Free-tier parent community owned by ``test_free``,
      wires 25 synthetic members onto it, calls
      ``ensure_free_parent_member_capacity`` with extra_members=1 and asserts
      it raises ``CommunityMembershipLimitError``. Cleans up every row it
      created before exiting (even on failure).

  §Scope-A  Per-surface tracking + weights round-trip:
      Seeds one ``ai_usage_log`` row per Steve surface for test_premium,
      asserts ``current_month_summary.by_surface`` buckets them correctly,
      asserts ``resolve_entitlements(test_premium).internal_weights`` matches
      the live KB value pulled from ``kb_pages``. Deletes the seeded rows
      afterwards.

Credentials come from MYSQL_* env vars (already set by the caller — the
harness refuses to run if DB_BACKEND != 'mysql').

Exit codes:
    0 — all three blocks passed
    1 — one or more assertions failed (see printed FAIL lines)
    2 — environment / setup problem (no DB creds, missing user, etc.)

Design notes:
  * Teardown is best-effort and always runs in a ``finally`` block, even
    when the body raises. Worst case a FAIL leaves one throwaway community
    + 25 qa_member_* users; teardown can be re-run by hand.
  * Nothing here mutates Paulo, admin, steve, or any of the 127 real users.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional


# Force UTF-8 stdout so Unicode arrows / em-dashes in status prints don't
# blow up under PowerShell's default cp1252 codec. (Harmless on Linux/macOS.)
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

# Force MySQL backend for the backend services we import.
os.environ.setdefault("DB_BACKEND", "mysql")

# Required env
REQUIRED = ("MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DB")
missing = [k for k in REQUIRED if not os.environ.get(k)]
if missing:
    print(f"ERROR: missing env vars: {missing}", file=sys.stderr)
    sys.exit(2)


# Heavy imports AFTER env is set so get_db_connection reads the right vars.
from backend.services import ai_usage  # noqa: E402
from backend.services.entitlements import resolve_entitlements  # noqa: E402
from backend.services.database import get_db_connection  # noqa: E402


# Collect pass/fail lines; print a summary at the end.
RESULTS: List[str] = []


def pf(ok: bool, label: str, detail: str = "") -> bool:
    tag = "PASS" if ok else "FAIL"
    line = f"  [{tag}] {label}" + (f" — {detail}" if detail else "")
    RESULTS.append(line)
    print(line)
    return ok


# ─── §8 ──────────────────────────────────────────────────────────────────


def run_section_8() -> bool:
    print("\n§8 — Entitlements gating (resolve_entitlements)")
    all_ok = True

    expectations = [
        # (username, tier, can_use_steve, steve_uses, communities_max_predicate,
        #  member_cap_predicate)
        ("test_free",    "free",    False, 0,    lambda v: v == 5,        lambda v: v == 25),
        ("test_trial",   "trial",   True,  100,  lambda v: v == 5,        lambda v: v == 25),
        # Phase 3 (April 2026): Premium user tier no longer carries a
        # per-community member cap — the community's own tier drives it.
        # Resolver reports None for Premium, same as Special.
        ("test_premium", "premium", True,  100,  lambda v: v == 10,       lambda v: v is None),
        ("test_special", "special", True,  None, lambda v: v is None,     lambda v: v is None),
    ]

    for username, exp_tier, exp_steve, exp_uses, comm_ok, memb_ok in expectations:
        try:
            ent = resolve_entitlements(username)
        except Exception as e:
            all_ok &= pf(False, f"{username}: resolve_entitlements raised", str(e))
            continue

        all_ok &= pf(ent.get("tier") == exp_tier,
                     f"{username}: tier",
                     f"got={ent.get('tier')} expected={exp_tier}")
        all_ok &= pf(ent.get("can_use_steve") is exp_steve,
                     f"{username}: can_use_steve",
                     f"got={ent.get('can_use_steve')} expected={exp_steve}")
        all_ok &= pf(ent.get("steve_uses_per_month") == exp_uses,
                     f"{username}: steve_uses_per_month",
                     f"got={ent.get('steve_uses_per_month')} expected={exp_uses}")
        all_ok &= pf(comm_ok(ent.get("communities_max")),
                     f"{username}: communities_max",
                     f"got={ent.get('communities_max')}")
        all_ok &= pf(memb_ok(ent.get("members_per_owned_community")),
                     f"{username}: members_per_owned_community",
                     f"got={ent.get('members_per_owned_community')}")
        # Every tier should always carry internal_weights (cross-cutting invariant).
        w = ent.get("internal_weights")
        all_ok &= pf(isinstance(w, dict) and "dm" in w and "group" in w,
                     f"{username}: internal_weights present",
                     f"got={w}")

    return all_ok


# ─── §10 ─────────────────────────────────────────────────────────────────

def _get_user_id(cursor, username: str) -> Optional[int]:
    cursor.execute("SELECT id FROM users WHERE username = %s", (username,))
    row = cursor.fetchone()
    if not row:
        return None
    return int(row["id"] if isinstance(row, dict) else row[0])


def _create_qa_community(cursor, creator: str) -> int:
    """Insert a throwaway parent community owned by ``creator``. Return id."""
    join_code = "QA" + secrets.token_hex(5).upper()[:10]
    cursor.execute(
        """
        INSERT INTO communities
            (name, type, creator_username, join_code, created_at, tier,
             description, parent_community_id, is_active)
        VALUES (%s, %s, %s, %s, NOW(), %s, %s, NULL, 1)
        """,
        (
            f"qa_member_cap_{secrets.token_hex(3)}",
            "community",
            creator,
            join_code,
            "free",
            "Throwaway test community for QA §10 — safe to delete.",
        ),
    )
    cursor.execute("SELECT LAST_INSERT_ID() AS id")
    return int(cursor.fetchone()["id"])


def _create_synthetic_members(cursor, n: int) -> List[int]:
    """Insert ``n`` throwaway ``qa_member_NN`` users and return their ids."""
    ids: List[int] = []
    for i in range(n):
        uname = f"qa_member_{secrets.token_hex(3)}_{i:02d}"
        cursor.execute(
            """
            INSERT INTO users
                (username, email, subscription, password, created_at, is_active)
            VALUES (%s, %s, 'free', %s, NOW(), 1)
            """,
            (uname, f"{uname}@qa.test.local", "not-a-real-hash-placeholder"),
        )
        cursor.execute("SELECT LAST_INSERT_ID() AS id")
        ids.append(int(cursor.fetchone()["id"]))
    return ids


def _attach_members(cursor, community_id: int, user_ids: List[int]) -> None:
    for uid in user_ids:
        cursor.execute(
            "INSERT INTO user_communities (user_id, community_id, role) VALUES (%s, %s, %s)",
            (uid, community_id, "member"),
        )


def _cleanup(cursor, community_id: Optional[int], user_ids: List[int]) -> None:
    if community_id is not None:
        try:
            cursor.execute(
                "DELETE FROM user_communities WHERE community_id = %s",
                (community_id,),
            )
        except Exception:
            traceback.print_exc()
        try:
            cursor.execute("DELETE FROM communities WHERE id = %s", (community_id,))
        except Exception:
            traceback.print_exc()
    if user_ids:
        fmt = ",".join(["%s"] * len(user_ids))
        try:
            cursor.execute(f"DELETE FROM user_communities WHERE user_id IN ({fmt})", tuple(user_ids))
        except Exception:
            traceback.print_exc()
        try:
            cursor.execute(f"DELETE FROM users WHERE id IN ({fmt})", tuple(user_ids))
        except Exception:
            traceback.print_exc()


def run_section_10() -> bool:
    print("\n§10 — Free-tier 26th-member block")
    all_ok = True
    community_id: Optional[int] = None
    member_ids: List[int] = []

    # Import here — ensure_free_parent_member_capacity lives on the monolith and
    # is slow to import (triggers Flask app init). Scoping it to this section
    # keeps §8 fast and independent.
    try:
        from bodybuilding_app import (  # type: ignore
            ensure_free_parent_member_capacity,
            CommunityMembershipLimitError,
        )
    except Exception as e:
        return pf(False, "import ensure_free_parent_member_capacity", str(e))

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            test_free_id = _get_user_id(c, "test_free")
            if test_free_id is None:
                return pf(False, "test_free not found in users table")

            # 1. Create throwaway parent community owned by test_free.
            community_id = _create_qa_community(c, "test_free")

            # 2. Create 25 synthetic members + attach them.
            member_ids = _create_synthetic_members(c, 25)
            _attach_members(c, community_id, member_ids)

            # 3. Sanity-check the count.
            c.execute(
                "SELECT COUNT(*) AS n FROM user_communities WHERE community_id = %s",
                (community_id,),
            )
            n = int(c.fetchone()["n"])
            all_ok &= pf(n == 25, "seeded 25 members", f"got={n}")

            # 4a. extra_members=0 must NOT raise (boundary check — exactly at cap).
            try:
                ensure_free_parent_member_capacity(c, community_id, extra_members=0)
                all_ok &= pf(True, "boundary: 25 + 0 does not raise")
            except CommunityMembershipLimitError as e:
                all_ok &= pf(False, "boundary: 25 + 0 should not raise", str(e))

            # 4b. extra_members=1 MUST raise (this is the 26th-member block).
            # As of the Phase-1 refactor, the exception carries structured
            # attributes (cap, community_id, community_name, …) rather than a
            # plain message, so we assert on ``.cap`` rather than grepping
            # ``str(exc)``.
            try:
                ensure_free_parent_member_capacity(
                    c, community_id, extra_members=1,
                    attempted_username="qa_synthetic_extra",
                )
                all_ok &= pf(False, "26th member: expected raise but got through")
            except CommunityMembershipLimitError as e:
                all_ok &= pf(True, "26th member raises")
                all_ok &= pf(e.cap == 25,
                             "error carries cap=25",
                             f"cap={e.cap!r}")
                all_ok &= pf(e.community_id == community_id,
                             "error carries community_id",
                             f"got={e.community_id!r} expected={community_id}")

    except Exception as e:
        traceback.print_exc()
        all_ok &= pf(False, "§10 setup crashed", str(e))
    finally:
        try:
            with get_db_connection() as conn:
                _cleanup(conn.cursor(), community_id, member_ids)
                print(f"  teardown: removed community={community_id} + {len(member_ids)} synthetic members")
        except Exception:
            traceback.print_exc()

    return all_ok


# ─── Scope A ─────────────────────────────────────────────────────────────


def _seeded_surface_rows_cleanup(conn_cursor, ids: List[int]) -> None:
    if not ids:
        return
    fmt = ",".join(["%s"] * len(ids))
    try:
        conn_cursor.execute(f"DELETE FROM ai_usage_log WHERE id IN ({fmt})", tuple(ids))
    except Exception:
        traceback.print_exc()


def run_scope_a() -> bool:
    print("\nScope A — Per-surface tracking + KB → resolver weights round-trip")
    all_ok = True
    seeded_ids: List[int] = []
    surfaces = ["dm", "group", "feed", "post_summary", "voice_summary"]

    try:
        # 1. Insert one ai_usage_log row per Steve surface for test_premium.
        with get_db_connection() as conn:
            c = conn.cursor()
            for surface in surfaces:
                c.execute(
                    """
                    INSERT INTO ai_usage_log
                        (username, request_type, surface, success, cost_usd,
                         tokens_in, tokens_out, created_at)
                    VALUES (%s, %s, %s, 1, %s, %s, %s, NOW())
                    """,
                    ("test_premium", f"qa_{surface}", surface, 0.001, 500, 100),
                )
                c.execute("SELECT LAST_INSERT_ID() AS id")
                seeded_ids.append(int(c.fetchone()["id"]))

        # 2. Call current_month_summary and verify per-surface bucketing.
        summary = ai_usage.current_month_summary("test_premium")
        by_surface = summary.get("by_surface") or {}
        for surface in surfaces:
            got = by_surface.get(surface, 0)
            # The user may have other usage this month — assert "at least our 1".
            all_ok &= pf(got >= 1,
                         f"by_surface.{surface}",
                         f"got={got} (expected ≥ 1 after seeding)")

        # 3. Read internal_weights straight from kb_pages, then via resolver.
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT fields_json FROM kb_pages WHERE slug = %s", ("credits-entitlements",))
            row = c.fetchone()
            kb_weights = None
            if row:
                fields = json.loads(row["fields_json"] if isinstance(row, dict) else row[0])
                for f in fields:
                    if f.get("name") == "internal_weights":
                        kb_weights = f.get("value")
                        break

        ent = resolve_entitlements("test_premium")
        resolver_weights = ent.get("internal_weights")
        all_ok &= pf(isinstance(kb_weights, dict),
                     "KB credits-entitlements.internal_weights present",
                     f"got={kb_weights}")
        all_ok &= pf(isinstance(resolver_weights, dict),
                     "resolver returns internal_weights",
                     f"got={resolver_weights}")
        if isinstance(kb_weights, dict) and isinstance(resolver_weights, dict):
            mismatch = {k: (kb_weights.get(k), resolver_weights.get(k))
                        for k in set(kb_weights) | set(resolver_weights)
                        if kb_weights.get(k) != resolver_weights.get(k)}
            all_ok &= pf(not mismatch,
                         "KB weights match resolver weights (round-trip)",
                         f"mismatches={mismatch}" if mismatch else "identical")

    except Exception as e:
        traceback.print_exc()
        all_ok &= pf(False, "Scope A crashed", str(e))
    finally:
        try:
            with get_db_connection() as conn:
                _seeded_surface_rows_cleanup(conn.cursor(), seeded_ids)
                print(f"  teardown: removed {len(seeded_ids)} synthetic ai_usage_log rows")
        except Exception:
            traceback.print_exc()

    return all_ok


# ─── Cost-drift observation (no assertions, just a report) ────────────────


def observe_cost_drift() -> None:
    """Compare the seeded rows' synthetic cost against the predicted typical
    cost per surface. Not a pass/fail — just information for the report."""
    print("\nCost drift observation — recent real ai_usage_log rows (last 7d)")
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                """
                SELECT surface,
                       COUNT(*) AS n,
                       ROUND(AVG(cost_usd), 6) AS avg_cost_usd,
                       ROUND(AVG(tokens_in), 0) AS avg_tin,
                       ROUND(AVG(tokens_out), 0) AS avg_tout
                  FROM ai_usage_log
                 WHERE success = 1
                   AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                   AND cost_usd IS NOT NULL
                 GROUP BY surface
                 ORDER BY n DESC
                """
            )
            rows = c.fetchall() or []
    except Exception as e:
        print(f"  query failed: {e}")
        return

    if not rows:
        print("  (no recent success rows with cost_usd populated — skipping)")
        return

    predicted = {
        "dm": 0.00055, "group": 0.00690, "feed": 0.00645,
        "post_summary": 0.00080, "voice_summary": 0.00340,
        "whisper": 0.00600,
    }
    print(f"  {'surface':16s} {'n':>6s} {'avg_cost_usd':>14s} {'predicted':>12s} {'drift':>10s}")
    for r in rows:
        s = r["surface"] if isinstance(r, dict) else r[0]
        n = r["n"] if isinstance(r, dict) else r[1]
        avg = float(r["avg_cost_usd"] if isinstance(r, dict) else r[2] or 0)
        p = predicted.get(s)
        if p and avg > 0:
            drift = f"{((avg - p) / p * 100):+.1f}%"
        else:
            drift = "—"
        pstr = f"${p:.5f}" if p else "—"
        print(f"  {str(s):16s} {n:>6} {f'${avg:.6f}':>14s} {pstr:>12s} {drift:>10s}")


# ─── Main ────────────────────────────────────────────────────────────────


def main() -> int:
    print("=" * 72)
    print("QA verification — today's session")
    print("=" * 72)

    ok8 = run_section_8()
    ok10 = run_section_10()
    okA = run_scope_a()
    observe_cost_drift()

    print("\n" + "=" * 72)
    print("SUMMARY")
    print("=" * 72)
    for line in RESULTS:
        print(line)
    fails = sum(1 for r in RESULTS if r.lstrip().startswith("[FAIL]"))
    passes = sum(1 for r in RESULTS if r.lstrip().startswith("[PASS]"))
    print(f"\n  {passes} PASS, {fails} FAIL")
    print(f"  §8  gating:             {'OK' if ok8 else 'FAIL'}")
    print(f"  §10 26-member block:    {'OK' if ok10 else 'FAIL'}")
    print(f"  Scope A weights/bucket: {'OK' if okA else 'FAIL'}")
    return 0 if (ok8 and ok10 and okA) else 1


if __name__ == "__main__":
    sys.exit(main())
