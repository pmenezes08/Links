# German (`de-DE`) style guide & glossary

Canonical term + tone reference for the German localization of C-Point.
This is the contract every German string follows. Translators draft
against it; the native reviewer signs off against it.

**Status (2026-06-16):** Phase 0 — drafted, pending native-reviewer
ratification before the full translation pass begins. No app code or
catalogs translated yet.

Companion to [`docs/I18N_ROADMAP.md`](../../docs/I18N_ROADMAP.md). The PT
style guide lives in that roadmap's §7; this file is the German analog.
The product policy / pricing / caps source of truth remains the in-app
Knowledge Base — this file is **language only**.

Target: **standard German of Germany (`de-DE`)** with `ß`. Austrian
(`de-AT`) and Swiss (`de-CH`) tags alias to `de-DE` for v1; their
regional differences (`Jänner`, `ss`-for-`ß`, etc.) are intentionally
out of scope.

---

## 1. Register — the `du` / `Sie` split

German mirrors the **as-shipped Portuguese split** (informal in-product,
formal in onboarding/sales). The `du`/`Sie` boundary is socially louder
in German than PT's `tu`/`você`, so the line below is strict.

| Surface | Register | Maps to PT |
|---------|----------|------------|
| `backend/locales/de-DE.json` (errors, notifications, emails, Steve community posts, entitlements) | **`du`** (informal) | `tu` |
| `client/src/locales/de-DE.json` (all app UI) | **`du`** (informal) | `tu` |
| `client/src/locales/onboarding-chat/de-DE.json` (first-run profile builder + B2B sales) | **`Sie`** (formal) | `você` |

### `du` (in-product) — examples

- "your account" → "dein Konto"
- "You have a new message" → "Du hast eine neue Nachricht"
- "You don't have access to that." → "Du hast keinen Zugriff darauf."
- "Check your connection and try again." → "Prüfe deine Verbindung und versuche es erneut."
- `du`, `dich`, `dir`, `dein/deine/deinen` are **lowercase** (modern app
  convention — not the old letter-style capital `Du`).

### `Sie` (onboarding chat only) — examples

- "Nice to meet you." → "Schön, Sie kennenzulernen."
- "Type your answer…" → "Geben Sie Ihre Antwort ein…"
- "You can change everything later." → "Sie können später alles ändern."
- "Where are you based?" → "Wo sind Sie ansässig?"
- `Sie`, `Ihnen`, `Ihr/Ihre/Ihren` are **capitalized** (always, for the
  polite form).

### Button & label exception — use the infinitive (register-neutral)

German UI **buttons and short labels use the infinitive**, which carries
no `du`/`Sie` marking. Use this for `common.*` and most action labels in
both registers — it keeps the catalogs clean and avoids exposing register
on chrome.

| EN | German (button/label) |
|----|------------------------|
| Save | Speichern |
| Cancel | Abbrechen |
| Close | Schließen |
| Delete | Löschen |
| Next | Weiter |
| Back | Zurück |
| Done | Fertig |
| Retry | Erneut versuchen |
| Edit | Bearbeiten |

The `du`/`Sie` distinction only appears in **full sentences / prose**
(error messages, Steve's voice, onboarding questions, notification
bodies). Imperative-as-prose forms: `du` → "Versuche es erneut",
"Speichere deine Änderungen"; `Sie` → "Versuchen Sie es erneut",
"Speichern Sie Ihre Änderungen".

---

## 2. Mechanics

- **`ß` not `ss`** after long vowels / diphthongs: `schließen`, `groß`,
  `Straße`, `heißt`. (Short vowel keeps `ss`: `muss`, `dass`, `lässt`.)
- **Capitalize every noun.** `Konto`, `Beitrag`, `Einstellungen`,
  `Mitglied`, `Einladung`, `Nachricht`. CI checks keys, not grammar — a
  lowercase noun is invisible to the gate and must be caught in review.
- **`E-Mail`** is the standard German spelling (hyphen, capital `M`).
  This **diverges from PT**, which uses lowercase `email`.
- **Umlauts** (`ä ö ü`) written out, never `ae/oe/ue`.
- **Quotes / punctuation**: keep straight ASCII quotes and the existing
  em-dash style of the EN source; don't substitute German guillemets
  („…"") unless the EN source already uses typographic quotes.

---

## 3. Keep in English (all locales)

Same global keep-list as PT, plus German-idiomatic loanwords:

- **Product / tiers**: C-Point, Steve, Premium, Enterprise
- **Standard German loanwords** (more natural than a translation):
  Feed, Chat, Story / Storys, Post*, Dashboard*, Networking, Account*,
  Premium, Upgrade, Admin, DM, Link, App
- URLs, emoji, code, third-party brands, usernames, community names,
  user-generated content

\* Some loanwords have a preferred German term below (e.g. **Beitrag**
for "post"). Where this table and §4 disagree, **§4 wins** — it records
the chosen term per concept.

---

## 4. Term table (English → German, chosen term)

The binding per-concept decisions. Where German idiom diverges from the
PT choice, the divergence is noted — that is expected (this glossary is
German-specific, not a PT mirror).

