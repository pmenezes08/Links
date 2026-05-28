# Pilot Wave 2 — composer & profile polish — workflow state

> **Living iteration log.** Updated in every PR of this epic.
> Sibling of `docs/workflow-state.md` (Wave 1 — page transitions pilot).

## Epic info

- **Epic name:** Pilot Wave 2 — composer & profile polish
- **KB roadmap title:** `Pilot Wave 2 — composer & profile polish` (same string, verbatim)
- **KB test ref:** `manual:pilot_wave_2`
- **Feature flag:** `VITE_PAGE_TRANSITIONS` (reused from Wave 1) — **`true` on staging only**, default `false` elsewhere. No new flag is introduced this wave.
- **Staging URL:** `https://cpoint-app-staging-739552904126.europe-west1.run.app`
- **Base commit:** `cfd1b78ce` on `staging` (Wave 1 pilot + community-image fix)
- **Predecessor:** `docs/workflow-state.md` — Native page transitions pilot (PR-0 → PR-10, merged to `staging`, PO testing).

## Status summary (2026-05-28)

| PR | Title | Owner subagent(s) | Status |
|----|-------|-------------------|--------|
| PR-1 | GIF picker rebuild (bottom-sheet, glass, keyboard-aware) | `thread-engineer` + `platform-designer` | Implemented — QA in progress |
| PR-2 | Profile + PublicProfile frame-0 skeletons | `platform-designer` | Not started |
| PR-3 | AccountSettings frame-0 skeleton | `platform-designer` | Not started |
| PR-4 | Notifications + Followers frame-0 skeletons | `platform-designer` | Not started |
| PR-5 | Capacitor Haptics (send / pop-back / GIF select / long-press) | `capacitor-ux-polish` + `ios-expert` + `android-expert` | Not started |
| PR-6 | Pop-back animation Post → Community → Tab | `thread-engineer` | Not started |
| PR-7 | Pull-to-refresh visual on Feed (pilot tokens) | `platform-designer` | Not started |

## Out of scope (deferred — DO NOT touch in Wave 2)

The earlier "Hot-traffic Wave A/B" attempt was reverted because it destabilised chat surfaces. Wave 2 explicitly **excludes** motion / layout changes on:

- `client/src/chat/ChatThread.tsx`
- `client/src/chat/GroupChatThread.tsx`
- `client/src/pages/Messages.tsx`
- `client/src/pages/Communities.tsx`

These surfaces will get their own design pass in a later wave with `thread-engineer` driving the scroll-kernel contract. Any PR in Wave 2 that touches them is automatically out of scope and must be split.

## Per-PR scope, blast radius, exit criteria

### PR-1 — GIF picker rebuild
- **Owner(s):** `thread-engineer` (composer / keyboard plumbing, scroll inside the sheet) + `platform-designer` (visual spec, tokens, grid density, motion).
- **Files touched (planned):** `client/src/components/GifPicker.tsx` (single component). No call-site changes.
- **Scope:**
  - Convert from current form factor to a **bottom-sheet anchored above the composer**, keyboard-aware via `visualViewport`. Mirror the `keyboardLift` plumbing already used in `client/src/pages/CommentReply.tsx` (~lines 350–369 and 1500–1520) — do not invent a parallel keyboard listener.
  - **Liquid-glass tokens** consistent with Wave 1 page-transition glass (reuse `PAGE_TRANSITION_MS`, `CPOINT_EASE_OUT` from `client/src/components/pageTransitionUtils.ts`).
  - **Denser grid:** 4 columns on mobile, 6 columns on tablet+.
  - **Drag-to-dismiss** gesture (downward swipe past threshold dismisses).
  - **Attribution lockup right-aligned** in the search row (Tenor / Giphy mark per current provider terms).
- **Public API is locked:** `isOpen`, `onClose`, `onSelect(gifUrl)` MUST NOT change. No call sites of `<GifPicker />` are edited in this PR.
- **Blast radius:** Single component. Risk concentrated in keyboard math + drag gesture. Cannot regress non-GIF composer surfaces because no call sites change.
- **Exit criteria:**
  - No CLS when opening / closing the sheet on iOS or Android Capacitor.
  - 60 fps drag-to-dismiss on iPhone 13-class and a mid-tier Android.
  - Keyboard show/hide leaves the sheet anchored to composer top, no double-jump.
  - `§14` chat regression check still green (composer surfaces using GifPicker still behave identically).
  - `verifier-qa` adds Wave 2 GIF picker rows to `docs/QA_CHECKLIST.md §15` and marks them not-run.

