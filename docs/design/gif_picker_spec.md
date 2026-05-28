# GIF Picker Rebuild — Design Spec

**Pilot Wave 2 — Composer & Profile Polish**

| Field | Value |
|-------|-------|
| Owner | platform-designer |
| Implements | thread-engineer (sheet + grid), capacitor-ux-polish (haptics) |
| File | `client/src/components/GifPicker.tsx` |
| Public API | `isOpen`, `onClose`, `onSelect(GifSelection)` — **unchanged** |
| Motion tokens | `client/src/design/motion.ts` |
| Surface tokens | `.liquid-glass-surface` in `client/src/index.css:157-174` |
| Keyboard pattern ref | `client/src/pages/CommentReply.tsx:349-374` (visualViewport lift) |
| Composer input ref | `client/src/pages/CommentReply.tsx:1502-1515` (border / sizing baseline) |

---

## 1  Problem & user goal

Users picking a GIF from inside a composer (chat, post, reply) see a
floating centered card that clips behind the soft keyboard and feels
visually disconnected from the composer it serves. The rebuild makes the
picker feel like a native extension of the composer — anchored, keyboard-
aware, and using the same glass surface language as the rest of the app.

## 2  Surfaces affected

| Surface | File |
|---------|------|
| GIF Picker component | `client/src/components/GifPicker.tsx` |
| Comment reply composer | `client/src/pages/CommentReply.tsx` |
| Post creator | `client/src/pages/CreatePost.tsx` |
| Community feed composer | `client/src/pages/CommunityFeed.tsx` |
| Post detail composer | `client/src/pages/PostDetail.tsx` |
| Chat thread composer | `client/src/pages/ChatThread.tsx` |
| Group chat composer | `client/src/pages/GroupChatThread.tsx` |

Callers pass `isOpen`, `onClose`, `onSelect` only — none are modified.

## 3  IA & flow

```
Composer → tap GIF button → sheet slides up from bottom
  → user searches / browses trending → taps tile → onSelect fires → sheet dismisses
  → tap outside / swipe down / Esc → sheet dismisses without selection
```

Focus returns to the opener element (GIF button) on dismiss.

## 4  Form factor

### Mobile (≤ 640 px)

- **Full-width bottom sheet**, no horizontal margin.
- Rounded **top corners only**: `rounded-t-2xl`.
- No drop shadow (the glass surface and border are sufficient).
- **Drag handle**: centered 28 × 4 px pill, `bg-white/20`, `rounded-full`,
  `mt-2 mb-1`.

### Tablet / desktop (> 640 px)

- `max-w-2xl` centered horizontally, still bottom-anchored.
- Same rounded-top treatment, same drag handle (allows mouse-drag dismiss too).

## 5  Keyboard handling

Subscribe to `window.visualViewport` resize and scroll events using the
same RAF-throttled pattern established in **CommentReply.tsx:349-374**:

```
keyboardLiftPx = max(0, innerHeight - viewport.height - viewport.offsetTop)
```

The sheet positions itself via:

```
bottom = composerHeightPx + keyboardLiftPx
```

When `isOpen` becomes `false`, the sheet translates offscreen below the
viewport. The `visualViewport` listeners attach on open and clean up on
close (including cancelling any pending `requestAnimationFrame`).

This ensures the grid never scrolls under the soft keyboard on iOS or
Android.

## 6  Surface & overlay

| Element | Treatment |
|---------|-----------|
| Sheet background | `liquid-glass-surface` (inherits `--glass-base`, `backdrop-filter: blur(32px) saturate(160%)`, highlight gradient `::before`) |
| Sheet border | `border-t border-white/8` — **no** left, right, or bottom borders |
| Backdrop overlay | `bg-black/40 backdrop-blur-sm`, covers the area **above** the sheet only (from top of viewport to sheet top edge) |
| Tap on overlay | calls `onClose` |

## 7  Search row (sticky top of sheet)

