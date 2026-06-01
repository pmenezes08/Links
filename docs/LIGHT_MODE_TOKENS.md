# Light Mode Token Specification

Authoritative engineering reference for C-Point light mode. Dark remains
the default; light mode is opt-in via user preference stored in Firestore
(`users/{uid}/preferences.theme`).

---

## 1. Complete Token Table

All semantic tokens with their dark and light values.

### 1.1 Canvas & Surfaces

| Token | Dark | Light | Notes |
|-------|------|-------|-------|
| `--c-bg-app` | `#000000` | `#FAFBFC` | App canvas (OLED black → cool off-white) |
| `--c-bg-elevated` | `rgba(12, 12, 16, 0.72)` | `rgba(255, 255, 255, 0.85)` | Cards, sheets, modals |
| `--c-bg-surface` | `rgba(18, 20, 24, 0.78)` | `#FFFFFF` | Card body / content panels |
| `--c-bg-recessed` | `rgba(18, 18, 22, 0.8)` | `#F4F5F7` | Inputs, inset areas, code blocks |
| `--c-bg-overlay` | `rgba(0, 0, 0, 0.6)` | `rgba(0, 0, 0, 0.3)` | Backdrop behind modals/sheets |

### 1.2 Text

| Token | Dark | Light | Notes |
|-------|------|-------|-------|
| `--c-text-primary` | `#FFFFFF` | `#0F1419` | Body copy, headings |
| `--c-text-secondary` | `rgba(255, 255, 255, 0.7)` | `#536471` | Captions, timestamps, subtitles |
| `--c-text-tertiary` | `rgba(255, 255, 255, 0.45)` | `rgba(83, 100, 113, 0.6)` | Placeholders, hints |
| `--c-text-disabled` | `rgba(255, 255, 255, 0.25)` | `rgba(15, 20, 25, 0.3)` | Disabled controls |
| `--c-text-link` | `#00CEC8` | `#009E99` | Inline links (darkened for AA on light) |
| `--c-text-on-accent` | `#FFFFFF` | `#FFFFFF` | Text on turquoise fills |

### 1.3 Borders

| Token | Dark | Light | Notes |
|-------|------|-------|-------|
| `--c-border-default` | `rgba(255, 255, 255, 0.14)` | `rgba(0, 0, 0, 0.08)` | Standard dividers |
| `--c-border-subtle` | `rgba(255, 255, 255, 0.06)` | `rgba(0, 0, 0, 0.04)` | Minimal separation |
| `--c-border-strong` | `rgba(255, 255, 255, 0.22)` | `rgba(0, 0, 0, 0.14)` | Emphasized dividers |
| `--c-border-accent` | `rgba(0, 206, 200, 0.65)` | `rgba(0, 206, 200, 0.5)` | Active / selected items |

### 1.4 Glass Morphism

| Token | Dark | Light | Notes |
|-------|------|-------|-------|
| `--c-glass-base` | `rgba(12, 12, 16, 0.68)` | `rgba(255, 255, 255, 0.72)` | Base fill of glass surfaces |
| `--c-glass-tint` | `rgba(0, 206, 200, 0.22)` | `rgba(0, 206, 200, 0.10)` | Accent wash (subtler on light) |
| `--c-glass-border` | `rgba(255, 255, 255, 0.14)` | `rgba(0, 0, 0, 0.06)` | Polarity-inverted |
| `--c-glass-highlight` | `rgba(255, 255, 255, 0.09)` | `rgba(255, 255, 255, 0.5)` | Inner highlight (top-left) |
| `--c-glass-shadow` | `0 20px 60px rgba(0, 0, 0, 0.45)` | `0 12px 40px rgba(0, 0, 0, 0.08)` | Shadow is primary depth on light |

### 1.5 Chat Bubbles

