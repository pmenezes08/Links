# QA Checklist — manual verification

Companion to the automated test matrix in `tests/` and
`scripts/staging_smoke.ps1`. Everything here is a human-in-the-loop
check: click the UI, observe a banner, inspect the admin-web Users tab.
Each section maps 1:1 to a row on the **KB → Audit → Tests** page with
`runner = manual`, so after running each step you can go mark it
successful or unsuccessful from the admin-web.

> **How to use this**: run through sections §1–§10 after any deploy
> that touches Steve, Whisper, entitlements, or the enterprise seat
> lifecycle. A full pass takes ~25 minutes (plus ~90 seconds for the
> §10 automated harness). File any failing step as a GitHub issue
> and flip the corresponding Tests-page row to `unsuccessful` so the
> product-roadmap pills show red.

---

## Setup (run once per test session)

1. Make sure `cpoint-app-staging` is on the commit you want to verify.
   Grab the live URL and currently-deployed revision with:
   ```powershell
   gcloud run services describe cpoint-app-staging `
     --region=europe-west1 --project=cpoint-127c2 `
     --format="value(status.url,status.latestReadyRevisionName)"
   ```
   Also confirm CI is green for the same commit on GitHub
   Actions (the `test.yml` workflow — look for a green tick on
   the branch/commit you're about to verify). If CI is red, stop
   and fix before running manual QA.
2. Seed the shared test accounts:
   ```powershell
   python scripts/seed_staging_test_users.py
   ```
3. Log into the admin-web (staging) as `@paulo`.

Test accounts available after seeding:

| Account | Subscription | Flags | Purpose |
|---|---|---|---|
| `test_free` | free | — | baseline |
| `test_trial` | free (created 3d ago) | — | trial window |
| `test_premium` | premium | — | paid flow |
| `test_special` | free | `is_special=1` | founder |
| `test_enterprise` | free | active seat in `test_acme_corp` | seat flow |
| `test_doublepay` | premium | active seat in `test_acme_corp` | nag flow |

---

## §1 — KB pages load and auto-seed

- [ ] Visit admin-web → Knowledge Base.
- [ ] Confirm every category (Overview, Product, Pricing, Policy,
      Planning, Reference, Audit) has at least one page.
- [ ] The new **Audit → Tests** page is visible and shows 12+ rows.
- [ ] The new **Planning → Product Roadmap** page shows the extra
      `Test` and `Test status` columns on each roadmap row.

## §2 — Tests-page status pills + Run now

- [ ] On the Tests page, click **Run now** on an arbitrary row.
- [ ] Confirm the OK/Cancel prompt appears with runner + target text.
- [ ] Click OK → pill flips green (`successful`), toast appears.
- [ ] Click Run now again → Cancel → pill flips red (`unsuccessful`).
- [ ] Visit **Audit → Changelog** — each click must produce a new entry
      with `reason = "Test status update: …"`.

## §3 — Voice-note logging

Reproduces the April-2026 "Whisper shows 0 min" bug.

- [ ] Open the client app as `@paulo`. Send a **DM voice note** of
      known length (e.g. 1 minute).
- [ ] Wait ~10s for the summary to appear.
- [ ] Open Account Settings → **Manage Membership → AI Usage**.
- [ ] Confirm:
  - "Voice transcription this month" **incremented by ~1 minute**.
  - "Steve uses this month" **incremented by exactly 1** (the summary).
- [ ] Repeat with a **group voice note** (same increments).
- [ ] Repeat with a **feed audio post** (same increments + `community_id`
      populated in `ai_usage_log`).

## §4 — Daily vs monthly counters

Reproduces the "monthly < daily" bug.

- [ ] Send 3 DMs to Steve from a fresh test account.
- [ ] In Manage Membership → AI Usage, confirm:
  - "Steve uses today" = 3.
  - "Steve uses this month" ≥ 3.
- [ ] Daily must **never** exceed monthly. If it does, this is the old
      bug resurrected — flip `ai_usage:daily_vs_monthly` to
      `unsuccessful` on the Tests page and file a P0.

## §5 — Enterprise seat join flow

Uses `test_doublepay` (has personal Premium) to verify the IAP nag.

- [ ] Log in as `test_doublepay` on the client.
- [ ] Visit the ACME community page; confirm the **"Premium already
      included with Enterprise — avoid double-paying"** banner shows.
- [ ] Trigger the nag dispatch manually:
  ```powershell
  $secret = gcloud secrets versions access latest --secret=cron-shared-secret-staging --project=cpoint-127c2
  curl -X POST -H "X-Cron-Secret: $secret" `
    https://cpoint-app-staging-739552904126.europe-west1.run.app/api/cron/enterprise/nag-dispatch
  ```
- [ ] Response should be `200` with a count of nags sent.
- [ ] Log into the `test_doublepay` account — a push / in-app banner
      should be present.

## §6 — Enterprise seat end flow

- [ ] In the admin-web Enterprise tab, find the `test_enterprise` seat.
- [ ] Click **Force end seat**.
- [ ] Confirm the seat row moves from Active → Ended in the UI.
- [ ] Log in as `test_enterprise` on the client — Steve should still
      work for the grace window (default 7 days).
- [ ] In `subscription_audit_log`, confirm a row with
      `action = 'seat_ended_by_admin'`.

## §7 — Winback promo

- [ ] Force-end the seat of a user who had `had_personal_premium_at_join=1`
      and `return_intent=0` (e.g. run a SQL update to set return_intent=1
      first, to enter the winback path).
- [ ] Confirm a row lands in `winback_tokens`.
- [ ] Visit the client — a winback banner at €3.99 first-month should
      appear on the Account Settings page.

## §8 — Entitlements gating

- [ ] As `test_free`, try to open a DM with Steve. Client should show
      the "Upgrade to Premium" modal (not a generic 401 / 500).
- [ ] As `test_premium`, the same action should succeed.
- [ ] As `test_trial`, same — trial gets Steve.
- [ ] As `test_special`, same — unlimited.

## §9 — Credits & Entitlements KB edit round-trip

- [ ] In admin-web, edit `Pricing → Credits & Entitlements` and
      change `steve_uses_per_month_user_facing` from 100 → 50.
- [ ] Save with reason `"QA — temporary cap for testing"`.
- [ ] As `test_premium`, verify Manage Membership → AI Usage now shows
      `0 / 50` (not `0 / 100`).
- [ ] Revert the edit back to 100.

## §10 — Free-tier community & member caps

Locks the April-2026 bug where Free users were capped at 100 members /
2 communities regardless of what the KB said.

**Automated harness:** most of this section is already covered by
`scripts/run_qa_verification.py` (24 checks for §8, 4 checks for the
26-member block, 5 checks for Scope A). Run it before falling back to
the manual UI steps below:

```powershell
$env:MYSQL_PASSWORD = (gcloud secrets versions access latest --secret=mysql-password)
$env:MYSQL_HOST = "34.78.168.84"; $env:MYSQL_USER = "app_user"; $env:MYSQL_DB = "cpoint"
python scripts/run_qa_verification.py
```

Expected: `36 PASS, 0 FAIL` against a healthy staging DB.

**Manual UI verification (do one of these per release):**

- [ ] As `test_free`, create 5 communities — the 5th must succeed.
- [ ] As `test_free`, attempt to create a 6th community — the client
      must show "Free plan can create up to 5 communities" and the API
      must return a 4xx (not 500).
- [ ] Pick any Free-owned community and add 25 members (the seed
      script already does this via synthetic users; otherwise invite
      25 real testers). The 25th must succeed.
- [ ] Attempt to add a 26th member — client shows
      `"Free plan communities can have up to 25 members. Upgrade to
      add more members."` and API returns a 4xx.
- [ ] In admin-web, edit `Product → User Tiers` and change
      `free_members_per_owned_community` from 25 → 30. Save with a
      reason. Re-run `scripts/run_qa_verification.py` and confirm the
      `[PASS] test_free: members_per_owned_community — got=30` line.
      Revert the edit when done.

---

## Teardown

After every QA pass:

```powershell
# Dry-run first so you can see what will be deleted.
python scripts/teardown_staging_test_users.py
# When satisfied:
python scripts/teardown_staging_test_users.py --confirm
```

## Reporting

- Update the relevant row on the **KB → Audit → Tests** page (or click
  Run now from the admin-web).
- File unsuccessful steps as GitHub issues with:
  - The Tests-page row ID (e.g. `manual:enterprise_invite_nag`).
  - Steps taken + observed vs expected.
  - Screenshots / network-tab traces where useful.
