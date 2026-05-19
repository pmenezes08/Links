# C-Point — Scale, UX, performance & economics audit

**Date:** 2026-05-19  
**Coordinator:** Sequential lanes 6–10 (read-only, no code changes)  
**Companion:** [`STORE_RELEASE_AUDIT.md`](STORE_RELEASE_AUDIT.md) (App Store / Play / IAP)  
**Truth docs:** `AGENTS.md`, `backend/services/knowledge_base.py` (KB seeds), `docs/PRODUCT_JOURNEYS.md`, `docs/OPERATIONS.md`, `docs/QA_CHECKLIST.md`, `docs/MONOLITH_REDUCTION_ROADMAP.md`  

**Scale assumption:** ~**50,000 registered users** within **2 months** (marketing/growth target — not all concurrent or paying).

---

## Cross-lane blockers

| ID | Blocker | Raised by | Blocks |
|----|---------|-----------|--------|
| Y1 | **Cloud SQL `db-f1-micro`** + shared staging/prod DB | Agent 8 | Reliable growth to 50k |
| Y2 | **`ai_usage_log` growth** without rollups/archival | Agent 8 | Query latency, admin metrics timeouts |
| Y3 | **Giant client pages** (feed/chat 4–5k+ lines) | Agent 7 | UX regressions, mobile perf |
| Y4 | **Store P0s** (native IAP plugin, prod Capacitor URL) | Store audit | Correct mobile monetization at scale |
| Y5 | **Channel mix** — IAP same price, lower net margin | Agent 9–10 | Unit economics if acquisition is mostly mobile |
| Y6 | **KB `current_phase: early-adoption`** at scale | Agent 9 | Pricing/margin for bulk of cohort |
| Y7 | **Billing export / alerts pending** (`OPERATIONS` §0.3) | Agent 8 | Operating blind on cost spikes |

---

## Agent 6 — Subscription & membership UX

**Scope:** `ManageMembershipModal`, `SubscriptionPlans`, `LimitReachedModal`, `UsageWarningBanner`, `EntitlementsContext`, `MembershipAIUsage`, `EditCommunity` billing modals.

### Summary

- **Sanctioned gating primitives** exist and are wired globally via `EntitlementsProvider` + `LimitReachedModal` (`AGENTS.md`).
- **Spend ceiling is intentionally invisible** to users: backend maps `monthly_spend_ceiling` blocks to `monthly_steve_cap` copy (`entitlements_gate.py`); analytics use `monthly_spend_ceiling` in `log_block`.
- **`/api/me/billing`** scrubs `monthly_spend_ceiling_eur` from `caps` (`me.py`); client `BillingResponse` type still lists the field but API does not emit it — harmless stale type.
- **UsageWarningBanner** warns at 80%/95% of **Steve use count** (not EUR); aligns with user-facing allowance.
- **LimitReachedModal** covers `premium_required`, caps, community pool, grace — copy mostly KB-driven except Premium bullet list (hardcoded, aligned with `/api/kb/pricing` bullets).

### Findings

| Sev | Issue | Evidence | Fix |
|-----|-------|----------|-----|
| P1 | **Plan tab** no billing provider badge; upgrade → `/subscription_plans` always | `ManageMembershipModal` PlanTab | Same as store audit — show provider + native-safe CTA |
| P1 | **Steve package** from subscription hub uses Stripe on native | `SubscriptionPlans.onSteveCommunityChosen` | External web or block on native |
| P2 | **Premium pricing display** — `_premium_payload` uses `premium_price_early_eur` as fallback when standard empty | `subscriptions.py` ~284–287 | Verify admin KB has `premium_price_standard_eur`; fix helper logic in a later PR |
| P2 | **LimitReachedModal** Premium bullets hardcoded in TS | `LimitReachedModal.tsx` | Acceptable if kept in sync with KB; consider i18n keys |
| OK | Spend ceiling hidden from users | `entitlements_gate` + `me.py` scrub | — |
| OK | Usage warning + modal reasons | `UsageWarningBanner`, `LimitReachedModal` | — |
| OK | Community billing badges in EditCommunity | `providerBadge`, store URLs | — |

### Agent 6 verdict

Membership **enforcement UX is production-minded** (no EUR leakage, proactive warnings). **Billing discovery UX** still has store-audit gaps on Plan tab and native Steve package.

---

## Agent 7 — Core app UX at scale

**Scope:** Large pages, onboarding, account lifecycle, offline/network, i18n subscription surfaces.