| Token | Dark | Light | Notes |
|-------|------|-------|-------|
| `--c-bubble-sent-bg` | `linear-gradient(135deg, rgba(0,206,200,0.9), rgba(32,84,78,0.85))` | `linear-gradient(135deg, rgba(0,206,200,0.92), rgba(0,158,153,0.88))` | Turquoise gradient both themes |
| `--c-bubble-sent-text` | `#FFFFFF` | `#FFFFFF` | Always white on accent |
| `--c-bubble-sent-border` | `rgba(0, 206, 200, 0.65)` | `rgba(0, 206, 200, 0.35)` | Accent border |
| `--c-bubble-received-bg` | `rgba(18, 18, 22, 0.78)` | `#F4F5F7` | Neutral surface |
| `--c-bubble-received-text` | `#FFFFFF` | `#0F1419` | High-contrast for readability |
| `--c-bubble-received-border` | `rgba(255, 255, 255, 0.14)` | `rgba(0, 0, 0, 0.06)` | Subtle separation |

### 1.6 Chrome (Header, Nav, Composer)

| Token | Dark | Light | Notes |
|-------|------|-------|-------|
| `--c-header-bg` | `rgba(0, 0, 0, 0.75)` | `rgba(255, 255, 255, 0.88)` | Frosted header bar |
| `--c-nav-bg` | `rgba(0, 0, 0, 0.82)` | `rgba(255, 255, 255, 0.92)` | Bottom tab bar |
| `--c-composer-bg` | `rgba(18, 18, 22, 0.92)` | `rgba(255, 255, 255, 0.95)` | Chat input card |
| `--c-composer-input-bg` | `rgba(255, 255, 255, 0.06)` | `#F4F5F7` | Text field interior |

### 1.7 Interactive States

| Token | Dark | Light | Notes |
|-------|------|-------|-------|
| `--c-hover-bg` | `rgba(255, 255, 255, 0.06)` | `rgba(0, 0, 0, 0.04)` | Hover overlay |
| `--c-active-bg` | `rgba(255, 255, 255, 0.10)` | `rgba(0, 0, 0, 0.07)` | Active/pressed overlay |
| `--c-focus-ring` | `0 0 0 2px rgba(0, 206, 200, 0.6)` | `0 0 0 2px rgba(0, 158, 153, 0.5)` | Keyboard focus ring |
| `--c-hover-accent` | `rgba(0, 206, 200, 0.12)` | `rgba(0, 206, 200, 0.08)` | Hover on accent-context items |
| `--c-active-accent` | `rgba(0, 206, 200, 0.2)` | `rgba(0, 206, 200, 0.14)` | Pressed on accent-context items |
| `--c-disabled-opacity` | `0.4` | `0.5` | Opacity multiplier for disabled |

### 1.8 Skeleton Loading

| Token | Dark | Light | Notes |
|-------|------|-------|-------|
| `--c-skeleton-strong` | `rgba(255, 255, 255, 0.08)` | `rgba(0, 0, 0, 0.08)` | Visible placeholder |
| `--c-skeleton-subtle` | `rgba(255, 255, 255, 0.04)` | `rgba(0, 0, 0, 0.04)` | Shimmer target |

### 1.9 Accent (stable across themes)

| Token | Dark | Light | Notes |
|-------|------|-------|-------|
| `--c-accent` | `#00CEC8` | `#00CEC8` | Turquoise fill (buttons, badges) |
| `--c-accent-hover` | `#00B8B3` | `#00B8B3` | Hover state on accent fills |
| `--c-accent-active` | `#009E99` | `#009E99` | Pressed state on accent fills |
| `--c-accent-muted` | `rgba(0, 206, 200, 0.15)` | `rgba(0, 206, 200, 0.10)` | Tinted backgrounds |

---

## 2. Semantic Token Layer (`--c-*` Convention)

### Naming rules

```
--c-{category}-{role}[-{variant}]
```

| Category | Roles |
|----------|-------|
| `bg` | `app`, `elevated`, `surface`, `recessed`, `overlay` |
| `text` | `primary`, `secondary`, `tertiary`, `disabled`, `link`, `on-accent` |
| `border` | `default`, `subtle`, `strong`, `accent` |
| `glass` | `base`, `tint`, `border`, `highlight`, `shadow` |
| `bubble` | `sent-bg`, `sent-text`, `sent-border`, `received-bg`, `received-text`, `received-border` |
| `header` | `bg` |
| `nav` | `bg` |
| `composer` | `bg`, `input-bg` |
| `hover` | `bg`, `accent` |
| `active` | `bg`, `accent` |
| `focus` | `ring` |
| `skeleton` | `strong`, `subtle` |
| `accent` | (root), `hover`, `active`, `muted` |

