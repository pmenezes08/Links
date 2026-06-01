# Steve & Voice Notes — Architecture Guide

**Status:** Required reading before you build or touch anything Steve- or
voice-note related. Last updated 2026-05-15.

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
   When Steve runs in an **in-community** context (feed replies, group chats
   tied to a community), pass **`community_id`** into `check_steve_access` /
   `gate_or_reason` so eligible members can consume the **Steve Community
   Package** monthly pool per KB flags (`community-tiers` page).
   **Feed / DM / group @Steve** attach Grok **`web_search`** by default (and **`x_search`** only when the user explicitly asks for X/Twitter) via **`steve_tool_router.resolve_steve_hosted_tools`**: **hard exclusions only** — platform-manual-only turns, professional-advice-only turns, profile-suppressed cohorts (same gate as **`steve_tool_policy.steve_external_tool_suppressed_for_profile_intent`**), or KB kill-switches (**`paid_steve_package_feed_attach_*`**). The model decides whether to **invoke** search (`tool_choice=auto`); xAI bills hosted search on invocation, not attachment. **`tools_flags_from_response`** drives **`ai_usage`** **`tools_web_search` / `tools_x_search`** flags (not the attached tool list). **`render_steve_external_knowledge_guidance`** in **`steve_prompt_policy`** tells Steve when to search silently and how to disclose honestly when it did not — without jargon ("web lookup", "this turn", "hosted tools"). **Multilingual intent (EN / PT-PT / ES):** the live-search, news/current-events, employer-research, X-search, and web-confirm phrase matchers in **`steve_tool_policy`** plus **`steve_prompt_policy._NEWS_TOPIC_HINT`** recognise English, European Portuguese, and Spanish wording (e.g. *pesquisa na internet*, *últimas notícias*, *vagas de emprego*, *busca en internet*, *noticias de hoy*, *vacantes en …*); **`normalize_message_for_live_search_signals`** now folds diacritics so accented input matches the ASCII tokens, the router gate **`steve_tool_router._AMBIGUOUS_HINT`** carries the same PT/ES hints, and the **`steve_tool_router`** classifier system prompt is language-agnostic. Profile-only asks (*fala-me sobre @user*, *cuéntame sobre @user*) stay suppressed unless the same turn also carries a live/news/job signal. Emergency rollback: **`STEVE_LEGACY_TOOL_GATING=1`** restores regex pre-gate + optional JSON-only router hop (logged as **`steve_tool_router`**). **`STEVE_TOOL_ROUTER_DISABLED`** applies only in legacy mode. **`detect_platform_manual_intent`** strips **`@Steve`** mentions so addressing Steve does not force a platform-manual turn or strip tools. Platform-only and professional-advice-only turns omit tools. **THIRD-PARTY JOBS / EMPLOYERS** rules in **`steve_prompt_policy`** require verifiable external postings (no fabricated listings). **@Mentioned** users on feed/group may receive gated profile context when **`user_can_access_steve_kb`** allows.
   **News and current-events** replies use **`steve_prompt_policy` `news_current_events`** mode: structured sections (Key developments, Why it matters), substantive bullets, reputable-source guidance; **bare https URLs on separate lines at the end** for link-preview cards (no inline `[Headline](url)` or ## Sources in the body). **`format_steve_response_links`** strips legacy inline markdown and normalises URLs to that tail format.
   **DM / group vision:** **`steve_chat_images.select_image_urls_for_turn`** parses reply-target photos from the client `[REPLY:…:📷|url|caption]` prefix and attaches **only that image** when the user asks about "this photo" / *esta foto*. Without a reply quote, "this photo" intent uses the **most recent** thread image; general compare/vision requests may still attach up to **`max_images_per_turn`**. Relative `/uploads/…` paths are normalised to absolute URLs before the Grok call.

Skip any of the above and the user's "Steve uses this month" counter
will silently lie to them. We've already fixed that bug once, don't
reintroduce it.

### Document memory (Steve resource context)

Uploaded PDFs are indexed by **`backend/services/steve_document_memory.py`** after the `useful_docs`
row commits in `/upload_doc`, and existing rows can be backfilled with
**`scripts/backfill_steve_document_memory.py`**. Firestore
**`steve_doc_memory/{community:id|group:id}/docs/{doc_id}/chunks/{chunk_id}`** stores extraction
status, summaries/outlines, page chunks, token estimates, and optional embeddings. Steve's resource
context (calendar + links + documents + polls) is assembled by
**`backend/services/steve_resource_context.py`**, which injects a compact manifest, an index-time
**document dossier** (`summary_short` + outline from Firestore, no extra LLM), and retrieved page
chunks within a shared character budget when the current thread, parent/original post, recent replies,
or recent upload state makes a document ask active. The legacy on-the-fly PDF text fallback fires when
Firestore memory has no readable dossier or chunks for that scope (manifest-only pending rows still
fall back to PDF extract). Default doc excerpt budget is KB **`paid_steve_package_doc_excerpt_chars_default`**
(4000 chars). Large PDFs are never injected wholesale; group docs use
`group:{id}` memory only and are not visible from the parent community feed. Activation is gated by
**`steve_prompt_policy.should_include_community_resources_from_thread`**, which uses a real MySQL
``scope_has_useful_docs`` check (not a hardcoded flag) plus broad plural/PT resource phrases
(``documents``, ``read them``, ``documento``, ``ler``, …). The system prompt claims document access
only when the assembled context includes a **Community documents** or **Group documents** block.

### Thread context (feed / group @Steve replies)

Comment-thread assembly for **`/api/ai/steve_reply`** and group @Steve lives in
**`backend/services/steve_feed_thread_context.py`**. Steve receives the **original post plus the most
recent N comments** on that post (tail of the thread, not the oldest N). Limits come from KB
**`paid_steve_package_recent_comments_limit`** (default 24) and optional
**`paid_steve_package_thread_chars_max`** (default 12000); when over budget, oldest numbered comments
drop first while keeping at least the three newest. Each comment is numbered; replies show
``↳ reply to #k`` when ``parent_reply_id`` is in the fetched window. Steve's own earlier lines are
marked **`[Steve — your prior reply]`**; **`steve_prompt_policy.render_thread_grounding_appendix`**
instructs the model to stay multilingual and consistent with those lines. Pre-LLM doc/resource gates
remain separate from reply language.

---

## Exclusive group Steve agent (group feed)

Preset **agents** on **`group_posts` / `group_replies`**: owners enable on **group create** (requires **Steve Community Package** on the billing root); members use **Ask Steve** on a post; optional **delayed** first reply via cron (**`/api/cron/group-steve-agent-due`**); **`@Steve`** cancels the pending job; **five** auto-budget replies per post then **static** cap notice; **`@Steve`** continues without consuming that budget. Same **`check_steve_access`** / **`log_usage`** / **`SURFACE_GROUP`** pool rules as other group Steve.

**Spec and ops:** [`STEVE_GROUP_AGENT.md`](STEVE_GROUP_AGENT.md).

---

## Onboarding profile helpers (non-Steve)

**[`backend/services/onboarding_llm.py`](backend/services/onboarding_llm.py)** runs **chat.completions** for onboarding routes with **xAI** first (`grok-4.3` primary) and **OpenAI `gpt-4o`** as fallback when **`OPENAI_API_KEY`** is set and the primary call fails. Log with **`surface=onboarding_ai`** and the **`model`** column set to the provider model id that succeeded. **Company intel** ([`onboarding_company_intel.fetch_company_intel_blurb`](backend/services/onboarding_company_intel.py)) uses **xAI** **Responses** + **`web_search`** first, then **OpenAI** **Responses** + **`web_search`** when xAI is missing or returns no usable blurb; optional model id via **`ONBOARDING_OPENAI_COMPANY_INTEL_MODEL`** (default **`gpt-5.5`**). Usage rows use the winning provider’s **`model`** id.

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
| `SURFACE_ONBOARDING_AI` | Onboarding helpers (e.g. `onboarding_compose_bio`, **`onboarding_parse_cv`**) — logs to `ai_usage_log` but **does not** increment `monthly_steve_count` / personal Steve caps (see `STEVE_SURFACES` in `ai_usage.py`). Uses xAI like other onboarding Grok calls; **no** separate `require_steve_access` gate today. |

`STEVE_SURFACES = (DM, GROUP, FEED, POST_SUMMARY, VOICE_SUMMARY)` — this
set is what counts against `steve_uses_per_month` and `ai_daily_limit`.
(Onboarding AI is intentionally **out of** this set.)

**Steve DM pipeline (`run_steve_dm_reply`).** `gate_or_reason(..., SURFACE_DM)` runs **before**
feedback capture, Reminder Vault, platform digest, or Grok. Without `can_use_steve`,
the user receives only a markdown **subscription CTA** pointing at **`/account_settings/membership`**
(via canonical `PUBLIC_BASE_URL` hostname).

**Platform activity digest.** DM flow: `message_looks_like_platform_digest_intent` filters candidates, then an optional Grok classifier confirms intent and adjusts the window hours. **`build_platform_activity_digest`** aggregates **SQL-only facts**: recent posts **with author names** (`users` join), content, optional `image_path`, **exact counts** (`post_count_others` / `message_count_others`), and **recent group transcript lines** from other members only — viewer excluded. **`_grok_compose_digest_from_facts`** must follow a **fixed section layout** per community/group: **`Activity:`** with one line per count from JSON, **`Last activity:`** when present, a single **`Summary:`** paragraph (themes only; no per-message bullets), then **one** path-only link **`[Open feed](/community_feed_react/{id})`** / **`[Open chat](/group_chat/{id})`**. Do not invent users, counts, or paths. **`_fallback_deterministic_digest_body`** mirrors that structure (short stub summaries instead of Grok prose). Validator requires every `feed_path` / `chat_path` verbatim in the final markdown. **Client:** `SmartLink` treats **`href` that starts with `/`** like **@mention → profile**: **`navigate(path)`** inside the SPA; it does **not** use `window.open` for those paths (invite tokens on `/invite/…` still go through join-then-navigate). `PUBLIC_BASE_URL` remains for full URLs / ancillary HTTPS links outside digest bodies. **`log_usage`**: exactly **one row** per delivered digest DM (`surface=SURFACE_DM`, `request_type='platform_activity_digest'`; **`model`** includes Grok digest + intent tokens summed, **`n/a`** only if no upstream LLM). The read-only helper `GET /api/me/platform-activity-digest` returns JSON only — **does not** log usage.

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
   `ent["max_context_messages"]`, `ent["max_context_messages_peer_dm"]`,
   `ent["max_images_per_turn"]`,
   `ent["max_tool_invocations_per_turn"]` into your LLM call. For
   community-pool feed calls, use the stricter of the user's resolved
   feed cap and the KB-backed Steve Community Package output cap.
   Shared helpers live in `backend.services.steve_model_config`.
4. **Use the shared prompt policy.** Add
   `backend.services.steve_prompt_policy.append_response_policy(...)`
   to interactive Steve prompts. Casual replies stay short; substantive
   answers use Markdown headings and bullets (`Short Answer`, `Analysis`,
   `Recommendation`, `Pitfalls`, `Next Steps`) and instruct the model to
   reason internally without exposing hidden chain-of-thought.
5. **Log on success.** Exactly one row per upstream API call:
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
       model="grok-4.3",
       response_time_ms=int((t1 - t0) * 1000),
   )
   ```
6. **Log on failure.** Use `ai_usage.log_usage(..., success=False,
   reason_blocked="api_error")` for upstream errors so we can spot
   regressions in the admin dashboard.

**Pricing source:** Steve token-cost math must come from official xAI
documentation only. For Grok 4.3, `steve_model_config` defaults to
input `$1.25 / 1M`, cached input `$0.20 / 1M`, output `$2.50 / 1M`,
and xAI server-side tool invocations `$5 / 1k` calls. KB fields mirror
those values so operators can re-verify and update without code drift.

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

Manual translation via `POST /translate_summary` uses the same gate and
logs one Steve row: `surface='voice_summary'` for voice-note summaries,
`surface='translation'` for public-profile section translation. Both count
against `steve_uses_per_month` when enforcement is on.

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
| `monthly_steve_count` | 1st of month UTC → now | `STEVE_SURFACES` | `steve_uses_per_month` cap + "Steve uses this month" UI (SUM of `credits_debited` when `STEVE_WEIGHTED_CREDITS_ENABLED` is on). KB tiers: standard through **25k** billed input tokens; **web_search** addon **0.5** when the model **invoked** search on that turn (not merely when tools were attached). |
| `daily_count` | Rolling 24h | `STEVE_SURFACES` | `ai_daily_limit` enforcement + "Steve uses today" UI (same weighted SUM) |
| `community_monthly_steve_pool_usage` | Calendar month | `STEVE_SURFACES` + `community_id` | Steve Community Package pool (200 credits default); dual gate with `monthly_community_spend_usd` vs KB `$19.99` ceiling |
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
| `max_context_messages` | Clamp the history you pass to the model (direct DM + group). |
| `max_context_messages_peer_dm` | Separate window for @Steve in a human↔human DM (default 60). |
| `max_images_per_turn` | Drop images past this count before the call. |
| `max_tool_invocations_per_turn` | Cap tool calls per turn (web / X). |
| `monthly_spend_ceiling_eur` | Soft-budget for the user, informational. |

`credits-entitlements` stores Grok 4.3 pricing fields and
`hard-limits` stores output/context caps. `resolve_entitlements(...)`
projects the per-turn caps into `ent`; `steve_model_config` reads the
pricing fields and provides shared cost helpers for DM, feed, and group
surfaces.

### Context window assembly

All surfaces read message history from Firestore (with MySQL fallback),
bounded to `max_context_messages` (200) or `max_context_messages_peer_dm`
(60) via `ORDER BY created_at DESC LIMIT N` + reverse. The Firestore
query and MySQL query both use descending-then-reverse so read cost is
O(cap) per turn, not O(thread length).

| Surface | Window (msgs) | Split |
|---------|---------------|-------|
| Direct Steve DM | `max_context_messages` (200) | 170 older + 30 current |
| Peer DM (@Steve in human↔human) | `max_context_messages_peer_dm` (60) | verbatim window + older when summary enabled |
| Group chat | `max_context_messages` (200) | 170 older + 30 current |
| Feed thread | up to 50 comments | trimmed by char budget |

Both caps are KB-tunable on the `hard-limits` page. `peer_context_limit()`
in `steve_model_config.py` reads the peer-DM cap from entitlements with
a safe fallback of 10 (the legacy `PEER_DM_CONTEXT_LINES`) when the KB
field is missing. When thread summary is enabled, `dm_context_read_limit()`
extends the peer-DM read to include enough older messages for the summary
service, capped at `max_context_messages`.

### Per-message timestamps

Every message line in Steve's context window now includes a compact
timestamp prefix: `[May 29, 14:30] sender: message text`. Messages
older than ~180 days include the year: `[Jan 12 2025, 09:15]`.
This applies to:

- DM messages (Firestore and MySQL paths)
- Group chat messages (Firestore and MySQL paths)
- Feed thread comments (via `sort_key` / `timestamp` / `created_at`)
- Thread summary input lines (via `message_line_from_row(ts=...)`)

The shared helper `format_msg_timestamp()` lives in
`backend/services/steve_thread_memory.py`. If the timestamp value is
`None` or unparseable, the prefix is silently omitted (empty string).

### Rolling thread summary (optional, KB-gated)

When `thread_summary_enabled` is true on the KB `hard-limits` page,
`backend/services/steve_thread_memory.py` generates a compact structured
summary of older messages (beyond the verbatim window). The summary is
stored on the thread's Firestore doc (`steve_thread_summary`,
`steve_thread_summary_msg_count`, `steve_thread_summary_through_ts`)
and refreshed every `thread_summary_refresh_messages` new messages when
the older-than-window count exceeds `thread_summary_trigger_messages`.

The thread summary runs on all DM surfaces (both direct Steve DMs and
peer DMs where Steve is mentioned) and group chats. Peer DMs use
`dm_context_read_limit()` to extend the Firestore read when summary is
enabled.

Steve context assembly must skip deleted and encrypted DM/group Firestore
messages before formatting or summarizing them. A Steve context reset clears
the cached `steve_thread_summary*` fields and prevents stale cached summaries
from being re-injected after the reset timestamp.

Each summarize call writes exactly one `ai_usage.log_usage` row with
`request_type="steve_thread_summary"`. The main reply's usage row is
separate and unchanged.

When disabled (default), the code path is a strict no-op — zero extra
rows, identical context to the raw-window behaviour.

### Phase 3 chat memory (peer DMs enabled)

`backend/services/steve_dm_reply.py` now calls `inject_chat_memory_into_context` (semantic retrieval via `retrieve_relevant_chunks` + cosine similarity) and `inject_counters_into_context` (event ledger via `query_counters`) for peer DMs when `chat_memory_enabled` + `chat_memory_peer_dm_enabled` (and `chat_memory_event_ledger_enabled` for counters) are true **and** the user message matches `has_recall_intent` or `has_count_intent`.

- `=== RELEVANT OLDER MEMORY ===` section for recall questions ("when did", "remember when").
- `=== STRUCTURED THREAD COUNTERS ===` section for count questions ("how many times", "how often").

Chunks must be backfilled (`scripts/backfill_steve_chat_memory.py --conv-id X --write`) and then embedded (`embed_chunks`). Retrieval-only reads do **not** log `ai_usage`; embedding calls log one row with `request_type="steve_chat_memory_embed"`.

The rollout knobs live on KB page `hard-limits` and are projected through
`resolve_entitlements`: `chat_memory_enabled`,
`chat_memory_peer_dm_enabled`, `chat_memory_group_enabled`,
`chat_memory_min_messages`, `chat_memory_chunk_messages`,
`chat_memory_chunk_chars`, `chat_memory_top_k`,
`chat_memory_max_prompt_chars`, `chat_memory_backfill_max_messages`,
`chat_memory_event_ledger_enabled`, `chat_memory_embedding_model` (defaults to `text-embedding-3-small`), and
`chat_memory_indexing_daily_budget_usd`. All feature switches default off;
the indexing budget defaults to `$0`.

Future retrieval must stay scoped to the exact thread key and must not cross
DM/group boundaries. `should_include_memory_record` excludes stale/invalidated/deleted/encrypted/reset records. 

See `steve_chat_memory_retrieval.py` and `steve_chat_memory_events.py` for implementation. Group support (PR5) and full ops/invalidation (PR6) are also wired.

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