### Hotspots (line counts — `MONOLITH_REDUCTION_ROADMAP.md`)

| Surface | ~Lines | Risk at 50k |
|---------|--------|-------------|
| `CommunityFeed.tsx` | 5,400+ | Feed scroll jank, memory, hard QA |
| `ChatThread.tsx` | 4,300+ | DM media, cache churn |
| `GroupChatThread.tsx` | 3,900+ | Same |
| `OnboardingChat.tsx` | 2,700+ | First-run drop-off |
| `SubscriptionPlans.tsx` | 2,100+ | Paywall confusion |

### Summary

- **Account deletion** exists (`AccountDangerZone` → `/delete_account`) — required for store compliance; verify URL in App Store Connect.
- **Offline / network:** `NetworkContext`, service worker (`client/public/sw.js`) — API paths on no-cache list; other routes may cache (`ACCOUNT_ISOLATION_INVENTORY.md`) — test logged-in feed after deploy.
- **Trial → Free downgrade:** KB policy (communities over cap read-only) — UX must communicate locked state clearly on feed/community settings (manual QA under growth).
- **i18n:** QA checklist § PR 48–52 covers pt-PT on `/subscription_plans`, notifications, profile — extend to **Manage Membership modal** before 50k PT users.

### Findings

| Sev | Issue | Evidence | Fix |
|-----|-------|----------|-----|
| P1 | **Monolith pages** — high regression cost per release | Roadmap | Prioritize smoke automation + split feed/chat per roadmap |
| P1 | **Admin metrics / DAU** endpoint heavy; slow at large data | `OPERATIONS` §0.4 | SQL rollups before relying on admin for growth ops |
| P2 | **Entitlements cache** — 20s focus throttle OK; OPERATIONS notes stale UI after admin tier flip | `useEntitlements.ts`, `OPERATIONS` §4 | Acceptable; backend enforces |
| P2 | **Service worker** cache vs API freshness | `sw.js`, `ACCOUNT_ISOLATION_INVENTORY` | Post-deploy hard-refresh test checklist |
| OK | Global limit modal via context | `EntitlementsContext.tsx` | — |

### Agent 7 verdict

**Functional UX is shippable** for a growth push, but **maintainability and mobile perf** on feed/chat are the main 50k-user risks — not missing buttons.

---

## Agent 8 — Performance & infrastructure (50k model)

**Scope:** Cloud Run, Cloud SQL, `ai_usage_log`, Firestore paths, client bundle, monitoring.

### Current baseline (`OPERATIONS.md` §0.1)

| Component | Approx €/mo | Notes |
|-----------|-------------|--------|
| Cloud Run (all) | ~103 → **~55–60 after hygiene** | Prod `min-instances=1` |
| Cloud SQL | ~7.81 | **`db-f1-micro`** |
| Artifact / other | ~10 | — |

**Shared DB:** Staging + prod both use **`cpoint-db`** — growth tests and bad queries hit production data.

### Capacity model (illustrative)

Assume **50,000 registered**, not all active:

| Metric | Low | Mid | High |
|--------|-----|-----|------|
| MAU (40% of registered) | 20,000 | 25,000 | 35,000 |
| DAU (25% of MAU) | 5,000 | 6,250 | 8,750 |
| Premium subscribers (5% of registered) | 2,500 | 2,500 | 5,000 |
| Avg Steve calls / Premium / month | 30 | 50 | 80 |
| New `ai_usage_log` rows / month (order of magnitude) | 150k–400k | 250k–600k | 500k–1M+ |

**Steve API load:** Peak depends on **concurrent** Steve chats (group/feed weighted 3× credits). Flash crowds (launch day) matter more than registered count.

### Bottlenecks

| Layer | Issue | At 50k |
|-------|--------|--------|
| **MySQL** | `db-f1-micro`, single instance | Connection limits, slow `COUNT`/`SUM` on `ai_usage_log`, user/community growth |
| **Cloud Run** | Single warm instance default; `--cpu-boost` on deploy | May need **higher memory, max instances, concurrency** tuning under spike |
| **`ai_usage_log`** | Per-call inserts; indexes on user/time/surface | Table size → backup time, counter query cost |
| **`/api/admin/metrics`** | Full scans | Timeouts (documented) |
| **Firestore** | Dual-read/write on messaging | Cost + latency if read flags on at scale |
| **Client** | Large JS bundles, chat caches | Low-end Android RAM, IndexedDB growth |

### Indexes (positive)