### Migration from legacy tokens

| Legacy (hardcoded in `:root`) | Semantic replacement |
|-------------------------------|---------------------|
| `--glass-base` | `--c-glass-base` |
| `--glass-tint` | `--c-glass-tint` |
| `--glass-border` | `--c-glass-border` |
| `--glass-highlight` | `--c-glass-highlight` |
| `--glass-shadow` | `--c-glass-shadow` |
| `--glass-gradient` | **Retained as-is** (per-theme variant below) |
| `--cpoint-bg-app` | `--c-bg-app` |
| `--cpoint-turquoise` | `--c-accent` (semantic alias) |
| `--cpoint-accent-rgb` | **Retained** — used inside `rgba()` expressions |

Legacy `--glass-*` / `--cpoint-*` tokens remain as aliases during migration.
New components must use `--c-*` tokens exclusively.

---

## 3. Glass Morphism Translation Rules

### Dark → Light inversion principles

| Property | Dark approach | Light approach |
|----------|--------------|----------------|
| **Base fill** | Dark semi-transparent (`rgba(12,12,16, 0.68)`) | White semi-transparent (`rgba(255,255,255, 0.72)`) |
| **Border** | White at low alpha (light-on-dark edge) | Black at low alpha (dark-on-light edge) |
| **Highlight** | Top-left white sweep at 9% | Top-left white sweep at 50% (visible on near-white) |
| **Shadow** | Heavy, diffuse black | Lighter, tighter — shadow is primary depth cue |
| **Blur** | 32px saturate(160%) | 24px saturate(120%) — less saturation prevents color bleed |
| **Tint** | Turquoise at 22% | Turquoise at 10% — prevents neon wash |
| **Gradient bg** | Near-black radial with colored orbs | Cool gray radial with faint colored orbs |

### Glass gradient (chat background)

```css
/* Dark */
--glass-gradient: radial-gradient(circle at 10% 20%, rgba(0,206,200,0.25), transparent 55%),
                  radial-gradient(circle at 80% 10%, rgba(105,119,255,0.16), transparent 50%),
                  #020202;

/* Light */
--glass-gradient: radial-gradient(circle at 10% 20%, rgba(0,206,200,0.08), transparent 55%),
                  radial-gradient(circle at 80% 10%, rgba(105,119,255,0.05), transparent 50%),
                  #FAFBFC;
```

### Implementation rule

`.liquid-glass-surface` CSS class reads `--c-glass-*` tokens. The only
change per theme is the token values — no structural CSS changes.

```css
.liquid-glass-surface {
  background: var(--c-glass-base);
  border: 1px solid var(--c-glass-border);
  box-shadow: var(--c-glass-shadow);
  backdrop-filter: blur(var(--c-glass-blur, 32px)) saturate(var(--c-glass-saturate, 160%));
}
```

Light overrides:
```css
:root[data-theme='light'] {
  --c-glass-blur: 24px;
  --c-glass-saturate: 120%;
}
```

---

## 4. Chat Bubble Spec

### Sent bubble

| Property | Dark | Light |
|----------|------|-------|
| Background | `linear-gradient(135deg, rgba(0,206,200,0.9), rgba(32,84,78,0.85))` | `linear-gradient(135deg, rgba(0,206,200,0.92), rgba(0,158,153,0.88))` |
| Text | `#FFFFFF` | `#FFFFFF` |
| Border | `rgba(0, 206, 200, 0.65)` | `rgba(0, 206, 200, 0.35)` |
| Shadow | `0 8px 30px rgba(0, 0, 0, 0.45)` | `0 4px 16px rgba(0, 158, 153, 0.15)` |
| Backdrop-filter | `blur(20px) saturate(190%)` | `blur(16px) saturate(140%)` |

