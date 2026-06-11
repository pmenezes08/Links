# QA checklist — staging, pilot-readiness batch (June 2026)

Run against **staging**: https://cpoint-app-staging-739552904126.europe-west1.run.app
**Not** `app.c-point.co` and **not** the installed iOS/Android app (native builds load **production**, so staging changes never appear there).

**Before every session:** open a fresh **incognito/private window**, or clear site data for the staging origin. The PWA service worker caches old bundles aggressively — this has repeatedly made fixes look "not deployed".

Accounts needed: an **owner** account (owns a test community), a **fresh email** you can receive (for signup), and 2–3 spare member accounts.

---

## 1. Light mode (the white-font fixes)

Switch the app to **light** theme (Account Settings → Appearance) before this section.

- [ ] **Manage Community** (`/community/:id/edit`): Community name input value, Description, Network Type select value, Recommended profile select value, Member limit placeholder — all dark, readable text. Notify toggle off-state visible.
- [ ] **Invite Members modal** (Members page → Invite): dark glow panel with **white** title "Invite to …" and white option titles (Username / E-mail / QR code); intro bubble readable.
- [ ] **Admin Dashboard**: explanation paragraphs (e.g. "How DAU and MAU are counted") readable.
- [ ] **Account Security**: section helper texts readable.
- [ ] **About C-Point** page + modal: tertiary texts readable.
- [ ] **Create Post** → submit a post with media: the posting overlay text is readable.
- [ ] **Chat**: link previews in received bubbles show a readable title.
- [ ] **Signup page** (logged out, light theme): inputs and placeholders visible.
- [ ] Switch back to **dark** theme: spot-check the same surfaces — nothing regressed (story viewer stays white-on-dark).

## 2. Invite emails (colors + content)

- [ ] Send yourself an email invite (Manage Community → Invite → E-mail).
- [ ] Open in **Gmail light mode / desktop webmail**: white header with logo, dark heading, **turquoise (#00CEC8) CTA** with black label, light card. Community name appears in the body (was broken on MySQL before).
- [ ] Open in **Apple Mail with device dark mode**: stays light (locked via color-scheme meta).
- [ ] Gmail app in dark mode: card may darken (Gmail recolors; expected) but CTA stays clearly turquoise and everything readable.
- [ ] Email says invitation valid until a date **~30 days** out.

## 3. Invite funnel — desktop (primary pilot path)

- [ ] Open the invite email link on **desktop Chrome/Firefox**: landing page shows **"Continue in browser"** as primary; no auto-redirect to the App Store.
- [ ] Continue in browser → InvitePreview shows community + inviter → **Create account**.
- [ ] Signup with a **duplicate email** → real error shown (NOT "verification email sent").
- [ ] Signup with mismatched passwords → real error.
- [ ] Signup correctly → "verify your email" state.
- [ ] Click the verification link **on desktop** → **you land logged in** (no /login password re-entry) on the dashboard **with the invite prompt open**.
- [ ] Click the verification link **on a phone** → the "verified — return to the app" page, **no web session, never the mobile webapp**.
- [ ] Accept → community feed with `?joined=1` orientation card.

## 4. Invite funnel — mobile browser

- [ ] Open invite link on phone browser (no app installed): "Open in C-Point App" primary, store fallback — and **NO browser/webapp option anywhere** (mobile users only get the app or the store).
- [ ] Open an **expired or already-used** email invite link: proper "no longer valid" page (not "You're Invited!").

## 5. QR / link invites — single-use toggle

- [ ] Owner: generate a QR/link invite. With the **single-use toggle OFF** (default): two different member accounts can both join via the same link.
- [ ] Turn the toggle **ON** (invite settings): the next account to use the link joins, and the one after that is rejected ("no longer pending").

## 6. Bulk invites (admin-web)

- [ ] admin-web → Invites: paste ~30 emails incl. one invalid (`not-an-email`) → progress indicator ("Sending X of Y"), final summary shows honest sent/failed counts and lists the invalid address.
- [ ] Bulk invite into a near-capacity community → whole batch refused up front with the member-limit message (no partial sends).

## 7. New community → 14-day Steve trial

- [ ] Create a new root community → as a free member of it, @Steve in the feed works (pool active, no purchase).
- [ ] Manage Community billing card shows the Steve package as active/trialing with an end date ~14 days out.
- [ ] Owner can still open the Steve package purchase (the trial must not block checkout with "already active").

## 8. Age gate (18+, compliance)

- [ ] Brand-new account, first session: the **age gate appears** (full-screen, DOB + consent) — also when landing directly in a community feed.
- [ ] Confirm 18+ → gate disappears and **never returns** (also on a second device/browser — server-side state).
- [ ] Enter an under-18 DOB → block screen with delete-account option; "I made a mistake" recovers.
- [ ] Existing/older accounts see the gate **once** on next login (grandfathering), then never again.

## 9. First-session intro (revived)

- [ ] On a brand-new verified account (after the age gate): intro appears — language picker (EN/PT) + appearance with **Dark / Light / Match my device**, then Welcome page (video if configured), manifesto button, "Set up your Profile" → opens Steve chat; "Set up my profile later" → defer confirmation.
- [ ] The intro does **not** reappear on subsequent sessions.
- [ ] Pick "Match my device" → app follows the OS theme.

## 10. Basic-profile gate (no phantom actions)

With a member whose profile is incomplete (no photo):

- [ ] React to a post on the **Communities** page → gate sheet opens, and the heart does **not** stay lit after dismissing.
- [ ] Vote in a poll on the Communities page → gate opens, vote reverted.
- [ ] React to a **child reply** in the community feed → gate opens.
- [ ] React inside **CommentReply** (nested reply page) → gate opens.
- [ ] Browse, accept invites, read feeds → never gated.

## 11. Misc

- [ ] **Professional profile builder** (`/steve/profile-builder/professional`): no double header; Steve chat chrome only.
- [ ] **Checkout Success page** (complete a test checkout): proper copy ("… is active.") — not raw `billing.checkout_success.*` keys.
- [ ] PT-PT account: spot-check the intro gate, age gate, and invite-modal strings render in Portuguese.

---

**When something fails:** note the exact URL, account, theme (light/dark), and whether the window was incognito. Stale service-worker bundles are the #1 false alarm — verify in incognito before filing.