`ai_usage.py` ensures `idx_ai_usage_user_surface`, `idx_ai_usage_user_time_success` — good for per-user counters; community pool queries need `community_id` usage patterns monitored.

### Findings

| Sev | Issue | Evidence | Fix |
|-----|-------|----------|-----|
| P0 | **Upgrade Cloud SQL tier** before 50k push | `OPERATIONS` db-f1-micro | Plan `db-g1-small` or higher + connection pool review |
| P0 | **Cost monitoring** not fully wired | §0.3 BigQuery billing export pending | Enable export + alerts on Run + xAI spend |
| P1 | **`ai_usage_log` rollup job** | OPERATIONS: rollups “separate effort” | Monthly aggregates for admin + faster counters |
| P1 | **Redis** optional for hot paths | `ENABLE_REDIS.md`, in-memory fallback | Consider Redis for session/rate-limit if Steve RPM spikes |
| P2 | **Prod Cloud Run autoscaling** limits unknown in repo | `cloudbuild-production.yaml` minimal | Document/set `--max-instances`, memory in Console |
| P2 | **Capacitor staging URL** | Store audit | Prod builds only |

### Infra cost bands (order-of-magnitude, excl. variable AI)

| Phase | Fixed infra €/mo | Variable AI €/mo (indicative) |
|-------|------------------|-------------------------------|
| Today | ~55–60 | Low hundreds at current users |
| 50k registered, 2.5k Premium, avg usage | ~150–400 (SQL+Run scaled) | **€2k–8k** if 10–30% of Premium users approach €3.99 ceiling |
| 50k registered, 5k Premium, heavy Steve | ~200–500 | **€5k–20k** upper stress (ceiling-bound) |

Variable AI is **capped per user** (€3.99 spend ceiling default) but **scales with paying headcount**.

### Agent 8 verdict

**Do not drive 50k signups on `db-f1-micro` without a SQL upgrade plan and billing alerts.** Code has decent per-user indexes; **ops scale** is the gap.

---

## Agent 9 — KB economics & entitlements coherence

**Scope:** KB pages vs `resolve_entitlements`, `entitlements_gate`, `ai_usage`, `/api/kb/pricing`.

### KB structure (coherent)

| Page | Role |
|------|------|
| `index` | Two-axis monetization; web-first margin |
| `user-tiers` | Free / trial / Premium caps, early €4.99 vs standard €7.99 |
| `community-tiers` | L1–L3 prices, Stripe + Apple/Google product IDs, **internal** unit economics |
| `credits-entitlements` | User-facing 100 uses; internal weights; **€3.99** spend ceiling |
| `monetization-math` | Channel fees (Apple/Google 30/15%, Stripe 1.5%), VAT, worked €7.99 example |
| `hard-limits` | Per-turn tokens, RPM/HPM |
| `paid_steve_package` (in community-tiers) | €49/mo, 200 calls, **$5** hidden provider ceiling |

### Code alignment

| Rule | Implemented |
|------|-------------|
| KB is policy source | `entitlements._kb_field_value`, `mobile_iap.config()` |
| User sees call caps, not EUR ceiling | Gate + API scrub |
| Internal weights DM=1, group/feed=3 | KB + gate debit logic |
| Community pool priority | `PRODUCT_JOURNEYS`, `entitlements_gate` + `community_id` on `log_usage` |
| Web margin > IAP at same price | KB `monetization-math`; `same_public_price_all_channels=true` |
| `/api/kb/pricing` strips internal economics | `subscriptions.api_kb_pricing` docstring + helpers |

### Gaps / review items

| Sev | Topic | Detail |
|-----|--------|--------|
| P1 | **`current_phase: early-adoption`** in seeds | Bulk of 50k may get €4.99 positioning while KB says lower AI ceiling (~€1.99) for margin — confirm **live KB** matches intended launch pricing |
| P1 | **Early vs standard price in API** | `_premium_payload` fallback logic may show wrong “standard” price if KB field empty |
| P1 | **No server IAP receipt verification** | Economics assume real purchases; fraud undermines revenue (store audit) |
| P2 | **Steve package margin** | €49 revenue vs $5 provider cap is strong **if** tools stay conservative (`external_search_explicit_only` ON) |
| P2 | **Community break-even** (17/34/64 members) | Infra-based; does not include owner’s personal Premium or Steve package — OK as internal guide |
| OK | Special users higher ceiling | `monthly_spend_ceiling_eur_special` in resolver |
| OK | Enforcement flag | `ENTITLEMENTS_ENFORCEMENT_ENABLED` env (`feature_flags.py`) |