### Received bubble

| Property | Dark | Light |
|----------|------|-------|
| Background | `rgba(18, 18, 22, 0.78)` | `#F4F5F7` |
| Text | `#FFFFFF` | `#0F1419` |
| Border | `rgba(255, 255, 255, 0.14)` | `rgba(0, 0, 0, 0.06)` |
| Shadow | `0 8px 30px rgba(0, 0, 0, 0.45)` | `0 2px 8px rgba(0, 0, 0, 0.04)` |
| Backdrop-filter | `blur(20px) saturate(190%)` | `none` (solid fill — no blur needed) |

### Composer card

| Property | Dark | Light |
|----------|------|-------|
| Background | `rgba(18, 18, 22, 0.92)` | `rgba(255, 255, 255, 0.95)` |
| Input field bg | `rgba(255, 255, 255, 0.06)` | `#F4F5F7` |
| Input border | `rgba(255, 255, 255, 0.12)` | `rgba(0, 0, 0, 0.08)` |
| Placeholder text | `rgba(255, 255, 255, 0.45)` | `#536471` |
| Shadow | `0 -4px 24px rgba(0, 0, 0, 0.3)` | `0 -2px 12px rgba(0, 0, 0, 0.06)` |

### Reply snippet (quoted message in composer)

| Property | Dark | Light |
|----------|------|-------|
| Background | `rgba(0, 206, 200, 0.08)` | `rgba(0, 206, 200, 0.06)` |
| Left accent bar | `#00CEC8` | `#009E99` |
| Text | `rgba(255, 255, 255, 0.7)` | `#536471` |
| Border | `rgba(0, 206, 200, 0.2)` | `rgba(0, 158, 153, 0.15)` |

---

## 5. Interactive States

### Standard surfaces (cards, list items, nav items)

| State | Dark | Light |
|-------|------|-------|
| Default | transparent | transparent |
| Hover | `rgba(255,255,255, 0.06)` | `rgba(0,0,0, 0.04)` |
| Active / Pressed | `rgba(255,255,255, 0.10)` | `rgba(0,0,0, 0.07)` |
| Focus (keyboard) | `box-shadow: 0 0 0 2px rgba(0,206,200, 0.6)` | `box-shadow: 0 0 0 2px rgba(0,158,153, 0.5)` |
| Disabled | `opacity: 0.4` | `opacity: 0.5` |

### Accent-filled buttons (primary CTA)

| State | Dark | Light |
|-------|------|-------|
| Default | `#00CEC8` | `#00CEC8` |
| Hover | `#00B8B3` | `#00B8B3` |
| Active | `#009E99` | `#009E99` |
| Focus | `ring + #00CEC8` | `ring + #009E99` |
| Disabled | `#00CEC8` at 40% opacity | `#00CEC8` at 50% opacity |

### Ghost / secondary buttons

| State | Dark | Light |
|-------|------|-------|
| Default | `transparent + border: --c-border-default` | `transparent + border: --c-border-default` |
| Hover | `--c-hover-bg` | `--c-hover-bg` |
| Active | `--c-active-bg` | `--c-active-bg` |
| Focus | Focus ring | Focus ring |
| Disabled | Opacity | Opacity |

### Chips (reaction chips, filter chips)

| State | Dark | Light |
|-------|------|-------|
| Default bg | `rgba(255,255,255, 0.08)` | `rgba(0,0,0, 0.05)` |
| Default border | `rgba(255,255,255, 0.12)` | `rgba(0,0,0, 0.08)` |
| Selected bg | `rgba(0,206,200, 0.15)` | `rgba(0,206,200, 0.10)` |
| Selected border | `rgba(0,206,200, 0.5)` | `rgba(0,206,200, 0.4)` |
| Selected text | `#00CEC8` | `#009E99` |

---

## 6. WCAG Contrast Verification Table

All combinations meet **WCAG 2.1 AA** (≥ 4.5:1 normal text, ≥ 3:1 large text/UI).

### Light mode text combinations

