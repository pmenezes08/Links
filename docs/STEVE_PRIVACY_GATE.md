# Steve Privacy Gate for User KB / Profiling

**Last updated:** 2026-04-23  
**Status:** Canonical reference for all agents. Read before touching any Steve context, profiling, or KB code.

This document defines the privacy rules for when Steve can access and share a user's synthesized Knowledge Base (stored in Firestore `steve_user_profiles` and synthesized in `backend/services/steve_knowledge_base.py`).

## Core Principle

**The single reusable function `user_can_access_steve_kb(viewer_username, target_username, context=None)` must be called BEFORE any call to `get_steve_context_for_user`, KB synthesis, or Firestore read.** 

- If `true` → proceed with full KB.
- If `false` → return empty context. Steve must respond with "I don't recognise that user" (or equivalent honest statement). Do not fall back to basic profile data.

The function lives in a blueprint service (not the monolith).

## Bypass Users (Literal Usernames)
- `"paulo"`
- `"admin"`

These two accounts (and Steve internally) always bypass and receive full KB. No other users bypass (including `is_special=1`, Enterprise seats, or Premium users — those are revenue-only flags).

## Connection Rules

### Community Activity (Feed, Post Detail, Comments, Replies, Nested Replies)
- **Permissive root-parent check**.
- Resolve the **root/parent community** of the community in which the *original post was created* (use existing `_get_user_network_ids` logic from `steve_knowledge_base.py`).
- If target user is a member of that root parent network → allow full KB.
- Example: Parent A (10k members) contains Sub B (20 members). User in B asking about User Y (only in A, not in B) → allowed.
- Even if viewed from a different community Z, anchor to the post's original community's root parent.

### Group Chats
- **Strict intersection rule**.
- Compute root networks for *all current group members*.
- If any group member does not share a root network with the target → KB must be empty for the entire group.
- Applies to both full KB and the fallback basic profile block.
- **Natural-language references count**: bare names (no `@`) that match a known platform username are gated identically to explicit `@mentions`. Any candidate that fails the gate is added to the system prompt's `BLOCKED USERS` list.
- **Community intelligence must also be gated**: the mutual-communities enrichment block in `_build_community_intelligence` may only include users whose root networks intersect the group-wide root intersection. Posts authored by blocked users are dropped before reaching Steve's prompt.

### DMs
- Simple asker (`viewer_username`) vs target check using the same root-network logic.

## Implementation Requirements

- **Single reusable function**: `user_can_access_steve_kb(...)` in a blueprint (e.g. `backend/blueprints/steve_privacy.py` or `backend/services/steve_profiling_gates.py` extension). Must be called first in all paths.
- **No additions to monolith** (`bodybuilding_app.py`). Use blueprints only. Minimal wiring only where necessary.
- **Caching**: Cache key must include viewer and root network/community context to avoid stale results. Invalidate on membership changes.
- **Historical data**: Current root-network membership check blocks old synthesized insights from communities the user has left.
- **Prompts**: Update system prompts in group chat, community reply paths, and DMs to reinforce honest "I don't have information" responses.
- **QA**: Add test cases to `docs/QA_CHECKLIST.md` covering all scenarios, bypass users, sub-community vs parent, group intersection, DM vs community, and cache behavior.

## Call Sites (Key Files)

- `backend/blueprints/group_chat.py` — `_trigger_steve_group_reply`: explicit `@mention` gate, natural-language candidate detection (`extract_candidate_usernames` + `filter_usernames_for_group`), `BLOCKED USERS` clause in the system prompt, and gated `_build_community_intelligence(group_id, sender_username)`.
- DM reply path in monolith (`_trigger_steve_dm_reply` — minimal wiring only).
- `client/src/pages/PostDetail.tsx`, `client/src/pages/CommentReply.tsx` (Steve reply flows, `@steve` detection — gate enforced backend-side).
- Community feed and `backend/blueprints/communities.py` (personality, automation).
- `bodybuilding_app.py:get_steve_context_for_user` (central KB fetch; must be preceded by the gate).
- `backend/services/steve_profiling_gates.py` — canonical gate + helpers (`user_can_access_steve_kb`, `compute_group_root_intersection`, `filter_usernames_for_group`, `extract_candidate_usernames`, `_user_root_networks`).

## Architecture

```mermaid
graph TD
    A[User Action @Steve or question] --> B{Surface?}
    B -->|Community| C[Resolve post's original community → root parent]
    B -->|Group Chat| D[Intersection of all group members' root networks]
    B -->|DM| E[Simple viewer vs target]
    C & D & E --> F[steve_privacy.user_can_access_steve_kb<br/>(viewer, target, context)]
    F -->|true| G[Fetch KB via get_steve_context_for_user]
    F -->|false| H[Return empty + "I don't recognise this user"]
    G --> I[Steve Reply]
```

This document is the single source of truth. Any agent implementing or touching Steve profiling must update this file if rules change.

**Commits (as specified)**
1. Documentation + reusable function skeleton
2. DMs implementation
3. Group Chats implementation
4. Community Context implementation (feed, posts, comments, replies, nested replies)

All changes must respect the "before KB fetch" invariant and use blueprints.
