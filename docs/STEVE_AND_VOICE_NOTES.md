# Steve & Voice Notes — Architecture Guide

**Status:** Required reading before you build or touch anything Steve- or
voice-note related. Last updated 2026-04-19.

This document is the single source of truth for how Steve (the LLM
assistant) and Whisper (audio transcription) are wired into C-Point. If
you are adding a new Steve surface, a new voice-note entry point, or a
new AI feature of any kind, **you must bootstrap it on top of the
services described here**. Rolling your own OpenAI / xAI call without
going through these services breaks billing, entitlements, the Manage
Membership modal, and the admin analytics — all of which are business-
critical.

If anything here is unclear or doesn't match reality, fix the doc first
and then write the code. Do **not** silently diverge.

---

## TL;DR for agents

1. **Never call OpenAI / xAI / Whisper directly.** Route through the
   wrappers below. They handle gating, duration probing, logging, and
   cost attribution so you don't have to.
2. **Every successful AI call must write exactly one row to
   `ai_usage_log`** via `backend.services.ai_usage.log_usage(...)` with a
   `surface` from `ALL_SURFACES`.
3. **Every blocked AI call must write a `success=0` row** via
   `ai_usage.log_block(...)` — this is what powers the "limit reached"
   analytics and the retention loops.
4. **Whisper is one call, voice-summary is two calls.** If you transcribe
   an audio clip *and* summarise the transcript, log two rows: one
   `surface='whisper'` with `duration_seconds`, and one
   `surface='voice_summary'`.
5. **Gate before you spend.** Run the entitlements gate *before* calling
   the paid API, not after. `entitlements_gate.check_steve_access(...)`
   / the `require_steve_access` decorator are the only sanctioned gates.

Skip any of the above and the user's "Steve uses this month" counter
will silently lie to them. We've already fixed that bug once, don't
reintroduce it.

---

## The service map

```
┌──────────────────────────────────────────────────────────────────┐
│                  Client (web / iOS / Android)                    │
└────────────────────┬──────────────────────────┬──────────────────┘
                     │                          │
        Steve/text   │                          │   Voice note
                     ▼                          ▼
   ┌───────────────────────────┐   ┌───────────────────────────────┐
   │ Blueprint / monolith view │   │  monolith: /send_audio_*      │
   │   (DM, group, feed)       │   │  /post_status (audio),        │
   │                           │   │  group_chat.send_group_message│
   └────────┬──────────────────┘   └───────────────┬───────────────┘
            │                                      │
            ▼                                      ▼
   ┌──────────────────────┐           ┌──────────────────────────────┐
   │ entitlements_gate    │           │ process_audio_for_summary    │
   │ .check_steve_access  │           │  (bodybuilding_app.py)       │
   │ / require_steve_…    │           │   • transcribe_audio_file    │
   └──────┬──────┬────────┘           │   • log whisper usage        │
          │      │                    │   • summarize_text           │
          │      │                    │   • log voice_summary usage  │
          │      │                    └──────────────┬───────────────┘
          │      │                                   │
          │      ▼                                   ▼
          │   ┌───────────────────────┐    ┌──────────────────────┐
          │   │ ai_usage.log_usage /  │◄───┤ ai_usage.log_usage   │
          │   │          .log_block   │    │ (surface=whisper +   │
          │   │                       │    │  surface=voice_…)    │
          │   └──────────┬────────────┘    └──────────────────────┘
          │              │
          │              ▼
          │    ┌─────────────────────────┐
          │    │    ai_usage_log table   │
          │    └─────────────────────────┘
          │
          ▼
   ┌───────────────────────┐
   │ entitlements.resolve_ │   ← pulls caps from KB and overlays
   │ entitlements(user)    │     Enterprise seat / Special / tier
   └───────────────────────┘
```

---

## The five services you must know about

| Module | Purpose | Never… |
|---|---|---|
| `backend.services.ai_usage` | Read/write the `ai_usage_log` table. Counters for daily / monthly / per-surface / whisper minutes. | Write raw `INSERT INTO ai_usage_log` SQL anywhere else. |
| `backend.services.entitlements` | Resolve a user's caps (tier × KB × Enterprise seat × Special flag). | Hard-code caps in a blueprint — pull them from the KB via this module. |
| `backend.services.entitlements_gate` | Decide "can `user` call Steve on `surface` right now?". Writes `log_block` rows on denial. | Roll your own `if is_premium: …` check. |
| `backend.services.entitlements_errors` | Canonical JSON error shape + reason enum + copy. The UI's `LimitReachedModal` / inline bubble depend on this contract. | Return ad-hoc 429/403 payloads. |
| `backend.services.whisper_service` | Reference implementation for gated + logged transcription (used by `/api/summaries/voice/preflight` and any new blueprint). | Call `openai.audio.transcriptions.create` directly. |

