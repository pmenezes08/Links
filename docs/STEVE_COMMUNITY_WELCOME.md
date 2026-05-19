# Steve — Community Welcome Posts & Owner DMs

**Status:** Canonical. Read before changing the welcome service, the
welcome cards, or the create-community hook.
**Last updated:** 2026-04-25

When a community is created on c-point, Steve publishes a welcome post in
its feed and (when relevant) DMs the owner. This document is the single
source of truth for **what those messages say** and **when they fire**.

Companion docs:
- `docs/STEVE_PERSONA.md` — global voice rules. Never call Steve an
  assistant.
- `docs/STEVE_AND_VOICE_NOTES.md` — generic Steve service wiring.
- `docs/STEVE_PRIVACY_GATE.md` — privacy gate for KB sharing.

Implementation:
- `backend/services/steve_community_welcome.py`
- Hook point: `bodybuilding_app.py:/create_community` (after commit).
- Backfill command: `flask backfill-steve-welcome [--dry-run]`.
- Republish endpoint: `POST /api/communities/<id>/republish_welcome_post`
  (community owner / admin only) in `backend/blueprints/communities.py`.

---

## Hard invariants

- **Every active community has at most one Steve welcome post.** Tracked via
  `communities.welcome_post_id`. Idempotent on creation, backfill, and
  republish.
- **Welcome posts are card renders, not LLM generations.** Zero token cost.
  Deterministic. Versioned via `welcome_card_version`. Cannot drift or
  hallucinate.
- **Author = `steve`** (lowercase, the AI user). Posts are flagged
  `is_system_post = 1`, `author_kind = 'system'`.
- **Every welcome post is auto-pinned to the *Key Posts* tab** via
  `community_key_posts` so it stays discoverable as the feed grows.
- **Owner cannot delete it for the first 7 days.** Server-enforced in
  `/delete_post`. After 7 days, owner / admin can delete with a confirmation.
- **Re-publish is idempotent.** If the existing welcome post is tombstoned
  (deleted from `posts`) but `welcome_post_id` still points at it, the
  republish path repairs the link by inserting a fresh post and re-stamping
  the FK. If the post still exists, republish is a no-op.
- **System posts do not fan out push notifications.** The welcome service
  bypasses `fanout_community_post_notifications`.
- **Steve never refers to himself as an assistant.** See
  `docs/STEVE_PERSONA.md`. Welcome cards are reviewed against that file.

---

## When does Steve publish?

### On community creation
Hook fires from inside `/create_community` after the DB commit. Always
publishes the welcome post; DM follows the cohort rules below. Failure of
either is logged but never breaks the create-community response.

### On backfill
`flask backfill-steve-welcome` selects every community where
`welcome_post_id IS NULL` (after the skip-list is applied), publishes the
welcome post at `NOW()`, and conditionally DMs the owner based on
`created_at`.

### On owner-triggered republish
Endpoint `POST /api/communities/<id>/republish_welcome_post`. Republishes
the welcome post (idempotent — no-op if a live one already exists). Does
not DM the owner — the owner is the one who pressed the button.

### Skip list
The welcome flow is suppressed for these owners (because they're test /
operator accounts and the post is annoying noise):

- `paulo`
- `admin`
- `steve`

This is hardcoded in `_should_skip_welcome(creator_username)`.

---

## Owner DM cohorts (controls whether the owner gets a DM)

| Cohort | Determined by | Post | DM |
|---|---|---|---|
| Brand-new (just created via `/create_community`) | hook is called with `is_brand_new=True` | yes | yes — standard owner DM |
| Created < 48h ago, missing post (backfill) | `created_at` within 48h | yes | yes — standard owner DM |
| Created 48h–7d ago, missing post (backfill) | `created_at` 48h–7d | yes | yes — late-acknowledgement variant |
| Created > 7d ago, missing post (backfill) | `created_at` older than 7d | yes | no |
| Republish (owner clicks the button) | manual trigger | yes (idempotent) | no |
| Skip-list owner | `creator_username` ∈ skip-list | no | no |

Anywhere we need a "now" boundary for the owner-DM eligibility, we use UTC.

---

## Welcome post — content

The welcome post is one of three card variants, picked from the community
shape:

- `welcome.root` — top-level community (no `parent_community_id`).
- `welcome.sub` — sub-community (has `parent_community_id`).
- `welcome.business` — community where `type = 'business'` (overrides
  root/sub if applicable).

Card body is rendered with these placeholders:

- `{community_name}` — `communities.name`.
- `{parent_community_name}` — only used by `welcome.sub`.

### Card: `welcome.root` (version 1)

