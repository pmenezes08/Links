# Performance, reliability, and UX — sign-off

| Field | Value |
|-------|--------|
| **Status** | **Draft — manual QA pending** |
| **Post-review fixes** | SW `2.69.3` bypasses all session JSON; `ensureAccountIsolationForUsername` on login + profile load |
| **Date** | 2026-05-19 |
| **Branch / commit** | `staging` @ `f7c792313` |
| **Review type** | Read-only code review (4 parallel agents) + live ops checks (Agent 3) |
| **Environment** | Staging URL: operator to confirm via `gcloud run services describe cpoint-app-staging` |
| **Companion audits** | [`SCALE_AND_ECONOMICS_AUDIT.md`](SCALE_AND_ECONOMICS_AUDIT.md), [`ACCOUNT_ISOLATION_INVENTORY.md`](../ACCOUNT_ISOLATION_INVENTORY.md), [`QA_CHECKLIST.md`](../QA_CHECKLIST.md) |

---

## Executive summary

| Lane | Verdict (code / docs) | Store launch | ~50k growth |
|------|------------------------|--------------|-------------|
| **1 — Cache & isolation** | Pass with notes | OK if §14 uses **full logout** between accounts | SW session API cache + unscoped IDB feeds remain P1 debt |
| **2 — Client performance** | Pass with notes | Acceptable; ~617 KB gzip main JS | Bundle + no virtualization = jank risk in active communities |
| **3 — Ops & scale** | Conditional | Entitlements flag + IAP ops still operator-dependent | **Not ready** — `db-f1-micro`, no rollup Scheduler job, billing alerts pending |
| **4 — UX & reliability** | Pass with notes | Entitlements/billing wiring OK | pt-PT gaps on limit modal; web cold offline banner edge case |

**Overall (draft):** **Conditional GO for store submit** after human manual QA (below) and launch checklist operator steps. **Not GO for marketing scale** until Y1, Y2, Y7 (see deferred).

**No P0 code defect** was found that alone blocks store submit; highest risks are **operational** (entitlements enforcement not on prod) and **process** (account switch must use full logout).

---

## Lane summary tables

### Lane 1 — Client cache and account isolation

**Verdict:** Pass with notes

**Confirmed working (code):**

- Full logout clears account localStorage prefixes, IndexedDB (`cpoint-offline` + legacy crypto DBs), avatar cache, SW runtime caches, and unregisters service workers (`logout.ts` → `accountStateReset.ts`).
- DM thread localStorage keys are viewer-scoped (`chatThreadsCache.ts`).
- Offline DB v3 scopes `conversations` by `conversationRowId(viewer, peer)`.
- Profile paths are on SW `NO_CACHE` list.

**Findings:**

| Sev | Finding |
|-----|---------|
| P1 | SW `STALE_API_ENDPOINTS` caches session JSON by URL only (`/api/chat_threads`, `/api/notifications`, `/api/user_communities_hierarchical`, etc.). Mitigated on **full logout**, not on silent in-app user switch. |
| P1 | IndexedDB `feeds` keyed by `communityId` only; `posts` / `outbox` not viewer-scoped. Safe only when DB deleted on account change. |
| P2 | `SERVER_PULL` can cache arbitrary credentialed URLs in `RUNTIME_CACHE`. |
| P2 | Doc drift: `ACCOUNT_ISOLATION_INVENTORY.md` lists SW `2.69.1`; code is `2.69.2`. Doc omits some `accountStateReset` prefixes. |

**Wrong-user data without full logout?** **Yes** (SW + IDB). **No** if QA follows §14 full logout.

---

### Lane 2 — Client performance

**Verdict:** Pass with notes

**Build artifact (2026-05-19 review build):**

| Asset | Size | Gzip |
|-------|------|------|
| `dist/assets/index-jBq2fGqL.js` (main) | 2,347.71 kB | 617.34 kB |
| App CSS | 104.96 kB | 17.77 kB |

**Findings:**

