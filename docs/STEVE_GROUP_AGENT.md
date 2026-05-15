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

1. **Welcome post:** When a group is created with **Steve agent enabled** (v1: Career Expert), a **static** opening post from **@Steve** is inserted on the group feed (`group_posts`) introducing the agent role. No LLM call, no `ask_steve` schedule, and no member notification fan-out for that row (members see it when they open the feed). Response may include `welcome_group_post_id`.
2. **Delayed first reply:** Random **15–120 minutes** (triangular skew toward ~30 min); stored in **`group_steve_agent_schedule`**; processed by [`POST /api/cron/group-steve-agent-due`](bodybuilding_app.py) (`X-Cron-Secret`).
3. **`@Steve`:** Cancels pending schedule for that post; immediate reply path; does **not** consume the 5-slot auto budget.
4. **Auto budget:** **Five** Steve replies per post that count toward automation (`auto_steve_used_count` on `group_posts`). After the 5th, a **static** cap notice is inserted (no extra LLM call).
5. **Reply to Steve:** If a member replies **directly** to Steve’s comment **without** `@Steve`, server may trigger an auto continuation (same budget rules) via background thread.

## Output

- **Career Expert** preset: `max_output_tokens` capped at **2000**, combined with `min(entitlements, KB/package caps)` in [`_steve_ai_reply_for_group_post`](bodybuilding_app.py).

## Context (LLM)

- **Group-scoped resources (exclusive group feed):** `_steve_ai_reply_for_group_post` loads this group's materials via `_build_steve_group_resource_context`: **group** `calendar_events`, `useful_links`, `useful_docs` (PDF excerpts via the same extraction path as community Steve), and active **group** polls (`group_polls` / `group_poll_options`), all `WHERE group_id = <exclusive groups.id>`. Limits follow the same Steve package budget knobs as community context (events/links/docs/polls caps, doc excerpt budget). **Parent-community** calendar, community-wide links/docs/polls, and `steve_community_memory` are **not** included via `_build_steve_community_context` (that builder is not used for `is_group_post` / group-feed paths).
- **Group chat Steve is different:** `group_chats`-driven replies (`backend/blueprints/group_chat.py`, `SURFACE_GROUP` on that surface) do **not** automatically receive this exclusive-group resource bundle unless product adds an explicit mapping from chat to `groups.id` / resources — do not assume parity with the **group feed** path above.
- **Community main-feed @Steve** is unchanged: may still attach community resource context when the message asks for documents/events/links/polls per prompt policy.

## Proactive

- **`steve_proactive_enabled`**: column reserved; behaviour in later iteration.

## Cron setup

- Add Cloud Scheduler job: `POST /api/cron/group-steve-agent-due` with `X-Cron-Secret` (see [`cloud-scheduler-cron.md`](cloud-scheduler-cron.md)) every 1–5 minutes for timely delayed replies.

## Related docs

- Data: [`MYSQL_AND_FIRESTORE.md`](MYSQL_AND_FIRESTORE.md)  
- Journeys: [`PRODUCT_JOURNEYS.md`](PRODUCT_JOURNEYS.md)
