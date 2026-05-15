# Steve group agent (exclusive groups)

**Status:** Implemented in code (v1: Career Expert / Coach).  
**Scope:** Exclusive **group feed** (`group_posts` / `group_replies`). Not DM. Distinct from **`group_chats.steve_personality`**.

**Invariants:** [`STEVE_AND_VOICE_NOTES.md`](STEVE_AND_VOICE_NOTES.md) — gate with `entitlements_gate`, `log_usage` / `log_block`, no direct vendor APIs.

---

## Commercial rule

- **`steve_agent_enabled`** on a group requires an **active Steve Community Package** on the **billing root** for that group’s `community_id` (`community_billing.has_active_steve_package` after `resolve_root_community_id`).
- **Consumption:** Same pool and attribution as existing group @Steve: `check_steve_access(..., SURFACE_GROUP, community_id=...)`, `log_usage` with billing root `community_id` when the community pool applies.
- **No separate agent ledger.**

---

## Owner configuration

- **Group create** ([`POST /api/groups/create`](bodybuilding_app.py)): optional `steve_agent_enabled`, `steve_agent_preset` (`career_expert`), `steve_proactive_enabled` (reserved).
- **Update** ([`PATCH /api/groups/<id>/steve_agent`](bodybuilding_app.py)): same fields; managers only; package check when enabling.

## Member: Ask Steve on post

- Composer sends `ask_steve=1` on [`POST /api/group_posts`](bodybuilding_app.py).
- **Minimum text length** (no media): `MIN_ASK_STEVE_CHARS` in [`backend/services/group_steve_agent.py`](backend/services/group_steve_agent.py) (default 80). Longer-only avoids empty agent noise.

## Automation behaviour

1. **Delayed first reply:** Random **15–120 minutes** (triangular skew toward ~30 min); stored in **`group_steve_agent_schedule`**; processed by [`POST /api/cron/group-steve-agent-due`](bodybuilding_app.py) (`X-Cron-Secret`).
2. **`@Steve`:** Cancels pending schedule for that post; immediate reply path; does **not** consume the 5-slot auto budget.
3. **Auto budget:** **Five** Steve replies per post that count toward automation (`auto_steve_used_count` on `group_posts`). After the 5th, a **static** cap notice is inserted (no extra LLM call).
4. **Reply to Steve:** If a member replies **directly** to Steve’s comment **without** `@Steve`, server may trigger an auto continuation (same budget rules) via background thread.

## Output

- **Career Expert** preset: `max_output_tokens` capped at **2000**, combined with `min(entitlements, KB/package caps)` in [`_steve_ai_reply_for_group_post`](bodybuilding_app.py).

## Context (LLM)

- **Thread-only for resources:** Group Steve does **not** inject parent-community calendar, links, document excerpts, or polls via `_build_steve_community_context`. Answers use the **group thread** (and media), entitlements/KB policy, gated **mention profiles**, and tools when enabled.
- **Community main-feed @Steve** is unchanged: may still attach community resource context when the message asks for documents/events/links/polls per prompt policy.

## Proactive

- **`steve_proactive_enabled`**: column reserved; behaviour in later iteration.

## Cron setup

- Add Cloud Scheduler job: `POST /api/cron/group-steve-agent-due` with `X-Cron-Secret` (see [`cloud-scheduler-cron.md`](cloud-scheduler-cron.md)) every 1–5 minutes for timely delayed replies.

## Related docs

- Data: [`MYSQL_AND_FIRESTORE.md`](MYSQL_AND_FIRESTORE.md)  
- Journeys: [`PRODUCT_JOURNEYS.md`](PRODUCT_JOURNEYS.md)
