# QA — Native plugins + IAP TestFlight build (2026-06)

Build: `staging` branch (`745dd4dab`), Capacitor **staging** profile → server `cpoint-app-staging`.
Scope: Batch A (native UI), B (camera/library/save), D-6b (upload resume), E (biometric lock),
plus the Apple IAP Restore + sandbox-host fix. Plus a core regression smoke.

## 0. Prerequisites / setup

- [ ] Build installed from **TestFlight** (i.e. archived after `npm run cap:sync:staging`).
- [ ] Signed in (cookie auth). Have a **second account** available (for DM/badge tests).
- [ ] A **Sandbox Apple ID** created in App Store Connect → Users and Access → Sandbox, and signed into it on the device (Settings → App Store → Sandbox Account) for IAP tests.
- [ ] Devices: at least one **Face ID** iPhone; ideally also a **Touch ID** device. (Android = separate internal build if testing.)
- [ ] First-run permission prompts will appear (camera, photos, notifications, Face ID) — grant as you hit them; one negative test below intentionally denies.

> Note: staging shares the **prod database**, so data you create is real. Don't bulk-delete.

---

## 1. Batch A — Native UI

### 1a. Native toasts (chat send errors)
- [ ] DM a contact, attach a photo, turn on **Airplane Mode**, send → a **native toast** appears (not a web "app.c-point.co says…" box) and auto-dismisses.
- [ ] Repeat in a **group chat** → same native toast.

### 1b. Native dialogs (confirm/alert)
- [ ] Trigger a converted confirm (e.g. delete a post in the feed, or an action in Event detail) → the dialog is a **native iOS alert** sheet.
- [ ] _Expected gap:_ some less-common confirms may still be web-styled (long-tail not converted) — acceptable, note any that feel wrong.

### 1c. App-icon badge
- [ ] Fully close the app. From the second account, send a DM → home-screen **app icon shows a badge count**.
- [ ] Open the app, read the message → badge **clears** (within ~15s poll or immediately on resume).
- [ ] Background with unread, return → badge reflects the correct count.

### 1d. In-app review (best-effort by design)
- [ ] Create a **second** post (not your first ever) → the OS "Enjoying C-Point?" rating prompt **may** appear.
- [ ] Trigger a Steve networking match → open the chat → prompt **may** appear.
- [ ] _Expected:_ Apple rate-limits this; it may NOT show. It must **never** show twice in a session / within 120 days. Just confirm it doesn't spam.

### 1e. Local notification — event reminders
- [ ] Create or find an event starting **~31–35 minutes from now**. RSVP **Going** → first time, a **notification permission** prompt appears; grant it.
- [ ] Wait until ~30 min before start → a local notification fires: **"Starts in 30 minutes · [community]"**.
- [ ] RSVP the same event **Not going** before it fires → the reminder is **cancelled** (no notification).
- [ ] RSVP Going on **web** (or another device), then cold-open this app → reminder gets scheduled (app-open sync). Verify by waiting for it, or re-checking it doesn't double-fire.

---

## 2. Batch B — Camera, library, save-to-gallery

### 2a. DM chat
- [ ] Attach → **Photo** → native **photo-library** picker opens; multi-select up to 10 → selected photos appear as pending → send → they arrive.
- [ ] Attach → **Camera** → native camera opens → take a photo → appears as pending → send → arrives.
- [ ] _Expected gap:_ camera is **photos only**; choosing video still uses the standard picker.

### 2b. Group chat
- [ ] Repeat 2a (Photo + Camera) in a **group chat** → identical behavior.

### 2c. Create post (feed composer)
- [ ] Tap the **image** icon → native library picker opens, capped at **5** items → selected photos appear in the composer → post succeeds.

### 2d. Save to gallery
- [ ] Open a received **image** in the DM media viewer → tap the **save / down-arrow** icon in the header → toast **"Saved to your photos"** → confirm it's in the **Photos** app.
- [ ] Same in a **group** chat viewer.
- [ ] Save a received **video** → confirm it lands in Photos.
- [ ] Media Gallery page (DM and group): open a media item → save → in Photos.