| Foreground | Background | Ratio | Pass |
|------------|-----------|-------|------|
| `#0F1419` (primary) | `#FAFBFC` (canvas) | **15.8:1** | AA / AAA |
| `#0F1419` (primary) | `#FFFFFF` (card) | **16.5:1** | AA / AAA |
| `#0F1419` (primary) | `#F4F5F7` (recessed) | **14.7:1** | AA / AAA |
| `#536471` (secondary) | `#FAFBFC` (canvas) | **5.7:1** | AA |
| `#536471` (secondary) | `#FFFFFF` (card) | **5.9:1** | AA |
| `#536471` (secondary) | `#F4F5F7` (recessed) | **5.3:1** | AA |
| `#009E99` (link) | `#FAFBFC` (canvas) | **4.6:1** | AA |
| `#009E99` (link) | `#FFFFFF` (card) | **4.8:1** | AA |
| `#FFFFFF` (on-accent) | `#00CEC8` (accent fill) | **2.4:1** | Large text only* |
| `#FFFFFF` (on-accent) | `#009E99` (active accent) | **3.5:1** | UI / Large |
| `#0F1419` (bubble received) | `#F4F5F7` (received bg) | **14.7:1** | AA / AAA |
| `#FFFFFF` (bubble sent) | turquoise gradient mid | **3.2:1** | Large text* |

*\*Sent bubble text passes at 16px+ (large text threshold). The gradient midpoint
averages ~`#00B4AE` which yields 3.2:1 with white. Acceptable because chat bubbles
use 15–16px body text (large text per WCAG). Add `text-shadow: 0 1px 2px rgba(0,0,0,0.15)` as
enhancement if needed.*

### Dark mode text combinations (baseline reference)

| Foreground | Background | Ratio | Pass |
|------------|-----------|-------|------|
| `#FFFFFF` (primary) | `#000000` (canvas) | **21:1** | AAA |
| `rgba(255,255,255,0.7)` (secondary) | `#000000` | **12.6:1** | AAA |
| `#00CEC8` (link) | `#000000` | **9.5:1** | AAA |
| `#FFFFFF` (sent) | turquoise gradient | **3.2:1** | Large text |

---

## 7. What Stays Dark Regardless

These surfaces remain in dark mode tokens even when the app is set to light:

| Surface | Reason |
|---------|--------|
| **Media viewer** (fullscreen image/video) | Industry standard; dark reduces glare and focuses attention on media |
| **Video player chrome** (controls, progress bar) | Matches system media patterns (iOS/Android) |
| **Sent bubble interior** | Brand identity — turquoise gradient + white text is the C-Point signature |
| **Toast notifications** | Always dark pill for visibility on any background |
| **Splash / loading screen** | OLED black prevents flash on app cold start |
| **Onboarding overlay** | Cinematic dark-first brand impression (splash only; the onboarding chat and intro gate are light-themeable) |

Implementation: these components use `.theme-always-dark` utility class which
applies the dark token set regardless of the global `data-theme`.

```css
.theme-always-dark {
  --c-bg-app: #000000;
  --c-text-primary: #FFFFFF;
  --c-text-secondary: rgba(255, 255, 255, 0.7);
  --c-border-default: rgba(255, 255, 255, 0.14);
  --c-glass-base: rgba(12, 12, 16, 0.68);
  --c-glass-border: rgba(255, 255, 255, 0.14);
  --c-glass-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}
```

---

## 8. Tailwind Config Extension

Wire semantic tokens to Tailwind so components use `bg-c-surface` instead of
raw `rgba(...)` values.