### PR-2 — Profile + PublicProfile frame-0 skeletons
- **Owner:** `platform-designer`.
- **Files touched (planned):** `client/src/pages/Profile.tsx`, `client/src/pages/PublicProfile.tsx`, plus any small skeleton component co-located if needed.
- **Scope:** Add layout-matching skeletons (avatar circle, name/handle bars, tab strip, content card placeholders) rendered on the first frame using pilot tokens. No spinner, no blank shell.
- **Blast radius:** Two pages, no shared state changes, no route changes.
- **Exit criteria:** Cold-cache and warm-cache cases both paint a skeleton (cold) or real content (warm) on frame 0; CLS = 0 between skeleton and real content.

### PR-3 — AccountSettings frame-0 skeleton
- **Owner:** `platform-designer`.
- **Files touched (planned):** `client/src/pages/AccountSettings.tsx` (and any inner section already split out).
- **Scope:** Frame-0 skeleton matching the actual settings layout (sections, rows, ManageMembership card). Must keep the canonical `<ManageMembershipModal />` mount intact — do not duplicate billing UI.
- **Exit criteria:** Same as PR-2.

### PR-4 — Notifications + Followers frame-0 skeletons
- **Owner:** `platform-designer`.
- **Files touched (planned):** `client/src/pages/Notifications.tsx`, `client/src/pages/Followers.tsx` (or current equivalents).
- **Scope:** List skeletons matching row height, avatar position, and meta-text position. No data fetching changes.
- **Exit criteria:** Same as PR-2. No notification-pipeline changes (read-state, deep-link).

### PR-5 — Capacitor Haptics (opt-in per surface)
- **Owner:** `capacitor-ux-polish` + `ios-expert` + `android-expert`.
- **Files touched (planned):**
  - New util `client/src/utils/haptics.ts` wrapping `@capacitor/haptics` with safe no-op web fallback.
  - Wire callsites: composer send (post / DM / group send), pop-back navigation hook, GIF picker `onSelect`, long-press action menu.
- **Scope:** Light / Medium / Heavy impact mapped per interaction. Respect `prefers-reduced-motion` and a user toggle (defer toggle UI to a later PR if not already in AccountSettings).
- **Native coordination:** `ios-expert` confirms `@capacitor/haptics` is in `Podfile.lock` and entitlements are fine; `android-expert` confirms no extra permission needed and ProGuard keeps the plugin class.
- **Out of scope:** No haptics on chat thread scroll, no haptics on the four deferred surfaces.
- **Exit criteria:** Native rebuild on iOS + Android shows haptics on the four target interactions; web silently no-ops; no crash on iPad / non-haptic device; util is opt-in (callsites import the helper explicitly).

### PR-6 — Pop-back animation Post → Community → Tab
- **Owner:** `thread-engineer`.
- **Files touched (planned):** `client/src/components/pageTransitionUtils.ts` (extend), plus the `PageTransitionStack` / route wiring that selects push vs pop. **No edits to chat scroll kernel.**
- **Scope:** Extend the pilot pop animation so the chain **Post → Community feed → Dashboard tab** all reverse-slide consistently in 250ms with `CPOINT_EASE_OUT`. Today's pilot covers Post→Community and Community→Tab individually; this PR makes a multi-step back stack feel like one continuous gesture.
- **Exit criteria:** Multi-step back from `/post/:id` to a dashboard tab animates each pop at 60 fps with no scroll jump; deep-linked entries still skip the animation.

### PR-7 — Pull-to-refresh visual on Feed
- **Owner:** `platform-designer`.
- **Files touched (planned):** `client/src/pages/Feed.tsx` (or the PTR-host component in the feed kernel), reusing `PAGE_TRANSITION_MS` and `CPOINT_EASE_OUT` from `pageTransitionUtils.ts`.
- **Scope:** Replace the generic spinner with a brand-aligned PTR visual that uses the pilot tokens (glass disc / progress arc). Do **not** change the underlying refresh hook contract.
- **Exit criteria:** Refresh feel matches Wave 1 motion language; iOS rubber-band still works; no regression on Android Capacitor PTR; no change to `Messages` or `Communities` PTR (deferred surfaces).