### Agent 9 verdict

**KB and runtime gates tell a consistent story.** Before 50k users, **audit live KB in admin-web** (not just seeds): phase, prices, Stripe IDs, tool flags, `iap_purchases_enabled`.

---

## Agent 10 — Revenue & margin stress test

**Assumptions:** KB defaults; EUR; ceilings bind worst case; VAT 23%, corp tax 12.5% per `monetization-math`.

### Premium personal (monthly)

| Channel | List price | ≈ Net revenue / user / mo | AI ceiling (KB) | ≈ Pre-tax margin (worst user) |
|---------|------------|---------------------------|-----------------|--------------------------------|
| Web Stripe | €7.99 | ~€6.50+ | €3.99 | ~€2.50+ |
| iOS/Android Y2+ (15%) | €7.99 | ~€5.52 | €3.99 | ~€1.34 (KB worked example) |
| Early web | €4.99 | ~€4.00+ | should be ~€1.99 per KB | **Tighter** — verify ceiling for early cohort |
| Early IAP | €4.99 | ~€3.45 | same | **Risk of negative** if ceiling still €3.99 |

### Community tier (owner pays — monthly)

| Tier | Price | Break-even members (KB) | Notes |
|------|-------|---------------------------|--------|
| L1 | €49.99 | ~17 | Margin improves with fill; store takes 15–30% if IAP |
| L2 | €99.99 | ~34 | |
| L3 | €189.99 | ~64 | |

**Steve package add-on:** €49/mo + hidden $5 (~€4.60) provider cap — attractive **if** pool usage enforced; heavy tool use can compress margin inside cap.

### 50k-user scenario matrix

| Scenario | Registered | Premium % | Premium count | Max AI cost/mo (ceiling-bound) | Notes |
|----------|------------|-----------|---------------|-------------------------------|--------|
| Conservative | 50,000 | 3% | 1,500 | ~€6,000 | Most stay free/trial |
| Base | 50,000 | 8% | 4,000 | ~€16,000 | Growth campaign |
| Aggressive | 50,000 | 15% | 7,500 | ~€30,000 | Strong conversion |

Add **community IAP/Stripe**: e.g. 500 paid communities × €50–190 → **€25k–95k gross** before fees (highly mix-dependent).

**Channel sensitivity (4,000 Premium):**

| Mix | Blended net / Premium / mo (rough) | vs all-web |
|-----|-----------------------------------|------------|
| 70% web / 30% IAP | ~€6.0 | −8% |
| 50% web / 50% IAP | ~€5.5 | −15% |
| 30% web / 70% IAP | ~€5.0 | −23% |

**Implication:** At 50k acquisition, **push account creation on web** for Premium + 2nd community + Steve package; use native for **first** community/Premium only per policy.

### Token / logging discipline

- Every Steve/Whisper call should hit `ai_usage.log_usage` with `tokens_in/out`, `cost_usd` (`STEVE_AND_VOICE_NOTES.md`).
- Blocks use `log_block` — excluded from user counters but visible in analytics.
- **Run weekly:** `SUM(cost_usd)` by tier, surface, `community_id`; % blocks `monthly_spend_ceiling` vs `monthly_steve_cap`.

### Agent 10 verdict

Economics **work at €7.99 web** and **are tight on €4.99 IAP** unless early-adopter ceiling is lowered in live KB. Scale to 50k is **profitable only with conversion discipline and infra/AI monitoring** — not automatic.

---

## Final merged report

### Executive summary

1. **KB monetization model is coherent:** two axes, internal weights, user-facing caps, hidden EUR spend ceiling, channel math documented in `monetization-math`.
2. **Runtime matches policy:** entitlements gate, API privacy scrub, `ai_usage` logging — suitable for paid AI at scale **if enforcement env flag is on in prod**.
3. **UX for limits is strong:** users see “monthly Steve allowance,” not provider budgets; warning banner at 80/95%.
4. **50k users in 2 months is an infra + ops challenge**, not just a product launch — **`db-f1-micro` and pending billing alerts are P0**.
5. **Variable AI cost scales with Premium headcount**, capped ~**€3.99/user/month** — budget **€6k–30k/mo** AI at 1.5k–7.5k Premium (worst-case ceilings).
6. **Mobile acquisition without web billing education erodes margin** ~15–25% vs Stripe at same list price.
7. **Client monoliths (feed/chat)** are the main UX/perf maintenance risk; store audit P0s block correct mobile revenue.
8. **Complete store audit P0s + this doc’s infra/KB checks** before large marketing spend.

