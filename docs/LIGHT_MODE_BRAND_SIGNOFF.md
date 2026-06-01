# Light Mode — Brand Sign-off

Authoritative brand reference for the C-Point light mode implementation.
Issued by Brand Specialist; supersedes informal chat approvals.

**Status:** ✅ Approved with conditions  
**Date:** 2026-05-30  
**Epic:** Light mode (opt-in user preference; dark remains default)

---

## 1. Brand Alignment Confirmation

### Does light mode preserve "premium private network" positioning?

**Yes — with discipline.** Premium is not dark-exclusive; it's a function of
restraint, whitespace, and hierarchy. The approved palette (`#FAFBFC` canvas)
is a cool off-white — quiet enough to feel intentional, not a generic "white
app." The critical variable is _not_ the background color, but the absence of
visual noise: no card borders fighting the turquoise, no drop-shadow soup, no
playful gradients that dilute calm authority.

Light mode ships because users in daytime contexts (PT-market in Lisbon cafés,
mobile in direct sunlight) asked for it. The invite-only, micro-community
positioning is communicated by copy, navigation structure, and gating — not by
a black canvas alone.

### Does turquoise remain the singular brand anchor?

**Yes.** `#00CEC8` (fills, CTAs, active states) is unchanged between themes.
The derived accent `#009E99` is allowed for text-on-light only (sufficient
WCAG 4.5:1 contrast on `#FAFBFC`). No secondary accent colors are introduced.
The turquoise wave/point remains the only color with semantic meaning.

---

## 2. Steve Gradient Decision

### Decision: **Option B — Flat `#FAFBFC` surface** for Steve/chat threads in light mode

### Rationale

| Factor | Assessment |
|--------|------------|
| **Brand precedent** | The dark-mode `--glass-gradient` (turquoise + indigo radials on `#020202`) works because subtle radials on near-black feel like _depth_ — a void with presence. On a light surface, the same approach reads as "watercolor wash" — decorative, not structural. |
| **Premium tone** | C-Point's brand is about clarity, not texture. A curated light gradient (Option A) introduces a subjective aesthetic call that risks feeling dated within months and forces every screen element to compete with a colored background. |
| **Engineering simplicity** | Flat surface = fewer accessibility edge cases (text contrast over gradient hotspots), simpler dark/light toggle logic, fewer designer QA cycles. |
| **Steve distinction** | In dark mode Steve threads feel "atmospheric" via the glass gradient. In light mode Steve threads should feel "clean and open" — flat canvas achieves this naturally. Steve's identity in light mode comes from the turquoise sent-bubble and the AI badge, not from a background treatment. |

### Implementation guidance

```css
/* Light mode override for chat threads */
[data-theme="light"] .chat-thread-bg {
  background: var(--cpoint-bg-app); /* resolves to #FAFBFC in light */
}
```

The dark-mode `--glass-gradient` remains untouched. Light mode simply does not
inherit it. If a future design epic (e.g., "ambient surfaces") revisits
atmospheric backgrounds, it will be a separate brand review.

---

## 3. Logo Treatment

| Context | Variant | Detail |
|---------|---------|--------|
| **Header / nav bar (light mode)** | Turquoise mark (`#00CEC8`) | Same as dark mode — turquoise on any canvas maintains brand presence |
| **Splash screen (light bg)** | Turquoise mark + Brand black wordmark (`#0F172A`) | The only sanctioned use of brand black in-app — splash is a marketing-adjacent moment |
| **App icon** | Unchanged — turquoise wave/point on dark | The icon is an OS asset, not theme-responsive |
| **Empty states / large brand moments** | Turquoise mark, no wordmark | Keep minimalist; do not introduce grey or inverted logos |

### Rules

- **Never** display the logo in pure black (`#000`) on a light background — use
  brand black `#0F172A` when a dark logo is needed for contrast.
- **Never** introduce a new grey-tinted logo variant. Turquoise is the mark; if
  it doesn't work visually, the surrounding surface is wrong.
- Logo file source remains `/api/public/logo` — theme-specific variants (if
  needed) are handled by CSS filter or a `?variant=` param, not by duplicating
  the asset.

---

## 4. Copy for UI

### Onboarding modal — "Choose your appearance" section

> **Appearance**
>
> Dark is the default C-Point experience. You can switch to Light if you
> prefer a brighter interface.
>
> [● Dark] [○ Light]