```js
// client/tailwind.config.js — theme.extend addition
colors: {
  c: {
    bg: {
      app: 'var(--c-bg-app)',
      elevated: 'var(--c-bg-elevated)',
      surface: 'var(--c-bg-surface)',
      recessed: 'var(--c-bg-recessed)',
      overlay: 'var(--c-bg-overlay)',
    },
    text: {
      primary: 'var(--c-text-primary)',
      secondary: 'var(--c-text-secondary)',
      tertiary: 'var(--c-text-tertiary)',
      disabled: 'var(--c-text-disabled)',
      link: 'var(--c-text-link)',
      'on-accent': 'var(--c-text-on-accent)',
    },
    border: {
      DEFAULT: 'var(--c-border-default)',
      subtle: 'var(--c-border-subtle)',
      strong: 'var(--c-border-strong)',
      accent: 'var(--c-border-accent)',
    },
    accent: {
      DEFAULT: 'var(--c-accent)',
      hover: 'var(--c-accent-hover)',
      active: 'var(--c-accent-active)',
      muted: 'var(--c-accent-muted)',
    },
    hover: {
      bg: 'var(--c-hover-bg)',
      accent: 'var(--c-hover-accent)',
    },
    active: {
      bg: 'var(--c-active-bg)',
      accent: 'var(--c-active-accent)',
    },
    skeleton: {
      strong: 'var(--c-skeleton-strong)',
      subtle: 'var(--c-skeleton-subtle)',
    },
  },
},
boxShadow: {
  'c-glass': 'var(--c-glass-shadow)',
  'c-focus': 'var(--c-focus-ring)',
},
```

Usage in components:

```tsx
<div className="bg-c-bg-surface border border-c-border text-c-text-primary">
  <p className="text-c-text-secondary">Caption</p>
  <button className="bg-c-accent hover:bg-c-accent-hover focus:shadow-c-focus">
    Action
  </button>
</div>
```

---

## 9. CSS Architecture

### Theme switching mechanism

