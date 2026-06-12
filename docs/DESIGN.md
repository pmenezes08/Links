# C-Point design system

Canonical reference for product identity, color, motion, and navigation. Code tokens live in [`client/src/index.css`](../client/src/index.css), [`client/tailwind.config.js`](../client/tailwind.config.js), and [`client/src/design/motion.ts`](../client/src/design/motion.ts).

Light mode is **opt-in** — dark remains the default. The full token spec lives in [`docs/LIGHT_MODE_TOKENS.md`](LIGHT_MODE_TOKENS.md).

## Brand narrative

The C-Point logo expresses one idea: meaningful connections emerge from motion, but only become valuable at the right point. The symbol merges a fluid **wave** with a **point**.

| Element | Meaning |
|---------|---------|
| **Wave** | Natural, continuous movement of social interactions and networking |
| **Point** | Presence, context, and the moment a connection becomes meaningful |

**Minimalism** is strategic: few shapes for recognition at app-icon size, in UI, on the landing page, and in pitch materials.

Product name in all user-facing copy: **C-Point** (see [`AGENTS.md`](../AGENTS.md) Branding).

## Color

| Token | Hex | Use |
|-------|-----|-----|
| **C-Point Turquoise** (`--cpoint-turquoise`) | `#00CEC8` | Primary accent — CTAs, links, active states, new UI |
| **App canvas** (`--cpoint-bg-app`) | `#000000` | In-app background (OLED black — intentional) |
| **White** (`--cpoint-white`) | `#FFFFFF` | Primary text on dark |
| **Brand black** (`--cpoint-black-marketing`) | `#0F172A` | Logo decks, external/marketing materials — **not** the in-app canvas |

Turquoise conveys technology, trust, and freshness; black and white add structure and a premium tone.

**Legacy note:** Many screens still use `#4db6ac` (Material teal). Do not add new `#4db6ac` surfaces — use `cpoint-turquoise` / `#00CEC8`. A full backfill is a separate epic.

The four brand tokens above are declared as CSS custom properties in [`client/src/index.css`](../client/src/index.css) `:root` and mirrored as Tailwind colors (`cpoint.turquoise`, `cpoint.bgApp`, `cpoint.white`, `cpoint.blackMarketing`) in [`client/tailwind.config.js`](../client/tailwind.config.js). Glass/accent CSS reads the legacy accent via `rgba(var(--cpoint-accent-rgb), <alpha>)` so the brand-turquoise flip lands in one edit when scheduled.

## Typography

Stack (from [`client/src/index.css`](../client/src/index.css)):

`Inter`, `SF Pro Display`, `SF Pro Text`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif

**AI-authored text renders markdown-lite — raw `**asterisks**` must never reach the screen.** Every surface that displays model output (Steve replies, summaries, onboarding bubbles, Steve's profile view, voice-note summaries) renders `**bold**` as `<strong>` via the shared helpers in [`client/src/utils/linkUtils.tsx`](../client/src/utils/linkUtils.tsx): use `renderTextWithSourceLinks` / `renderRichText` when the text can contain links or @mentions, or the minimal `renderBoldText` for plain blocks (pair it with a `whitespace-pre-wrap` container for line breaks). New AI surfaces must not render model text as a bare string.

## Motion

| Token | Value | Use |
|-------|-------|-----|
| `PAGE_TRANSITION_MS` | 340ms | Push/pop route transitions (chat threads) |
| `TAB_CROSSFADE_MS` | 120ms | Tab cross-fade (Dashboard ↔ Feed ↔ About) |
| `CHAT_KEYBOARD_ANIMATION_MS` | 250ms | Composer / list inset smoothing |
| `CPOINT_EASE_OUT` | `cubic-bezier(0.32, 0.72, 0, 1)` | Native-style deceleration |
| `REDUCED_MOTION_FADE_MS` | 80ms | Reduced-motion fallback: quick opacity fade instead of slide |
| `STEVE_REPLY_DELAY_BASE_MS` / `_PER_CHAR_MS` / `_MIN_MS` / `_MAX_MS` / `_JITTER_MS` / `STEVE_REPLY_BURST_DISCOUNT` | 180ms / 4ms·char / 350ms / 1100ms / 120ms / 0.6 | Steve onboarding reply pacing — length-scaled typing delay: `clamp(BASE + chars×PER_CHAR, MIN, MAX) × (burst ? DISCOUNT : 1) + jitter`. Short acks land fast; long questions read as composed; consecutive bubbles in one burst pay a discounted price so multi-bubble stages never drag. |
| `STEVE_THINKING_SEARCHING_MS` / `_NARROWING_MS` / `_LONG_MS` | 2.5s / 7s / 14s | Networking "Steve is thinking" staged wait line — advance-only, labels crossfade at `TAB_CROSSFADE_MS`, fixed-height so the page scroller never jitters. Recalibrate from `ai_usage_log.response_time_ms`, never by feel; copy must not claim progress the client can't know. |

Canonical values live in [`client/src/design/motion.ts`](../client/src/design/motion.ts) — keep this table in sync when tokens change.

Chat surfaces must not add decorative bubble entrance animations. Layout motion only (keyboard, inset, page stack).

## Asks & CTAs

The ask register. Canonical implementations: the dashboard onboarding reminder card ([`PremiumDashboard.tsx`](../client/src/pages/PremiumDashboard.tsx)) and [`SpotlightAsk.tsx`](../client/src/components/dashboard/SpotlightAsk.tsx).

- **At most one ask per screen.** The onboarding reminder card outranks Steve's spotlight ask; everything else waits its turn.
- **Ask shape is title + one line + one CTA.** No countdowns or deadlines, no progress pills, no per-section status — manufactured urgency and progress framing are banned.
- **Skip/decline is one guilt-free tap** and never re-prompts in the same session.
- **Turquoise fill marks the single primary action per surface.** Secondary doors are turquoise outlines; explainers and reference links are plain text, underlined at rest (touch surfaces have no hover to reveal interactivity). Never dress an explainer as an action pill.
- **Non-interactive content must not wear control grammar.** On this canvas a bordered rounded card with a turquoise icon chip reads as tappable; informational content rendered next to real controls is typography only.

## Navigation

Native-style stack for detail routes (chat first; app-wide rollout later):

| Direction | Animation | When |
|-----------|-----------|------|
| **Push** (forward) | Enter **right → left** | Open DM thread, open group thread from inbox |
| **Pop** (back) | Exit **left → right** | Back button, Android hardware back, `navigate(-1)` |

Tab roots (`/user_chat`, `/home`, `/communities`, …) do **not** stack-animate between each other in the current rollout.

**Chat open:** Chat threads use an **inverted (column-reverse) message list**. The newest message sits at the visual bottom in `scrollTop = 0` coordinates from the very first paint frame — no JS pinning, no reveal timer, no opacity gate. Images decoding in older messages reflow **upward**, so the latest message position is invariant. The scroll-down FAB triggers at `scrollTop > 150`; "Load older" triggers when `scrollHeight - scrollTop - clientHeight < 100`. Composer + keyboard inset is `padding-bottom` on the inverted container.

Prefer `navigate(-1)` for back; fall back to a tab root only on deep links with no history.

## Logo

- App / UI: `/api/public/logo` (see [`client/index.html`](../client/index.html))
- Do not distort the wave/point relationship
- Monochrome variants on dark backgrounds for in-app chrome

## Related docs

- Chat scroll / FAB: [`.cursor/rules/chat-surfaces.mdc`](../.cursor/rules/chat-surfaces.mdc), [`docs/QA_CHECKLIST.md`](QA_CHECKLIST.md) §14
- Agent guardrails: [`.cursor/rules/design-system.mdc`](../.cursor/rules/design-system.mdc)