| Sev | Finding |
|-----|---------|
| P0* | No route-level code splitting — ~40 pages eagerly imported in `App.tsx`. (*P0 for scale/maintainability, not store rejection.) |
| P0* | No list virtualization on feed (`visiblePosts.map`) or chat (`messages.map`). |
| P1 | Full feed fetched in one API response; client slices to 40 posts initial + 20 per “Load older”. |
| P1 | Monolith pages: CommunityFeed ~5,515 lines, ChatThread ~4,473, GroupChatThread ~4,013. |
| P2 | Vite `manualChunks` only splits FontAwesome. |

**Store opinion:** Acceptable for App Store review and early users; expect cold start 2–5+ s on mid-tier Android and scroll jank in large communities.

---

### Lane 3 — Backend ops and scalability

**Verdict:** Conditional (store) / Fail (50k)

**Live checks (Agent 3, project `cpoint-127c2`):**

| Check | Result |
|-------|--------|
| Cloud SQL `cpoint-db` tier | **`db-f1-micro`** (RUNNABLE) |
| Scheduler job `ai-usage-daily-rollup` | **Not present** in `europe-west1` job list |
| Prod `CRON_SHARED_SECRET` | Set on `cpoint-app` |
| Prod `ENTITLEMENTS_ENFORCEMENT_ENABLED` | **Not set** at time of review — re-verify after deploy |

**Scale audit Y1–Y7:**

| ID | Status |
|----|--------|
| Y1 SQL tier | Pending for 50k; documented OK for minimal store |
| Y2 `ai_usage_log` / rollups | Code **yes**; Scheduler **no**; admin metrics still full-scan |
| Y3 Giant client pages | Pending (Lane 2) |
| Y4 Store IAP/Capacitor | See [`STORE_RELEASE_AUDIT.md`](STORE_RELEASE_AUDIT.md) / launch checklist |
| Y5 Channel economics | Product / KB policy |
| Y6 KB early-adoption phase | Operator KB review before large cohort |
| Y7 Billing export + alerts | **Pending** (`OPERATIONS.md` §0.3) |

**Rollups:** `backend/services/ai_usage_rollups.py` + `POST /api/cron/ai-usage/daily-rollup` in `enterprise.py` — implemented, not scheduled in prod.

---

### Lane 4 — UX and reliability

**Verdict:** Pass with notes

**Confirmed working (code):**

- `EntitlementsProvider` inside `BrowserRouter` with global `LimitReachedModal`.
- `NetworkProvider` + `OfflineBanner` at app root.
- `PaidCommunitiesBillingSection` on Plan and Billing tabs; EN + pt-PT keys for paid-communities copy.
- `ErrorBoundary` wraps route subtree.

**Findings:**

| Sev | Finding |
|-----|---------|
| P1 | `LimitReachedModal` hardcoded English — conflicts with QA §15 entitlements denial in pt-PT. |
| P1 | Web: `OfflineBanner` hidden until `NetworkContext` initializes — user opening app **already offline** may not see banner until network event. |
| P2 | `ManageMembershipModal` mixed EN hardcoded strings; `ErrorBoundary` EN-only; plan tab silent if entitlements fetch fails. |

---

## Consolidated P0 / P1 / P2 (coordinator)

### P0 — blocks or must fix before treating sign-off as Final

| # | Item | Owner | Notes |
|---|------|-------|-------|
| — | *None from code review alone* | — | Operator P0s below are launch-process, not new bugs |

**Operator / launch P0 (from Lane 3 + launch checklist — verify, not duplicate engineering):**

- Set `ENTITLEMENTS_ENFORCEMENT_ENABLED=true` on prod `cpoint-app` before paid enforcement is trusted.
- Complete store QA §7a / §8a and IAP KB flags per [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md).

### P1 — fix before marketing push or next hardening sprint

| # | Item | Lane |
|---|------|------|
| 1 | ~~SW session JSON caching~~ **Done (2026-05-19):** `sw.js` v2.69.3 — all `/api/` JSON GET bypasses SW | 1 |
| 2 | IndexedDB viewer-scope for `feeds` / `outbox` (inventory PR D) | 1 |
| 2b | ~~Login username change reset~~ **Done:** `ensureAccountIsolationForUsername` in `App.tsx` + `MobileLogin.tsx` | 1 |
| 3 | Schedule `ai-usage-daily-rollup` in Cloud Scheduler; wire admin metrics to rollups | 3 |
| 4 | Upgrade Cloud SQL off `db-f1-micro` | 3 |
| 5 | Apply billing export + monitoring alerts (`OPERATIONS.md` §0.3) | 3 |
| 6 | i18n: `LimitReachedModal` + membership modal hardcoded EN | 4 |
| 7 | Route code-splitting + feed/chat virtualization (incremental) | 2 |