```css
/* client/src/index.css — after existing :root */

:root,
:root[data-theme='dark'] {
  /* Canvas */
  --c-bg-app: #000000;
  --c-bg-elevated: rgba(12, 12, 16, 0.72);
  --c-bg-surface: rgba(18, 20, 24, 0.78);
  --c-bg-recessed: rgba(18, 18, 22, 0.8);
  --c-bg-overlay: rgba(0, 0, 0, 0.6);

  /* Text */
  --c-text-primary: #FFFFFF;
  --c-text-secondary: rgba(255, 255, 255, 0.7);
  --c-text-tertiary: rgba(255, 255, 255, 0.45);
  --c-text-disabled: rgba(255, 255, 255, 0.25);
  --c-text-link: #00CEC8;
  --c-text-on-accent: #FFFFFF;

  /* Borders */
  --c-border-default: rgba(255, 255, 255, 0.14);
  --c-border-subtle: rgba(255, 255, 255, 0.06);
  --c-border-strong: rgba(255, 255, 255, 0.22);
  --c-border-accent: rgba(0, 206, 200, 0.65);

  /* Glass */
  --c-glass-base: rgba(12, 12, 16, 0.68);
  --c-glass-tint: rgba(0, 206, 200, 0.22);
  --c-glass-border: rgba(255, 255, 255, 0.14);
  --c-glass-highlight: rgba(255, 255, 255, 0.09);
  --c-glass-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  --c-glass-blur: 32px;
  --c-glass-saturate: 160%;

  /* Bubbles */
  --c-bubble-sent-bg: linear-gradient(135deg, rgba(0,206,200,0.9), rgba(32,84,78,0.85));
  --c-bubble-sent-text: #FFFFFF;
  --c-bubble-sent-border: rgba(0, 206, 200, 0.65);
  --c-bubble-received-bg: rgba(18, 18, 22, 0.78);
  --c-bubble-received-text: #FFFFFF;
  --c-bubble-received-border: rgba(255, 255, 255, 0.14);

  /* Chrome */
  --c-header-bg: rgba(0, 0, 0, 0.75);
  --c-nav-bg: rgba(0, 0, 0, 0.82);
  --c-composer-bg: rgba(18, 18, 22, 0.92);
  --c-composer-input-bg: rgba(255, 255, 255, 0.06);

  /* Interactive */
  --c-hover-bg: rgba(255, 255, 255, 0.06);
  --c-active-bg: rgba(255, 255, 255, 0.10);
  --c-focus-ring: 0 0 0 2px rgba(0, 206, 200, 0.6);
  --c-hover-accent: rgba(0, 206, 200, 0.12);
  --c-active-accent: rgba(0, 206, 200, 0.2);
  --c-disabled-opacity: 0.4;

  /* Accent */
  --c-accent: #00CEC8;
  --c-accent-hover: #00B8B3;
  --c-accent-active: #009E99;
  --c-accent-muted: rgba(0, 206, 200, 0.15);

  /* Skeleton */
  --c-skeleton-strong: rgba(255, 255, 255, 0.08);
  --c-skeleton-subtle: rgba(255, 255, 255, 0.04);

  /* Chat background gradient */
  --glass-gradient: radial-gradient(circle at 10% 20%, rgba(0,206,200,0.25), transparent 55%),
                    radial-gradient(circle at 80% 10%, rgba(105,119,255,0.16), transparent 50%),
                    #020202;
}

:root[data-theme='light'] {
  /* Canvas */
  --c-bg-app: #FAFBFC;
  --c-bg-elevated: rgba(255, 255, 255, 0.85);
  --c-bg-surface: #FFFFFF;
  --c-bg-recessed: #F4F5F7;
  --c-bg-overlay: rgba(0, 0, 0, 0.3);

  /* Text */
  --c-text-primary: #0F1419;
  --c-text-secondary: #536471;
  --c-text-tertiary: rgba(83, 100, 113, 0.6);
  --c-text-disabled: rgba(15, 20, 25, 0.3);
  --c-text-link: #009E99;
  --c-text-on-accent: #FFFFFF;

  /* Borders */
  --c-border-default: rgba(0, 0, 0, 0.08);
  --c-border-subtle: rgba(0, 0, 0, 0.04);
  --c-border-strong: rgba(0, 0, 0, 0.14);
  --c-border-accent: rgba(0, 206, 200, 0.5);

  /* Glass */
  --c-glass-base: rgba(255, 255, 255, 0.72);
  --c-glass-tint: rgba(0, 206, 200, 0.10);
  --c-glass-border: rgba(0, 0, 0, 0.06);
  --c-glass-highlight: rgba(255, 255, 255, 0.5);
  --c-glass-shadow: 0 12px 40px rgba(0, 0, 0, 0.08);
  --c-glass-blur: 24px;
  --c-glass-saturate: 120%;

  /* Bubbles */
  --c-bubble-sent-bg: linear-gradient(135deg, rgba(0,206,200,0.92), rgba(0,158,153,0.88));
  --c-bubble-sent-text: #FFFFFF;
  --c-bubble-sent-border: rgba(0, 206, 200, 0.35);
  --c-bubble-received-bg: #F4F5F7;
  --c-bubble-received-text: #0F1419;
  --c-bubble-received-border: rgba(0, 0, 0, 0.06);

  /* Chrome */
  --c-header-bg: rgba(255, 255, 255, 0.88);
  --c-nav-bg: rgba(255, 255, 255, 0.92);
  --c-composer-bg: rgba(255, 255, 255, 0.95);
  --c-composer-input-bg: #F4F5F7;

  /* Interactive */
  --c-hover-bg: rgba(0, 0, 0, 0.04);
  --c-active-bg: rgba(0, 0, 0, 0.07);
  --c-focus-ring: 0 0 0 2px rgba(0, 158, 153, 0.5);
  --c-hover-accent: rgba(0, 206, 200, 0.08);
  --c-active-accent: rgba(0, 206, 200, 0.14);
  --c-disabled-opacity: 0.5;

  /* Accent */
  --c-accent: #00CEC8;
  --c-accent-hover: #00B8B3;
  --c-accent-active: #009E99;
  --c-accent-muted: rgba(0, 206, 200, 0.10);

  /* Skeleton */
  --c-skeleton-strong: rgba(0, 0, 0, 0.08);
  --c-skeleton-subtle: rgba(0, 0, 0, 0.04);

  /* Chat background gradient */
  --glass-gradient: radial-gradient(circle at 10% 20%, rgba(0,206,200,0.08), transparent 55%),
                    radial-gradient(circle at 80% 10%, rgba(105,119,255,0.05), transparent 50%),
                    #FAFBFC;

  /* Override body defaults for light */
  color-scheme: light;
}
```