### 2e. Cancel & permissions
- [ ] Open the native picker → **Cancel** → returns to chat cleanly, no error toast, **no second prompt**.
- [ ] First camera use prompts camera permission; first save prompts "Add to Photos". **Deny** one → app does **not crash**; action simply doesn't complete.

---

## 3. Batch D-6b — Upload resume

- [ ] Send a photo on a **weak connection**; **background** the app mid-upload → return → upload **resumes** and completes; message present **once** (no duplicate).
- [ ] Mid-upload, go **offline** (Airplane Mode) → upload pauses (doesn't error out) → turn network **back on** → it **auto-resumes** without you tapping anything.
- [ ] With a pending upload, **force-quit** and reopen → upload drains and completes; **no duplicate** message (client_key idempotency).
- [ ] Rapidly background/foreground during a resume → still only **one** resulting message.

---

## 4. Batch E — Biometric App Lock

Settings → **Privacy & Security** → **Security** tab → **App Lock**.

### 4a. Enable & basic lock
- [ ] Toggle is **visible** (native only). Label reads **"Require Face ID…"** / "Touch ID…" matching the device.
- [ ] Toggle **ON** → biometric prompt appears; on success the toggle stays on.
- [ ] **Background** the app → return → **lock screen** ("C-Point is locked") covers content; biometric prompt fires; success → content shows.
- [ ] **Cold start** (force-quit + reopen) → lock screen appears and prompts.

### 4b. App-switcher privacy
- [ ] With lock on, open the **app switcher** → the app's snapshot shows the **lock screen**, not your content.

### 4c. Cancel / retry / fallback
- [ ] At the prompt, **cancel** → stays locked; **Unlock** button re-prompts.
- [ ] Fail Face ID a couple times → **device passcode** fallback offered → entering it unlocks.

### 4d. Disable & fail-open (important)
- [ ] Toggle **OFF** → no lock on background/open anymore.
- [ ] Re-enable, then turn **Face ID off in iOS Settings** → open the app → it **does NOT lock you out** (fail-open) — you can still use it.
- [ ] On a device with **no enrolled biometrics**, the toggle is **disabled** with a "set up biometrics" hint.

### 4e. Account isolation
- [ ] Enable lock as **user A** → log out → log in as **user B** → App Lock is **OFF** for B (setting cleared on account switch).

---

## 5. Apple IAP / Subscriptions (the urgent fix)

Requires the Sandbox Apple ID from §0.

- [ ] Open the **Subscription / Plans** page → renders correctly (no raw `i18n.keys`).
- [ ] Start a subscription → StoreKit **sandbox** purchase sheet → completes → verification **succeeds against the sandbox host** (the fallback fix) → plan/entitlement granted.
- [ ] Confirm gating: premium features unlock and AI caps reflect the new plan.
- [ ] **Restore:** delete & reinstall the app (or use a fresh device) → sign in → tap **Restore Purchases** → the active subscription is **restored** (StoreKit2 currentEntitlements) and entitlement reflected.
- [ ] No double-charge / no error on a second "Restore".

---

## 6. Regression smoke (merge didn't break core)

Quick pass — the staging build merged 38 commits + native + IAP:
- [ ] Log in / log out.
- [ ] Home feed loads; open a post; add a comment; create a text post.
- [ ] DM: send/receive text. Group chat: send/receive text.
- [ ] Notifications list loads; calendar/events list loads.
- [ ] Steve / networking basic round-trip.
- [ ] Profile loads; avatars render.
- [ ] No console-visible crashes; app survives background/foreground cycles.

---

## Results log

| Section | Pass | Fail | Notes |
|---|---|---|---|
| 1 Native UI | | | |
| 2 Camera/save | | | |
| 3 Upload resume | | | |
| 4 Biometric lock | | | |
| 5 IAP / restore | | | |
| 6 Regression | | | |

Report any FAIL with: device + iOS version, exact steps, what happened vs expected, and a screen recording if possible.