```
**Welcome to {community_name} 👋**
*Posted by Steve.*

A quick tour of what's inside:

- **Posts** — share text, photos, videos, audio, links, or polls.
- **Stories** — quick photo/video moments that disappear in 24h.
- **Reactions & replies** — long-press any post to react or reply.
- **Summarise** — tap the **Summarise** button on long threads to get the gist.
- **Key Posts** — pinned highlights live in the *Key Posts* tab so people can find them later.
- **Links & Docs** — every link or document shared here, in one tab.
- **Media** — every photo and video shared here, in one gallery.
- **Hide or report** — see something off? Hide it just for you, or report it.
- **Tag me in** — tag **@steve** in any post or reply if you want my take.

I'm also pinned at the top of your chats — **DM me anytime** for anything.
```

### Card: `welcome.sub` (version 1)

```
**Welcome to {community_name} 👋**
*Posted by Steve.*

This is a sub-space inside **{parent_community_name}** — members of {parent_community_name} can find their way here.

A quick tour of what's inside:

- **Posts** — share text, photos, videos, audio, links, or polls.
- **Stories** — quick photo/video moments that disappear in 24h.
- **Reactions & replies** — long-press any post to react or reply.
- **Summarise** — tap the **Summarise** button on long threads to get the gist.
- **Key Posts** — pinned highlights live in the *Key Posts* tab so people can find them later.
- **Links & Docs** — every link or document shared here, in one tab.
- **Media** — every photo and video shared here, in one gallery.
- **Hide or report** — see something off? Hide it just for you, or report it.
- **Tag me in** — tag **@steve** in any post or reply if you want my take.

I'm also pinned at the top of your chats — **DM me anytime** for anything.
```

### Card: `welcome.business` (version 1)

```
**Welcome to {community_name} 👋**
*Posted by Steve.*

A quick tour of what's inside:

- **Posts** — share text, photos, videos, audio, links, or polls.
- **Stories** — quick photo/video moments that disappear in 24h.
- **Reactions & replies** — long-press any post to react or reply.
- **Summarise** — tap the **Summarise** button on long threads to get the gist.
- **Key Posts** — pinned highlights live in the *Key Posts* tab so people can find them later.
- **Links & Docs** — every link or document shared here, in one tab.
- **Media** — every photo and video shared here, in one gallery.
- **Member directory** — see who's in the community.
- **Hide or report** — see something off? Hide it just for you, or report it.
- **Tag me in** — tag **@steve** in any post or reply if you want my take.

I'm also pinned at the top of your chats — **DM me anytime** for anything.
```

---

## Owner DM — content

### Variant: `dm.standard` (brand-new + < 48h)

```
Hey {owner_first_name} — congrats on **{community_name}**.

I just published a quick welcome post in your feed so people landing here for the first time get the lay of the land. It'll stay in *Key Posts*.

Want a hand getting started? Just tell me — I can help you invite people, set a cover image, write the description, or draft your first post.
```

### Variant: `dm.late` (48h–7d backfill)

```
Hey {owner_first_name} — quick one about **{community_name}**.

I should have done this when you launched, better late than never: I just published a welcome post in your feed so people landing here for the first time get the lay of the land. It'll stay in *Key Posts*.

If you want a hand with cover, description, or first invites, just DM me.
```

`{owner_first_name}` falls back to the username (without the `@`) when the
profile has no first name.

---

## Versioning & drift control

Each welcome post is stamped with:

- `welcome_card_key` (e.g. `welcome.root`, `welcome.sub`, `welcome.business`)
- `welcome_card_version` (integer; bump when card body changes)

When you edit the body of a card here:

1. Bump the `WELCOME_CARD_VERSION` constant in
   `backend/services/steve_community_welcome.py`.
2. Update the date at the top of this document.
3. (Optional) decide whether existing posts should auto-refresh. The default
   is **no** — historical posts remain at their stamped version. We do not
   silently rewrite the past. If a global refresh is genuinely required,
   write a one-off migration that re-renders content for matching
   `welcome_card_key + welcome_card_version <  CURRENT`.
4. Run `flask backfill-steve-welcome --dry-run` to confirm the cohort.

---

## QA — see `docs/QA_CHECKLIST.md`

Add a new section `§13 — Steve Community Welcome` covering:

1. Create a fresh community → welcome post appears, pinned in Key Posts.
2. Create a fresh community → owner gets the standard DM.
3. Skip-list owner (`paulo`) creates a community → no welcome post, no DM.
4. Owner tries to delete the welcome post within 7 days → blocked with
   friendly error.
5. Owner deletes the welcome post after 7 days → succeeds.
6. Owner clicks "Republish welcome post" with a live post present → no-op.
7. Owner clicks "Republish welcome post" with a tombstoned post → fresh
   post created, FK repaired.
8. Run `flask backfill-steve-welcome --dry-run` against staging → reports
   the cohort split (post-only / post + DM) without changing anything.
9. Run `flask backfill-steve-welcome` for real → posts created, owners in
   the right cohort get DMs.
10. Steve is **never** referred to as an assistant in any of the above.