- No "theme" jargon — users understand "appearance."
- Frame dark as default and preferred (preserving brand anchor without forcing).
- No helper text below the toggle; the choice is self-explanatory.

### Account Settings — "Appearance" row

| Element | Value |
|---------|-------|
| Section heading | **Appearance** |
| Row label | **Mode** |
| Options | **Dark** · **Light** |
| Default | Dark (pre-selected) |
| Helper text | None required |

- Do not label options "Dark mode" / "Light mode" — drop "mode," it's redundant
  when the section is already called Appearance.
- Do not add "System" as a third option in v1; revisit if user research demands it.

### pt-PT (Portuguese — tu form)

> **Aparência**
>
> O tema escuro é a experiência padrão do C-Point. Podes mudar para Claro
> se preferires uma interface mais luminosa.
>
> [● Escuro] [○ Claro]

---

## 5. Conditions for Ship (non-negotiable)

1. **Dark is always default.** New accounts, onboarding first paint, and any
   state-loss scenario must resolve to dark. Light is opt-in only.

2. **Turquoise (`#00CEC8`) is invariant.** The fill/accent color must not shift
   between themes. Only text-on-light may use the derived `#009E99` for
   contrast compliance.

3. **No new accent colors.** The light palette does not introduce pastels, warm
   tones, or a second brand color. If a surface needs differentiation, use
   opacity and the neutral scale.

4. **Canvas is `#FAFBFC`, not pure white.** Pure `#FFFFFF` as a canvas background
   is not approved. `#FFFFFF` is for text on dark and for explicit white elements
   (card faces inside a light layout).

5. **Brand black (`#0F172A`) stays out of in-app canvases.** It is allowed for
   text in light mode (`#0F1419` — near-identical for body text) and for the
   splash wordmark. It is not a light-mode surface color.

6. **No `#4db6ac` migration in this epic.** Light mode ships with existing
   turquoise tokens. The legacy teal backfill is a separate body of work.

7. **Motion unchanged.** No new easing curves, no light-mode-specific animations.

8. **Steve gradient: flat in light mode.** Do not port the dark-mode glass
   gradient to a light-mode equivalent in this epic.

9. **Toggle persists per-user.** The preference must survive app restarts and
   re-authentication. Store in user settings (Firestore or local + sync).

10. **QA on both themes before merge.** Every PR touching themed surfaces must
    screenshot both modes in the PR description. Verifier-QA checks both.

---

## 6. Anti-patterns Checklist

Engineers must avoid the following:

| Anti-pattern | Why it's wrong |
|--------------|----------------|
| Hard-coding `#000` or `#FAFBFC` instead of using CSS custom properties / Tailwind tokens | Breaks theming toggle; forces find-replace on every palette change |
| Introducing `#0F172A` as a light-mode canvas or card background | Brand black is marketing-only; use `#FAFBFC` canvas or `#F4F5F7` card surfaces |
| Adding a light-mode glass gradient without brand review | Violates § 2 decision (flat surface for light) |
| Using pure `#FFFFFF` as the body/canvas background | Too harsh; approved canvas is `#FAFBFC` |
| Creating new `#4db6ac` surfaces "because they look better on light" | Legacy teal is banned in all new work, regardless of theme |
| Changing the dark-mode gradient or glass tokens in this PR | Dark mode is stable; light mode is additive only |
| Adding "System" theme option without product sign-off | Scope creep; v1 is Dark/Light only |
| Using opacity-based text instead of the approved text-color scale | Results in inconsistent contrast ratios across surfaces |
| Bouncy or decorative transitions on theme switch | Motion tokens are theme-invariant; transition is instant or a single 200ms cross-fade |
| Shipping a light-mode screen without a dark-mode counterpart tested | Every themed surface must work in both modes |
| Adding `prefers-color-scheme` media query to auto-switch | User preference is explicit; do not read OS setting in v1 |

---

## 7. Final Sign-off Statement

**✅ Approved for implementation.**

Light mode for C-Point is on-brand when implemented under the conditions above.
The palette preserves premium restraint, turquoise remains the sole accent, and
the dark-default contract ensures brand consistency for new users and marketing
materials.

The Steve chat gradient decision (flat `#FAFBFC` in light mode) is final for
this epic. Any future atmospheric treatment requires a separate brand review.

Ship it. Dark stays home. Light earns its place.

---

*Signed: Brand Specialist — C-Point*  
*Paired with: platform-designer (token spec), c-point-lead (epic coordination)*