The search row is `sticky top-0 z-10` inside the sheet scroll container,
with the same glass background to prevent content bleed-through.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ 🔍 Search GIFs…                      ✕   via GIPHY     │
│  ↑ magnifier   ↑ input               ↑clear  ↑attrib   │
└─────────────────────────────────────────────────────────┘
```

### Input

Matches the composer input baseline from **CommentReply.tsx:1502-1515**:

- Container: `min-h-9 rounded-lg border border-white/15 bg-white/8 flex items-center`
- On focus: `border-[#4db6ac]` (brand teal focus ring)
- Text: `text-[13px] text-white placeholder-white/40 bg-transparent outline-none`
- Leading icon: `fa-magnifying-glass`, `text-[12px] text-white/45`, `ml-2.5`
- Trailing clear button: `NativeIconButton` (from
  `client/src/components/NativeIconButton.tsx`), shown only when `query`
  is non-empty, `size="sm"`, `variant="muted"`

### GIPHY attribution

Right-aligned inside the search row:

- Text: `via GIPHY`
- Style: `text-[10px] text-white/35 tracking-wide uppercase shrink-0 ml-2 mr-2`
- Satisfies GIPHY attribution requirement without needing a separate footer,
  keeping the sheet compact.

## 8  Grid

### Columns

| Breakpoint | Columns |
|------------|---------|
| Mobile (< 640 px) | `grid-cols-4 gap-1.5` |
| Tablet (≥ 640 px, < 768 px) | `grid-cols-5 gap-1.5` |
| Desktop (≥ 768 px) | `grid-cols-6 gap-1.5` |

Tailwind: `grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6`

### Tile

- Aspect ratio: `aspect-[4/3]`
- Border radius: `rounded-md`
- Overflow: `overflow-hidden`
- Image: `object-cover w-full h-full`, `loading="lazy"`, `decoding="async"`
- Hover overlay: `bg-black/30` with opacity transition (150 ms)
- Focus ring: `focus-visible:ring-2 focus-visible:ring-[#4db6ac] focus-visible:ring-offset-1 focus-visible:ring-offset-transparent`

### IntersectionObserver — GIF pause/resume

GIF tiles that scroll out of the visible sheet viewport should **not**
continue decoding. Use a single `IntersectionObserver` (threshold 0,
root = grid scroll container):

- **Off-screen**: swap `img.src` to a 1 × 1 transparent data-URI
  placeholder; store the real `src` in a `data-src` attribute.
- **On-screen**: restore `img.src` from `data-src`.

This reduces decode cost and memory pressure on long trending lists.

## 9  States

| State | Condition | Rendering |
|-------|-----------|-----------|
| **Trending** | `query` is empty, data loaded | Header text: **"Trending"** (`text-[11px] font-medium uppercase tracking-wider text-white/50 px-1 pb-1.5`) above the grid |
| **Search results** | `query` non-empty, data loaded | Header text: **"Results for {query}"** (same style, query truncated at 30 chars with `…`) |
| **Loading** | `loading === true` | 12 skeleton placeholder tiles in the grid layout. Each skeleton: `rounded-md aspect-[4/3] bg-white/8 animate-pulse` |
| **Error** | `error` truthy | Single-line inline message **above** the grid area: `text-[12px] text-red-400/90 px-2 py-2`. Not a full-screen takeover. Grid remains (empty or stale results below). |
| **Empty** | Results array length 0, not loading, no error | Centered text: **"No GIFs found"** (`text-[13px] text-white/50 py-12 text-center`) |

## 10  Heights

| Property | Value |
|----------|-------|
| Target height | 60 % of `visualViewport.height` |
| Minimum | `320px` |
| Maximum | `560px` |
| Computed | `clamp(320px, 60vh, 560px)` — but use `visualViewport.height` for the 60 % calculation, not CSS `vh`, to account for the keyboard |

The grid area scrolls inside the sheet. The search row is sticky. The
sheet itself does not scroll within the page — it is fixed-position.

## 11  Motion

All durations and easings from `client/src/design/motion.ts`.

### Open

```
transform: translateY(100%) → translateY(0)
duration: PAGE_TRANSITION_MS (250 ms)
easing:   CPOINT_EASE_OUT (cubic-bezier(0.32, 0.72, 0, 1))
```

Backdrop overlay fades in over the same duration (`opacity: 0 → 1`).

### Close

Reverse of open: `translateY(0) → translateY(100%)`, same duration and easing.

### Reduced motion

When `prefers-reduced-motion: reduce` is active:

- No slide. Instead, `opacity: 0 → 1` over `REDUCED_MOTION_FADE_MS` (80 ms).
- Backdrop overlay follows the same 80 ms opacity fade.

### Grid tile hover

`opacity` transition, 150 ms, `ease-out`. No layout-property animations.

## 12  Drag-to-dismiss

The drag handle and the search row header area are the drag affordance.

| Gesture | Behavior |
|---------|----------|
| Pull down | Sheet translates 1:1 with finger/pointer Y delta |
| Release < 30 % of sheet height AND velocity < 600 px/s | Spring back to fully open, using `PAGE_TRANSITION_MS` + `CPOINT_EASE_OUT` |
| Release ≥ 30 % of sheet height OR velocity ≥ 600 px/s | Dismiss: complete the slide to `translateY(100%)`, then call `onClose` |

During drag, backdrop overlay opacity scales linearly with sheet position
(fully open = 1, fully dismissed = 0).

Reduced motion: drag still moves the sheet (it's direct manipulation),
but the spring-back or dismiss completion uses a 80 ms opacity crossfade
instead of sliding.

## 13  Haptics hooks

Three haptic hook points for `capacitor-ux-polish` to wire in a separate
PR step. The GIF picker spec **identifies** them but does **not** implement
the native calls.

| Hook | Trigger | Suggested feel |
|------|---------|----------------|
| `haptic:sheet-open` | Sheet open animation starts | Light impact |
| `haptic:gif-select` | User taps a GIF tile | Medium impact |
| `haptic:sheet-dismiss` | Sheet dismiss completes (swipe or tap-outside) | Light impact |

Implementation note: expose these as callback props or inline comments
at the call sites so `capacitor-ux-polish` can drop in
`Haptics.impact()` without refactoring control flow.

## 14  Accessibility

| Requirement | Implementation |
|-------------|----------------|
| Role | `role="dialog"` on the sheet container |
| Modal | `aria-modal="true"` |
| Label | `aria-label="GIF picker"` |
| Focus on open | Auto-focus the search input (`autoFocus` or programmatic `.focus()` after open animation settles) |
| Focus on close | Restore focus to the element that triggered the picker (the GIF button in the composer) |
| Escape | `keydown` listener on `Escape` calls `onClose` (already exists — preserve) |
| Touch targets | All tile buttons ≥ 44 × 44 px effective area (the 4:3 aspect tiles at `grid-cols-4` on 375 px width ≈ 88 px wide — compliant) |
| Contrast | Header text `white/50` on glass background meets AA for large text; error text `red-400` on dark glass exceeds 4.5:1 |
| Screen reader | Each tile: `alt` text = "GIF" or GIPHY title if available; clear button: `aria-label="Clear search"` |
| Reduced motion | Covered in § 11 |

## 15  Responsive behavior

| Viewport | Sheet width | Columns | Position |
|----------|-------------|---------|----------|
| ≤ 640 px (mobile) | 100 % | 4 | Full-width bottom sheet |
| 641–767 px (small tablet) | `max-w-2xl` centered | 5 | Centered bottom sheet |
| ≥ 768 px (desktop/tablet) | `max-w-2xl` centered | 6 | Centered bottom sheet |

On all breakpoints the sheet is bottom-anchored and keyboard-aware.
Landscape orientation: sheet max-height capped at `560px`; the 60 %
calculation naturally shrinks on shorter viewports.

## 16  Consistency checklist

| Surface | Alignment |
|---------|-----------|
| **Feed composer** | Sheet anchors above the same composer row; teal focus ring matches `CommentReply` input (`:1502`) |
| **Chat composer** | Same bottom-anchor pattern; glass surface matches `ChatThread` context menu (`:2711`) |
| **Profile / modals** | `liquid-glass-surface` used by `PremiumDashboard` sidebar, `EventDetail` panels, `FeedBottomNav` — picker joins the same family |
| **Navigation** | Backdrop overlay (`bg-black/40`) consistent with existing modal overlays; no new overlay pattern |
| **Steve AI blocks** | Not affected — GIF picker is a compositor-level component, not an AI surface |

## 17  Implementation handoff

| Task | Owner | Notes |
|------|-------|-------|
| Sheet container, open/close, keyboard lift, grid, states, search row | **thread-engineer** | Rewrite `GifPicker.tsx` internals; preserve the exported API and `GifSelection` type |
| Drag-to-dismiss gesture | **thread-engineer** | Pointer events on handle/header, velocity calc, spring-back |
| `IntersectionObserver` GIF pause | **thread-engineer** | Single observer instance, cleanup on unmount |
| Haptic wiring at the three hook points | **capacitor-ux-polish** | Separate PR after the visual rebuild lands |
| Focus management (trap, restore) | **thread-engineer** | Use existing `onClose` callback path |
| Reduced-motion CSS / JS branch | **thread-engineer** | `matchMedia('(prefers-reduced-motion: reduce)')` |

### Key files to touch

- `client/src/components/GifPicker.tsx` — full rewrite of the JSX and styles; logic (`loadGifs`, debounce, API key fetch) stays as-is.
- `client/src/design/motion.ts` — import only; no changes needed.
- `client/src/index.css` — no changes needed (`.liquid-glass-surface` already defined).

## 18  QA checklist

- [ ] Sheet appears above composer on mobile (375 px, 390 px, 430 px widths)
- [ ] Keyboard open on iOS Safari: sheet lifts, grid bottom row visible
- [ ] Keyboard open on Android Chrome: same lift behavior
- [ ] Tap outside dismisses; `Esc` dismisses; swipe-down dismisses
- [ ] Drag < 30 % springs back smoothly
- [ ] Drag ≥ 30 % or fast flick dismisses
- [ ] Trending loads on open; search debounces at 300 ms
- [ ] Error state shows inline message, not a takeover
- [ ] Empty state centered text
- [ ] Loading state shows 12 skeleton tiles
- [ ] GIF tiles pause when scrolled out of view (verify via DevTools network or `img.src` inspection)
- [ ] `via GIPHY` attribution visible in search row
- [ ] Focus moves to search input on open
- [ ] Focus returns to GIF button on close
- [ ] Reduced motion: 80 ms opacity fade, no slide
- [ ] Tablet (768 px+): `max-w-2xl`, 6-column grid
- [ ] `role="dialog"`, `aria-modal="true"`, `aria-label` present in DOM
- [ ] All callers (6 pages) still work with no prop changes

---

## Out of scope

- **No changes** to GIPHY API, proxy route, or `loadGifs` / API-key-fetch logic.
- **No changes** to the 6 caller pages — the public API (`isOpen`, `onClose`, `onSelect`) is frozen.
- **No haptic implementation** — `capacitor-ux-polish` wires `Haptics.impact()` in a follow-up PR; this spec only identifies the hook points.

---

## Brand sign-off — PR-1 GIF picker

**Reviewer:** brand-specialist · **Date:** 2026-05-28
**Verdict:** PASS_WITH_ADJUSTMENTS

### 1  GIPHY attribution lockup

| Check | Result |
|-------|--------|
| Wording (`via GIPHY`) | ✓ Acceptable. GIPHY's API terms allow text-only attribution; "via GIPHY" is used by major integrators (WhatsApp, Slack) and is the least intrusive form on C-Point's quiet dark surfaces. The full "Powered by GIPHY" logo lockup is preferred by GIPHY but not mandated for inline placement — acceptable to defer the logo variant unless GIPHY compliance review objects. |
| Color contrast (`text-white/35` on glass) | ⚠ **Borderline.** Effective contrast ≈ 2.8:1 against the near-black glass backdrop, which falls below the 3:1 threshold for non-decorative text. "GIPHY" as a logotype is exempt (WCAG SC 1.4.3), but the word "via" is not. **Proposed fix:** bump to `text-white/40` (≈ 3.2:1) — still visually quiet, clears the threshold. |
| Position stability (long query text) | ✓ Pass. The attribution span is `shrink-0 ml-2 mr-2`; the search input is `flex-1 min-w-0` so it clips/ellipses before the attribution is displaced. Attribution remains visible at any query length. |

### 2  C-Point visual cohesion

| Element | Result |
|---------|--------|
| Drag handle (28×4 px, `bg-white/20`, `rounded-full`) | ✓ Pass. Standard iOS-idiomatic sheet affordance; `white/20` on glass gives appropriate subtle visibility without competing with content. Matches the quiet, premium feel. |
| Section labels (`text-[11px] font-medium uppercase tracking-wider text-white/55`) | ⚠ **Slightly bright.** App-wide secondary labels (Profile interests, ChatThread reminder labels, SettingsSection headers) sit at `white/28` – `white/45`. The picker's `white/55` + `font-medium` makes it the brightest secondary label in the system. **Proposed fix:** drop to `text-white/45` and remove `font-medium` to align with `ChatThread` label treatment (`text-[11px] uppercase tracking-wide text-white/45`). |
| Tile aspect (`aspect-[4/3]`, `rounded-md`, `overflow-hidden`) | ✓ Pass. Consistent with the 4:3 aspect used in PostDetail attachment previews and ChatMedia thumb layout. `rounded-md` matches the app's small-radius utility surface pattern. No `border-white/10` is applied — cleaner than the spec's suggestion and aligns with other media grids that rely on gap spacing instead of tile borders. |
| Search input focus ring (`focus-within:border-[#4db6ac]`) + tile focus ring (`focus-visible:ring-[#4db6ac]`) | ⚠ **Brand rule deviation.** `docs/DESIGN.md` states: "Do not add new `#4db6ac` surfaces — use `#00CEC8`." The GIF picker is rebuilt code (new surface). However, it appears directly adjacent to the CommentReply composer input (line 1502) which already carries `border-[#4db6ac]`. Shipping `#00CEC8` on the picker while the companion composer remains `#4db6ac` creates a visible mismatch within the same interaction. **Recommendation:** accept `#4db6ac` in PR-1 to maintain intra-flow consistency, but add a tracked debt item to migrate both the GIF picker and CommentReply composer focus rings to `#00CEC8` in the accent-backfill epic. This is not a blocker — it's an acknowledged known-debt exception. |
| Empty state copy (`"No GIFs found"`) | ⚠ **Bland.** Does not match C-Point's warm, direct voice. **Proposed replacement:** `"Nothing matched — try a different search"` (concise, helpful, human, avoids generic "not found" phrasing). Update the `t('shared.no_gifs_found')` i18n string accordingly (en fallback in code). |

### 3  Brand string audit

| Check | Result |
|-------|--------|
| `CPoint` / `C.Point` / `C Point` / `Cpoint` occurrences | ✓ **Zero matches.** The product name does not (and should not) appear in this component. Clean. |

### 4  Motion token alignment

| Check | Result |
|-------|--------|
| Open/close uses `PAGE_TRANSITION_MS` (250ms) + `CPOINT_EASE_OUT` | ✓ Imported from `client/src/design/motion.ts`; values match spec. |
| Reduced-motion path uses `REDUCED_MOTION_FADE_MS` (80ms) | ✓ |
| No bouncy/spring/playful easing | ✓ Deceleration only. Aligns with brand motion rule (native-style, purposeful). |
| Tile hover overlay 150ms ease | ✓ Non-layout opacity transition; minimal, inoffensive. |

### Summary of adjustments (for `thread-engineer` if escalated)

| # | Severity | Change |
|---|----------|--------|
| 1 | Minor | `line 600`: change `text-white/35` → `text-white/40` on GIPHY attribution span. |
| 2 | Minor | `line 606`: change `text-[11px] font-medium uppercase tracking-wider text-white/55` → `text-[11px] uppercase tracking-wide text-white/45`. |
| 3 | Minor | `line 676` (empty state fallback): change `'No GIFs found'` → `'Nothing matched — try a different search'`. Update `t('shared.no_gifs_found')` en locale to match. |
| 4 | Tracked debt | `#4db6ac` on lines 574 + 646: accepted for PR-1 intra-flow consistency. Log debt item for accent-backfill epic (picker + CommentReply composer → `#00CEC8`). |

### Sign-off

**PASS_WITH_ADJUSTMENTS** — no blocking brand issues. Items 1–3 are cosmetic
copy/contrast tweaks safe to apply in the same PR before merge. Item 4 is
accepted debt tracked outside this PR.
