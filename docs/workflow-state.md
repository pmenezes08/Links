# Page transitions — workflow state

> **Living iteration log.** Updated in every PR of this epic. Each phase records decisions, QA results, performance numbers, and sign-off status.

## Epic info

- **KB roadmap title:** Native page transitions — pilot (Dashboard / Feed / Community / Post)
- **KB test ref:** `manual:page_transitions_pilot`
- **Notion row:** (mirror of KB — update both)
- **Branch prefix:** `docs/`, `feat/`, `refactor/`, `fix/page-transitions-*`
- **Feature flag:** `VITE_PAGE_TRANSITIONS` (default `false`)

## Acceptance bar

A phase loop closes only when **all** are satisfied:

| Gate | Criteria |
|------|----------|
| CLS | No visible layout shift during transition or first 500ms after landing |
| Performance | ~60fps on iPhone 13-class + equivalent Android during push/pop |
| Automated | CI green; vitest contracts pass; KB Tests row green on staging |
| Cross-platform | iOS Capacitor, Android Capacitor, mobile web — pilot flows smooth |
| Regression | §14 chat thread open unchanged; feed → thread navigation unaffected |
| Premium feel | Human QA / PO sign-off: no jank, no surprises |
| Knowledge transfer | This file updated; before/after screen recordings linked |

---

## Phase 0 — Tracking + QA harness

**Status:** in progress

| Deliverable | Done? | Notes |
|-------------|-------|-------|
| `docs/workflow-state.md` created | yes | This file |
| QA §15 added to `docs/QA_CHECKLIST.md` | yes | Page transitions (pilot) checklist |
| KB roadmap row seeded | yes | `knowledge_base.py` → `product-roadmap` |
| Notion Product roadmap row | pending | Mirror after merge |
| Baseline recordings (iOS + Android) | pending | Human QA captures before-state |
| Baseline CLS/perf documented | pending | verifier-qa establishes "before" |

---

## Phase 1 — Instant paint (PR-1 through PR-5)

**Status:** not started

| PR | Page | Merged? | QA result | Notes |
|----|------|---------|-----------|-------|
| PR-1 | Shared skeletons + ImageLoader | — | — | — |
| PR-2 | PremiumDashboard | — | — | — |
| PR-3 | HomeTimeline | — | — | — |
| PR-4 | CommunityFeed | — | — | — |
| PR-5 | PostDetail | — | — | — |

---

## Phase 2 — Layout shell (PR-6 through PR-8)

**Status:** not started

| PR | Change | Merged? | QA result | Notes |
|----|--------|---------|-----------|-------|
| PR-6 | motion.ts + route split | — | — | — |
| PR-7 | Layout Outlet + hoist nav | — | — | — |
| PR-8 | Keep-alive + scroll | — | — | — |

---

## Phase 3 — Transition layer (PR-9, PR-10)

**Status:** not started

| PR | Change | Merged? | QA result | Notes |
|----|--------|---------|-----------|-------|
| PR-9 | PageTransitionStack (flag off) | — | — | — |
| PR-10 | Enable on staging | — | — | — |

---

## Phase 4 — Polish (PR-11+)

**Status:** not started

| Issue | PR | Fix | QA re-check | Notes |
|-------|----|-----|-------------|-------|
| (discovered during QA) | — | — | — | — |

---

## Recordings

| Phase | Platform | Link | Date |
|-------|----------|------|------|
| Baseline (before) | iOS | — | — |
| Baseline (before) | Android | — | — |
| Phase 1 complete | iOS | — | — |
| Phase 1 complete | Android | — | — |
| Phase 3 complete | iOS | — | — |
| Phase 3 complete | Android | — | — |
| Final sign-off | iOS | — | — |
| Final sign-off | Android | — | — |

---

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-27 | Pilot scope: Dashboard, Feed, About, CommunityFeed, PostDetail | Highest-traffic drill-down; chat deferred |
| 2026-05-27 | Feature flag `VITE_PAGE_TRANSITIONS` | Motion can be disabled without reverting layout/skeleton work |
| 2026-05-27 | 250ms push/pop, 120ms tab cross-fade | Matches DESIGN.md motion tokens |
| 2026-05-27 | One page per PR for instant-paint | Safe revert per page; no big-bang |
