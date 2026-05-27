# Page transitions — workflow state

> **Living iteration log.** Updated in every PR of this epic.

## Epic info

- **KB roadmap title:** Native page transitions — pilot (Dashboard / Feed / Community / Post)
- **KB test ref:** `manual:page_transitions_pilot`
- **Feature flag:** `VITE_PAGE_TRANSITIONS` — **`true` on staging only** (default `false` elsewhere)
- **Staging URL:** `https://cpoint-app-staging-739552904126.europe-west1.run.app`

## Status summary (2026-05-27)

| Phase | Status |
|-------|--------|
| PR-0 → PR-10 implementation | Merged to `staging` branch |
| Staging deploy | Pending / in progress |
| Human QA §15 | **Ready for PO test after deploy completes** |
| PR-11+ polish | After QA feedback |

## What to test on staging

1. **Tab cross-fade (120ms):** Dashboard ↔ Feed ↔ About — bottom nav stays mounted, scroll preserved per tab.
2. **Push (250ms):** Dashboard → Community feed → Post detail — skeletons visible during slide, not spinners.
3. **Pop (250ms):** Back from community/post — reverse slide.
4. **Non-pilot routes:** Messages, Settings, Profile — **no** slide animation.
5. **§14 regression:** Chat thread open-at-bottom unchanged.

## Acceptance bar (open)

| Gate | Status |
|------|--------|
| CLS / instant paint | Implemented — PO verify |
| 60fps on device | PO verify on iOS + Android |
| §14 chat regression | PO verify |
| Premium feel sign-off | Pending |
| Recordings | Pending |

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-27 | Pilot scope only for motion | Non-pilot routes skip animation |
| 2026-05-27 | `VITE_PAGE_TRANSITIONS=true` staging only | Prod stays off until PO sign-off |
| 2026-05-27 | KeepAliveOutlet for dashboard tabs | Scroll preservation across tab switches |
| 2026-05-27 | Deferred scroll reset on transition end | Avoid outgoing page snap mid-slide |