### P2 — backlog

- `SERVER_PULL` SW cache policy; doc sync for isolation inventory + SW version.
- Web cold-start offline banner init.
- Monolith extraction per [`MONOLITH_REDUCTION_ROADMAP.md`](../MONOLITH_REDUCTION_ROADMAP.md).
- Reconcile full cron list vs `gcloud scheduler jobs list` (e.g. `enterprise-iap-nag`).

---

## Manual QA — required before **Final** status

Complete on **staging** (same commit as above or newer). Mark each checkbox when done; paste results to coordinator or edit this file.

### Cache & isolation (Lane 1) — [`QA_CHECKLIST.md`](../QA_CHECKLIST.md) §14

- [ ] **Logout:** In-app logout → `/` or `/welcome`; cannot open `/premium_dashboard` until login; no stale push for prior user.
- [ ] **Account switch:** User A → browse community + DMs → **full logout** → user B → B’s name everywhere; no A feed/DM content.
- [ ] **Remember-me:** After full logout, reopening requires credentials.

### Steve / membership cache (§11) — if bundled in this release

- [ ] Membership change → cached Steve context updated or invalidated (§11 cache test line).

### Entitlements (Lane 4) — §8 + §8a

- [ ] `test_free` Steve DM → Upgrade modal (not raw 401).
- [ ] `test_premium` / `test_trial` / `test_special` → Steve succeeds where expected.
- [ ] API responses scrub spend-ceiling / internal fields (§8a steps 3–5).
- [ ] Spend-ceiling block shows `monthly_steve_cap` UX (§8a step 6) if run.

### i18n (Lane 4) — §15 spot-check

- [ ] pt-PT device or Account Settings → Português → `/subscription_plans` + **Manage Membership** chrome in PT.
- [ ] Entitlements denial message in pt-PT (if testable without EN-only modal blocking).

### Performance (Lane 2) — subjective

- [ ] **Cold start** (native): force-quit → launch; note seconds to interactive on mid-tier device (target: ≤5s subjective pass).
- [ ] **Feed scroll:** community with many posts; fast scroll + “Load older” 2×; note jank yes/no.
- [ ] **Long chat:** 100+ messages; load older + send message; scroll behavior OK.

### Billing clarity (recent work)

- [ ] Manage Membership → Plan/Billing tabs → paid communities list loads; store vs web **Manage** opens correct destination.

---

## Scalability verdict

**Store launch (current load):** Engineering review supports **conditional proceed** once manual QA above passes and [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md) operator items are closed. Client perf and cache isolation are **good enough for review/traffic** if users fully log out on shared devices and ops enables entitlements enforcement.

**~50k registered users:** **Defer** until Y1 (SQL tier), Y2 (rollup cron + metrics path), Y7 (cost alerts), and Lane 2 P1 items (bundle split / virtualization) are addressed. Giant feed/chat files remain the main **regression and perf** risk under active use.

---

## Sign-off states

| State | Criteria |
|-------|----------|
| **Draft** (current) | Agent review complete; manual QA unchecked |
| **Final** | All mandatory manual QA checkboxes passed; operator launch P0s verified; no new P0 found in QA |

**Signed (Final):**

| Role | Name | Date |
|------|------|------|
| Engineering | | |
| Product / QA | | |

---

## Agent references

| Agent | Focus | ID (internal) |
|-------|--------|----------------|
| 1 | Cache / isolation | 83714317-580d-4b67-b4d1-6b39bf724896 |
| 2 | Client perf / bundle | b8273240-4fb4-4816-be83-b5b1de4dd7be |
| 3 | Ops / scale | 421c4abb-0bc5-4c56-b4e5-a9dad96be008 |
| 4 | UX / entitlements | f3ab0e8d-8b7d-448a-b039-20179e6b0366 |