## Acceptance bar (epic-level)

| Gate | Definition |
|------|------------|
| CLS = 0 | Every new skeleton + GIF sheet open/close shows zero cumulative layout shift on first paint and on data swap. |
| 60 fps on iOS + Android | Push/pop, PTR, GIF drag-to-dismiss, and haptics-triggering interactions run at 60 fps on iPhone 13-class + a mid-tier Android in Capacitor builds. |
| No §14 regression | Chat thread open-at-bottom, send, keyboard, and inverted-list scroll all behave identically to current `staging`. `verifier-qa` re-runs §14 after every merged PR in the wave. |
| Premium-feel sign-off | PO records a screen capture per PR on staging and confirms the feel matches Wave 1 sign-off bar. |
| Living docs updated | Each PR updates this file's status table + any doc impacted (`BACKEND_ROUTES.md`, `PRODUCT_JOURNEYS.md`, etc. — usually n/a this wave since changes are client-only). |

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-28 | **Wave 2 scope = 7 PRs locked** (PR-1 GIF picker, PR-2 Profile/PublicProfile skeletons, PR-3 AccountSettings skeleton, PR-4 Notifications/Followers skeletons, PR-5 Haptics, PR-6 multi-step pop-back, PR-7 Feed PTR visual). | PO confirmed. Anything else (chat, communities, messages motion) is deferred — they need their own design pass after the Wave-A/B revert. |
| 2026-05-28 | **GIF picker form factor = bottom-sheet anchored above composer, keyboard-aware.** | PO confirmed. Mirrors `CommentReply.tsx` `keyboardLift` plumbing so we don't fork a second keyboard listener. Drag-to-dismiss + denser grid + right-aligned attribution match the liquid-glass language from Wave 1. |
| 2026-05-28 | **Reuse `VITE_PAGE_TRANSITIONS` flag — no new flag.** | PO confirmed. Wave 2 is the same motion language as Wave 1; a separate flag would fragment the staging/prod gate and create a "flag matrix" we already rejected in Wave 1. Staging stays `true`, prod stays `false` until PO sign-off on both waves. |
| 2026-05-28 | **PR-1 brand-specialist sign-off: PASS_WITH_ADJUSTMENTS** — see `docs/design/gif_picker_spec.md` "Brand sign-off". | Three minor tweaks (GIPHY attribution contrast bump to `white/40`, section label brightness alignment, empty-state copy revision) plus one tracked-debt exception (`#4db6ac` accepted for intra-flow consistency, logged for accent-backfill epic). No blockers. |
| 2026-05-28 | **PR-1 brand adjustments applied to `GifPicker.tsx`**: GIPHY attribution `white/35` → `white/40`, header labels `white/55` → `white/45`, empty copy → `Nothing matched — try a different search`. | Direct application of the three PASS_WITH_ADJUSTMENTS items above; verified visually against the spec. No public API or caller changes. |
| 2026-05-28 | **PR-1 verifier-qa: §15.A authored, manual checklist ready for staging run.** | 21 bullets covering keyboard-aware open, drag-to-dismiss, haptics, IntersectionObserver pause, reduced motion, error/empty/loading states, cross-surface parity (6 callers), public API freeze, and §14 chat regression rerun. Ready for PO to run on staging. |

## Cross-references

- Wave 1 state: `docs/workflow-state.md`
- KB roadmap row: `backend/services/knowledge_base.py` → page slug `product-roadmap` → title `Pilot Wave 2 — composer & profile polish`
- KB test row: `backend/services/knowledge_base.py` → page slug `tests` → id `manual:pilot_wave_2` → target `QA_CHECKLIST.md §15`
- Manual QA section: `docs/QA_CHECKLIST.md §15` (Wave 1 rows already there; Wave 2 GIF picker rows added by `verifier-qa` in PR-1)
- Motion tokens: `client/src/components/pageTransitionUtils.ts` (`PAGE_TRANSITION_MS`, `CPOINT_EASE_OUT`)
- Keyboard plumbing reference: `client/src/pages/CommentReply.tsx` (~lines 350–369, 1500–1520)