| EN concept | German (use) | Notes / vs PT |
|------------|--------------|---------------|
| account | **Konto** | PT "conta". Settings → "Kontoeinstellungen". |
| settings | **Einstellungen** | |
| password | **Passwort** | |
| username | **Benutzername** | |
| email | **E-Mail** | German standard spelling (diverges from PT `email`). |
| sign in / log in | **Anmelden** | "Sich anmelden" in prose. |
| sign up / register | **Registrieren** / "Konto erstellen" | |
| sign out / log out | **Abmelden** | |
| community / communities | **Community / Communitys** | Keep English (German social standard); Duden plural "Communitys". Avoid "Gemeinschaft". |
| member(s) | **Mitglied / Mitglieder** | |
| owner | **Inhaber/in** | Community owner → "Community-Inhaber". |
| admin | **Admin** | "Administrator" acceptable in long prose. |
| invite (noun / verb) | **Einladung / einladen** | |
| feed | **Feed** | Keep. |
| post (noun / verb) | **Beitrag / posten** | Translate the noun (PT "Publicação"); verb "posten" or "veröffentlichen". |
| story / stories | **Story / Storys** | Keep English — German social standard (diverges from PT "Histórias"). |
| reply (noun / verb) | **Antwort / antworten** | |
| comment | **Kommentar** | |
| reaction | **Reaktion** | "Reagieren" verb. |
| poll | **Umfrage** | |
| chat | **Chat** | Keep. |
| direct message / DM | **DM** / **Direktnachricht** | "DM" in tight UI; "Direktnachricht" in prose. |
| message | **Nachricht** | |
| notification | **Benachrichtigung** | |
| key posts | **Wichtige Beiträge** | PT "Publicações-chave". |
| media / gallery | **Medien / Galerie** | |
| links & documents | **Links & Dokumente** | |
| dashboard | **Dashboard** | Keep ("Übersicht" acceptable if a screen reads better). |
| profile | **Profil** | |
| networking | **Networking** | Keep (common in DE professional context). |
| event | **Event** | Keep for community events; "Termin" only for a personal appointment. PT "Evento". |
| RSVP (Going / Maybe / Can't go) | **Zusagen** · **Vielleicht** · **Absagen** | First-person ("Ich bin dabei / Vielleicht / Ich kann nicht") is fine in prose. No German word for "RSVP" — translate the concept. |
| summarize (Steve feature) | **Zusammenfassen** | PT "Resumir". |
| subscription | **Abo** | "Abonnement" in formal/legal contexts. |
| upgrade (verb / "Upgrade to Premium") | **upgraden** / **"Auf Premium upgraden"** | "Premium freischalten" also fine. |
| billing | **Abrechnung** | |
| save / cancel / close / next / back | **Speichern / Abbrechen / Schließen / Weiter / Zurück** | Infinitive labels (§1). |
| loading… | **Wird geladen…** | |

---

## 5. Reject list (common wrong choices)

| Reject | Use | Why |
|--------|-----|-----|
| `Du`, `Dein` (capitalized, in-product) | `du`, `dein` | Old letter style; modern apps lowercase informal. |
| `du`/`Sie` mixed within one surface | one register per §1 table | The split is by surface, never within. |
| `Gemeinschaft` | `Community` | "Gemeinschaft" reads churchy/NGO. |
| `Geschichte` (for Story) | `Story` | "Geschichte" = tale; wrong sense. |
| `email`, `e-mail` | `E-Mail` | German standard spelling. |
| `Account` everywhere | `Konto` | Prefer `Konto`; `Account` only where it already reads as a loanword. |
| Swiss `ss` for `ß` | `ß` | Target is `de-DE`. |
| lowercase nouns | Capitalized nouns | German orthography. |
| literal/stiff machine German | idiomatic, concise German | Esp. Steve's voice (§6). |

---

## 6. Steve's voice

Steve is warm, concise, lightly witty — a helpful person, not a form
letter. German translated literally turns stiff and bureaucratic; that is
the failure mode to avoid.

- Short sentences. Natural contractions where they fit ("gibt's",
  "geht's", "Schön, dass du da bist").
- In-product Steve uses **`du`** (community welcome posts, DMs, feed
  nudges, networking). Onboarding Steve uses **`Sie`**.
- **The `Sie` → `du` handoff:** Steve addresses the user as `Sie` through
  onboarding, then as `du` in the community welcome post / DM that fires
  right after. Make the first in-product message read like "now we know
  each other," not a glitch — review those exact strings together during
  the translation pass.
- Keep emoji exactly where the EN source has them.

---

## 7. Placeholders & structure (do not break)

- **Interpolation differs by side.** Backend catalog uses Python
  `str.format` **single braces** `{name}`, `{community}`,
  `{steve_uses_per_month}`. Client catalogs use i18next **double braces**
  `{{city}}`, `{{count}}`. Keep whichever the EN source uses; never
  translate or rename a placeholder.
- **Exact key parity.** `de-DE.json` must have exactly the keys `en.json`
  has — no missing, no extra — or `scripts/i18n_check_catalogs.py` fails
  the build. Don't add German-only plural keys the EN source lacks.
- **Array length parity.** Keep list-valued keys (e.g.
  `section_steps.*`, any carousel) the same length as EN.
- **Escaped braces** in `str.format` source (`{{` / `}}`) stay escaped.

---

## 8. Translator workflow

1. Engineer adds the English string to `en.json` with a stable key.
2. `scripts/i18n_check_catalogs.py` flags it missing in `de-DE`.
3. Translator edits **only** `de-DE.json` against this glossary — never
   English.
4. Native reviewer checks register (§1), capitalization (§2), term
   consistency (§4), and Steve's voice (§6) on staging before ship.