---

## Surface vocabulary

Defined in `ai_usage.py`. Pick one when you write a row — choosing the
wrong surface is how counters desync.

| Constant | When to use |
|---|---|
| `SURFACE_DM` | Steve replying in a 1:1 DM thread |
| `SURFACE_GROUP` | Steve replying in a group chat |
| `SURFACE_FEED` | Steve replying in a feed / post-thread context |
| `SURFACE_POST_SUMMARY` | GPT summary of a thread / long post |
| `SURFACE_VOICE_SUMMARY` | GPT summary of a transcribed voice note |
| `SURFACE_WHISPER` | Audio transcription (the Whisper API call itself). **Always** log `duration_seconds`. |
| `SURFACE_CONTENT_GEN` | Community-pool content generation. Not counted in `STEVE_SURFACES`. |

`STEVE_SURFACES = (DM, GROUP, FEED, POST_SUMMARY, VOICE_SUMMARY)` — this
set is what counts against `steve_uses_per_month` and `ai_daily_limit`.

**Steve DM pipeline (`run_steve_dm_reply`).** `gate_or_reason(..., SURFACE_DM)` runs **before**
feedback capture, Reminder Vault, platform digest, or Grok. Without `can_use_steve`,
the user receives only a markdown **subscription CTA** pointing at **`/account_settings/membership`**
(via canonical `PUBLIC_BASE_URL` hostname).

**Platform activity digest.** DM flow: `message_looks_like_platform_digest_intent` filters candidates, then an optional Grok classifier confirms intent and adjusts the window hours. **`build_platform_activity_digest`** aggregates **SQL-only facts**: recent posts **with author names** (`users` join), content, optional `image_path`, and **recent group transcript lines** from other members only — viewer excluded. **`_grok_compose_digest_from_facts`** summarizes those facts **without inventing** users or links; markdown uses **path-only** links **`[Open feed](/community_feed_react/{id})`** / **`[Open chat](/group_chat/{id})`** so any app origin resolves in-app (`SmartLink` + `PUBLIC_BASE_URL` for ancillary uses). Validator keeps every `feed_path` / `chat_path` verbatim; fallback body is deterministic. **`log_usage`**: exactly **one row** per delivered digest DM (`surface=SURFACE_DM`, `request_type='platform_activity_digest'`; **`model`** includes Grok digest + intent tokens summed, **`n/a`** only if no upstream LLM). The read-only helper `GET /api/me/platform-activity-digest` returns JSON only — **does not** log usage.

---

## How to add a new Steve surface (checklist)

1. **Pick a surface.** Reuse an existing one if the UX maps cleanly;
   otherwise add a new `SURFACE_*` constant in `ai_usage.py`, add it to
   `ALL_SURFACES`, and decide whether it belongs in `STEVE_SURFACES`.
2. **Gate the entry point.**
   - Flask route: decorate with `@require_steve_access("your_surface")`.
   - Internal helper (e.g. monolith background task):
     ```python
     from backend.services.entitlements_gate import gate_or_reason
     allowed, reason, ent = gate_or_reason(username, "your_surface")
     if not allowed:
         return  # log_block already written
     ```
3. **Respect the caps in `ent`.** Plumb `ent["max_output_tokens_*"]`,
   `ent["max_context_messages"]`, `ent["max_images_per_turn"]`,
   `ent["max_tool_invocations_per_turn"]` into your LLM call.
4. **Log on success.** Exactly one row per upstream API call:
   ```python
   from backend.services import ai_usage
   ai_usage.log_usage(
       username,
       surface=ai_usage.SURFACE_<YOUR>,
       request_type="steve_<specific_label>",
       tokens_in=usage.prompt_tokens,
       tokens_out=usage.completion_tokens,
       cost_usd=computed_cost,
       community_id=community_id_or_None,
       model="grok-4-1-fast-reasoning",
       response_time_ms=int((t1 - t0) * 1000),
   )
   ```
5. **Log on failure.** Use `ai_usage.log_usage(..., success=False,
   reason_blocked="api_error")` for upstream errors so we can spot
   regressions in the admin dashboard.

---

## How to add a new voice-note entry point (checklist)

Three rules:

1. **Never** call `openai.audio.transcriptions.create` directly.
2. **Never** call `transcribe_audio_file` directly from a view unless
   you are inside `process_audio_for_summary` (which is the logged
   pipeline). If your flow only needs transcription with no summary,
   call `backend.services.whisper_service.transcribe(...)` — it gates
   and logs.
3. Always pass the client-provided `duration_seconds` when you have
   one. Otherwise the pipeline will probe the file or fall back to
   estimating from word count, which is less accurate and won't match
   what Stripe / the store sees.

### Canonical recipe (audio that needs summarisation)

```python
# inside your blueprint / view
from bodybuilding_app import process_audio_for_summary

audio_summary = process_audio_for_summary(
    stored_path,                       # local path or R2 CDN URL
    username=username,                 # required for accounting
    duration_seconds=duration_seconds, # client-provided if available
    community_id=community_id,         # optional, for pool accounting
)
```

`process_audio_for_summary` writes **two** rows:

- `surface='whisper'`, `duration_seconds=N`, `cost_usd=…` → counts
  against `whisper_minutes_per_month`.
- `surface='voice_summary'` → counts against `steve_uses_per_month` and
  `ai_daily_limit`.

### Canonical recipe (transcription only, no summary)

```python
from backend.services.whisper_service import transcribe
from backend.services import ai_usage

allowed, data = transcribe(
    username,
    stored_path,
    surface=ai_usage.SURFACE_WHISPER,   # not VOICE_SUMMARY — no GPT leg
    community_id=community_id,
)
if not allowed:
    return jsonify(data), data["http_status"]
text = data["text"]
```

---

## Counters and what each one means

Defined in `backend/services/ai_usage.py`. The Manage Membership modal,
the enforcement gate, and the admin dashboards all read through these —
don't build parallel queries.

| Function | Window | Surface filter | Used for |
|---|---|---|---|
| `monthly_steve_count` | 1st of month UTC → now | `STEVE_SURFACES` | `steve_uses_per_month` cap + "Steve uses this month" UI |
| `daily_count` | Rolling 24h | `STEVE_SURFACES` | `ai_daily_limit` enforcement + "Steve uses today" UI |
| `daily_any_count` | Rolling 24h | *none* | Admin-only "all AI activity" metric |
| `whisper_minutes_this_month` | 1st of month UTC → now | `whisper` only, sums `duration_seconds/60` | `whisper_minutes_per_month` cap + "Voice transcription this month" UI |
| `current_month_summary` | 1st of month UTC → now | grouped by surface | Manage Membership AI Usage tab, admin Manage drawer |

**Invariant:** `daily_count(u) ≤ monthly_steve_count(u)` for any user
`u`. If you change one counter's filter you MUST keep this invariant.
We had a live bug because `daily_count` was unscoped and
`monthly_steve_count` was — don't repeat it.

---

## Entitlements: where caps actually live

- Caps live in the Knowledge Base, page `credits-entitlements`. The
  admin-web Knowledge tab is the source of truth — editing the KB in
  production changes behaviour on next request.
- `entitlements.resolve_entitlements(username)` does the overlay:
  tier defaults → KB values → Special override → Enterprise seat
  override → per-request context.
- A user with an active Enterprise seat is bumped to `tier=premium`
  with `inherited_from="enterprise:<slug>"`. Don't duplicate that logic
  elsewhere — call `resolve_entitlements` and read `ent["tier"]`.

### Caps that matter to you

| Key | What it gates |
|---|---|
| `can_use_steve` | Simple allow/deny. Free users are False. |
| `steve_uses_per_month` | Monthly Steve call cap. `None` = unlimited (Special). |
| `whisper_minutes_per_month` | Audio minutes. `None` = unlimited. |
| `ai_daily_limit` | Rolling 24h Steve calls. |
| `max_output_tokens_dm` / `_group` / `_feed` | Plumb into the LLM `max_output_tokens` call param. |
| `max_context_messages` | Clamp the history you pass to the model. |
| `max_images_per_turn` | Drop images past this count before the call. |
| `max_tool_invocations_per_turn` | Cap tool calls per turn (web / X). |
| `monthly_spend_ceiling_eur` | Soft-budget for the user, informational. |

---

## Client contract

The Manage Membership modal (`client/src/components/membership/ManageMembershipModal.tsx`)
and `useEntitlements` hook expect these shapes:

- `GET /api/me/entitlements` → `{ entitlements, usage, enforcement_enabled }`
- `GET /api/me/ai-usage` → adds `month_summary` + `internal_weights`
- Any block response follows `entitlements_errors.build_error(...)`:
  ```json
  {
    "success": false,
    "reason": "monthly_steve_cap",
    "message": "…",
    "cta": { "label": "…", "action": "open_membership_modal", "tab": "plan" },
    "usage": { … }
  }
  ```

If you add a new reason code, add it to
`backend/services/entitlements_errors.py` **and** wire the copy/CTA in
the KB (`policies` page) — otherwise the frontend falls back to a
generic "limit reached" bubble which is a degraded UX.

---

## Common mistakes we've already made (do not repeat)

1. **Calling OpenAI Whisper directly from a monolith route without
   logging.** This is the bug that made "Voice transcription this month"
   show 0 even after the user sent audios. Fix: route through
   `process_audio_for_summary` (which now logs) or
   `whisper_service.transcribe`.
2. **Using mismatched surface filters between `daily_count` and
   `monthly_steve_count`.** Produced monthly < daily. Both now scope to
   `STEVE_SURFACES`; keep them aligned.
3. **Hard-coding caps.** Any hard-coded number will drift from the KB.
   Pull from `resolve_entitlements`.
4. **Logging one row for a two-call pipeline.** A voice-note summary =
   one Whisper call + one GPT call = two rows.
5. **Returning 429/403 with ad-hoc JSON.** The client can't parse it,
   the modal can't open, the user sees a generic error. Use
   `entitlements_errors.build_error`.

---

## Backfill notes

Pre-Wave-4 rows in `ai_usage_log` have `surface IS NULL`. They are
ignored by the new counters (correct: we don't know what they were).
If you want them to appear in historical analytics, run a one-off
heuristic migration against `request_type`:

```sql
UPDATE ai_usage_log SET surface='dm'   WHERE surface IS NULL AND request_type LIKE 'steve_dm%';
UPDATE ai_usage_log SET surface='group' WHERE surface IS NULL AND request_type LIKE 'steve_group%';
UPDATE ai_usage_log SET surface='feed'  WHERE surface IS NULL AND request_type LIKE 'steve_%reply';
```

Don't run this automatically on boot — the monolith boots on every
Cloud Run instance. Make it a manual, audited migration.

---

## Verification

Every service documented above has a row on the **KB → Audit → Tests**
page. When you change one of these services, flip the matching row to
`not_run` until you've re-verified — automated and manual alike.

| Service / behaviour | Tests-page row id | Runner |
|---|---|---|
| `ai_usage.log_usage` one-row-per-call, correct surface | `ai_usage:log_usage_writes_row` | automated (`tests/test_ai_usage_counters.py`) |
| `whisper_minutes_this_month` sums `duration_seconds/60` | `ai_usage:whisper_minutes` | automated |
| `daily_count` scope matches `monthly_steve_count` (invariant) | `ai_usage:daily_vs_monthly` | automated |
| Blocked rows excluded from counters | `ai_usage:blocked_rows_excluded` | automated |
| `current_month_summary` grouped totals are consistent | `ai_usage:summary_consistency` | automated |
| `entitlements.resolve_entitlements` tier resolution | `entitlements:tier_resolution` | automated (`tests/test_entitlements_resolve.py`) |
| Enterprise seat bumps tier to premium with inherited_from | `entitlements:enterprise_seat` | automated |
| KB-driven caps overlay correctly | `entitlements:kb_driven_config` | automated |
| Special override + unknown/anonymous invariants | `entitlements:invariants` | automated |
| `entitlements_gate` returns canonical `entitlements_errors` shape | `entitlements:error_shape` | automated + manual §8 |
| Voice-note pipeline logs both whisper and voice_summary rows | `manual:voice_note_double_log` | manual §3 |
| Manage Membership modal surfaces the counters | `manual:manage_membership_usage` | manual §4, §9 |

If you add a new AI surface, add a corresponding row on the Tests page
**before** the code lands. CI will remind you if you don't — the
product-roadmap rollup pill goes yellow for rows without a `test` ref.

---

## Where the tests live (and what to add)

There is no dedicated test suite for this pipeline yet. When you touch
any of the services above, add at minimum:

- A unit test that `log_usage` writes one row per call.
- A test that `monthly_steve_count >= daily_count` for a fixture user.
- An integration test that a gated Flask route returns the canonical
  `entitlements_errors` shape when the user is over cap.

If you can't run the full stack locally, write the test anyway — it
will get picked up in CI and is cheaper than re-debugging a production
counter mismatch.