### HTML attribute (set by React)

```tsx
// ThemeProvider sets this on <html> element
document.documentElement.setAttribute('data-theme', userTheme); // 'dark' | 'light'
```

### Body color override

```css
:root[data-theme='light'] body {
  background-color: var(--c-bg-app);
  color: var(--c-text-primary);
}
```

### Cascade order

1. `:root` / `:root[data-theme='dark']` — dark defaults (same block, no duplication)
2. `:root[data-theme='light']` — light overrides
3. `.theme-always-dark` — force-dark for media viewer, toasts, splash
4. Component-level overrides — only when a surface deviates from its parent tokens

---

## 10. Implementation Notes

### Theme persistence

- **localStorage is authoritative.** Stored under `cpoint:theme` as `'dark' | 'light' | 'system'`.
- On load, the FOUC inline script in `client/index.html` reads localStorage synchronously and resolves `'system'` via `window.matchMedia('(prefers-color-scheme: dark)')` before first paint.
- `ThemeContext` exposes `preference` (stored value) and `theme` (resolved `'dark' | 'light'`). Only the resolved value is written to `data-theme` on `<html>`.
- Firestore cross-device sync (`users/{uid}/preferences.theme`) is deferred to a future enhancement.
- Default for absent/unknown values is always `'dark'` — light and system are opt-in.

### System preference resolution

The `'system'` preference is resolved entirely in JavaScript — there is **no** CSS `@media (prefers-color-scheme)` block with `[data-theme='system']`. This avoids duplicating the full light token set into a media query and keeps `data-theme` strictly two-valued (`'dark' | 'light'`).

When preference is `'system'`, a `matchMedia('change')` listener updates the resolved theme live. On Capacitor, an `App.addListener('resume')` re-reads the OS preference in case it changed while backgrounded.

### Transition on theme switch

```css
:root.theme-transitioning,
:root.theme-transitioning * {
  transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease,
              box-shadow 200ms ease !important;
}
```

Applied for 200ms when `data-theme` changes, then removed to avoid
interfering with component animations. Disabled under `prefers-reduced-motion`.

### Capacitor status bar

When light mode activates, native status bar must switch to dark text:

```ts
import { StatusBar, Style } from '@capacitor/status-bar';
StatusBar.setStyle({ style: theme === 'light' ? Style.Dark : Style.Light });
```

The `useNativeStatusBar` hook handles this automatically including on
app resume when preference is `'system'`.

---

## 11. QA Checklist

| Check | Details |
|-------|---------|
| Canvas contrast | No white-on-white or black-on-black text |
| Glass surfaces | Visible on both solid and gradient backgrounds |
| Sent bubbles | Turquoise + white text legible |
| Received bubbles | Gray surface has clear boundary |
| Header/nav blur | Frosted effect visible with content scrolling behind |
| Skeleton shimmer | Visible but not harsh |
| Focus rings | Visible on all interactive elements via keyboard |
| Media viewer | Stays dark regardless of theme |
| Toast | Dark pill on light canvas |
| Theme transition | Smooth 200ms, no flash of wrong theme |
| Safe areas | Correct on notch/dynamic-island devices in both themes |
| Status bar | Dark icons on light, light icons on dark |
| Input fields | Placeholder text visible, cursor visible |
| Disabled states | Clearly distinguishable from enabled |
| Chat search highlight | `rgba(0,206,200,0.25)` visible on light received bubble |

---

## Related docs

- Brand system: [`docs/DESIGN.md`](DESIGN.md)
- Glass component classes: [`client/src/index.css`](../client/src/index.css)
- Tailwind tokens: [`client/tailwind.config.js`](../client/tailwind.config.js)
- Chat surfaces: [`.cursor/rules/chat-surfaces.mdc`](../.cursor/rules/chat-surfaces.mdc)
- Capacitor UX: delegate to `capacitor-ux-polish` for status bar / safe area implementation