### P0 — Blockers

| Issue | Platform | Evidence | Fix |
|-------|----------|----------|-----|
| Cloud SQL undersized for 50k | Infra | `OPERATIONS` db-f1-micro | Upgrade tier; review connection limits |
| No production cost alerting | Ops | §0.3 pending | BigQuery billing export + alerts |
| Store native IAP + prod URL | Mobile | `STORE_RELEASE_AUDIT.md` X1, X2 | Cap sync + prod Capacitor |
| Confirm `ENTITLEMENTS_ENFORCEMENT_ENABLED` on prod | Backend | `feature_flags.py` | Cloud Run env var |

### P1 — Important

| Issue | Platform | Evidence | Fix |
|-------|----------|----------|-----|
| Live KB phase/pricing for 50k cohort | Ops/KB | `current_phase: early-adoption` | Admin review + Reseed if needed |
| Early €4.99 + €3.99 ceiling mismatch risk | Economics | `monetization-math` body | Lower ceiling or shorten early window in KB |
| `ai_usage_log` rollups | Backend | OPERATIONS §0.4 | Scheduled aggregation |
| Steve package Stripe on native | UX/Revenue | Agent 6 | Web overflow |
| Admin metrics timeout | Ops | OPERATIONS | Rollups or restrict date range |
| Channel mix strategy | Growth | Agent 10 | Web CTAs in app for 2nd community / add-ons |

### P2 — Follow-up

| Issue | Platform | Evidence | Fix |
|-------|----------|----------|-----|
| Split feed/chat monoliths | Client | Roadmap | Incremental extraction |
| Redis for hot caches | Infra | `ENABLE_REDIS.md` | If Steve RPM high |
| i18n on membership modal | UX | QA gap | pt-PT pass |
| `_premium_payload` price fallback | API | `subscriptions.py` | Code fix later |
| Android §7a 2nd-community step | QA | Store audit | Add to checklist |

### Ready to ship growth?

| Dimension | Ready? |
|-----------|--------|
| **KB economics story** | **Yes** (verify live admin KB) |
| **Entitlements / cost gates** | **Yes** (if enforcement on) |
| **UX at 50k** | **Conditional** — smoke heavy paths; fix store P0s |
| **Infra at 50k** | **No** — SQL + monitoring first |
| **Margin at 50k** | **Conditional** — depends on Premium % and web vs IAP mix |

### Ready to flip `iap_purchases_enabled`?

See **`STORE_RELEASE_AUDIT.md`** — unchanged: **No** until store QA complete.

### Manual QA minimum (growth + economics)

**After store P0 fixes:**

1. §7a mobile billing (both platforms).  
2. §8 / §8a entitlements + **no** `monthly_spend_ceiling_eur` in `/api/me/entitlements` JSON.  
3. Premium user: burn Steve until **monthly cap** modal — copy sane.  
4. Simulate ceiling (staging SQL per QA §8a) — user still sees **monthly Steve cap**, not EUR.  
5. Community with Steve package: pool display on Manage Community; free member @Steve uses pool.  
6. `/subscription_plans` early vs standard prices match KB.  
7. Feed + DM smoke on **mid-tier Android** + iOS TestFlight.  
8. Post-signup day-25 trial email path (if enabled).  

### Suggested work order (no code in this step)

1. **Infra:** SQL tier + billing alerts + document Run limits.  
2. **Store audit P0s** (cap sync, prod URL).  
3. **Admin KB review** (phase, prices, ceilings, tool flags, Stripe/Store SKUs).  
4. **§7a + growth QA** on staging/prod.  
5. **Marketing** with web-billing messaging for margin.  
6. **Weekly** `ai_usage` cost dashboard by tier/channel.  
7. **Post-launch:** rollups, monolith splits, receipt verification (store audit P1).

### KB fields to re-verify in admin-web (checklist)

- [ ] `index` → `current_phase`  
- [ ] `user-tiers` → early vs standard prices, trial caps, `iap_purchases_enabled`  
- [ ] `community-tiers` → L1–L3 prices, Stripe live IDs, Apple/Google product IDs, Steve package price + **tool flags**  
- [ ] `credits-entitlements` → `monthly_spend_ceiling_eur`, weights, model costs date  
- [ ] `monetization-math` → fee % still accurate  
- [ ] `hard-limits` → RPM/HPM/token caps  
- [ ] Product Roadmap test pills → run `iap:*` and entitlements rows  

---

*End of audit. No code changes. Not committed.*
