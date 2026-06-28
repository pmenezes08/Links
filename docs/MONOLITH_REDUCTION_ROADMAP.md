# Monolith reduction roadmap

> **Living doc:** When epic priorities, acceptance criteria, or line-count references change—update this file and **KB → Product Roadmap** status in the **same change**; see **`AGENTS.md` § Living engineering docs**.

Engineering initiative to shrink oversized modules so **humans and agents** can change behaviour safely. This file is the **repo-side** breakdown; **in-app** rows on **KB → Planning → Product Roadmap** track status and tests (`knowledge_base.py` seeds).

**Goals**

- Fewer merge conflicts and easier code review.
- **Agent context** stays within what a single edit can reason about.
- **Shared boundaries** (chat kernel, blueprint vs service) match `AGENTS.md` backend rules.

**Non-goals**

- Rewriting working features for style alone; each slice ships with the same user-visible behaviour unless explicitly a bugfix.

---

## Priority order (suggested)

1. **Chat surfaces (client)** — Highest duplication today between DM and group (`ChatThread.tsx` vs `GroupChatThread.tsx`). Extract **shared hooks and presentational pieces** under `client/src/chat/` first; pages remain thin routers.
2. **`group_chat` blueprint (backend)** — Largest blueprint; move logic into **`backend/services/`** modules by concern (messages, membership, media) keeping HTTP in the blueprint.
3. **Community feed + post detail (client)** — `CommunityFeed.tsx` and `PostDetail.tsx` are the next-largest UI monoliths; split by **feature verticals** (composer, media, stories, modals) + hooks.
4. **Large services** — `knowledge_base.py`, `steve_knowledge_base.py`, `networking_retrieval.py`: split by **read path vs seed vs admin** (or domain), not arbitrary file chops.
5. **Flask monolith** — `bodybuilding_app.py` legacy routes: migrate to blueprints per `AGENTS.md` when touching an area; no new routes in the monolith.
6. **App routing shell** — Split `AppRoutes` / route tables out of `App.tsx` by **domain** (`routes/chat.tsx`, `routes/community.tsx`, …) when doing adjacent work.

---

## Epics (map to Product Roadmap rows)

| Epic | Hot spots | Acceptance idea |
|------|-----------|-----------------|
| **Chat UI kernel** | `client/src/pages/ChatThread.tsx`, `GroupChatThread.tsx`, `client/src/chat/*` | New DM/group behaviour added via **shared** `chat/` modules (`useChatThreadScroll`, `useChatComposerChrome`, `scrollPin.ts`, `useDmMessagePoll`, `useGroupMessagePoll`, `ChatThreadShell`, `ChatComposerPortal`, `ChatVirtualMessageList`, `NewMessagesChip`, `SwipeToReply`, `useNativeStatusBar`, `useAndroidBackButton`, `useResumeOutboxDrain`); page files mostly wire routes + layout. **`backend/blueprints/dm_chats.py`** now owns **`POST /get_messages`**, **`POST /send_message`**, **`POST /send_photo_message`**, **`POST /send_dm_media`**, **`POST /send_video_message`**, **`POST /send_audio_message`**, **`POST /api/chat/react_to_message`**, thread prefs/archive/active (`dm_thread_preferences`, `dm_thread_archive`, `dm_active_chat`), and message ops (`dm_message_delete`, `dm_message_edit`, `dm_audio_summary`, `dm_chat_media_list`) — logic in **`dm_send_message`**, **`dm_send_media`**, and related services; removed from monolith; duplicate **`POST /delete_chat`** retired (use **`POST /delete_chat_thread`**). |
| **Community surfaces** | `CommunityFeed.tsx`, `PostDetail.tsx` | Feed/post changes touch **named subcomponents/hooks**; no single-file 5k-line growth. |

Recent split: poll rendering/voting now lives in `client/src/components/feed/PollCard.tsx` and `client/src/hooks/usePollVote.ts`, shared by `CommunityFeed.tsx` and `PostDetail.tsx`.
| **Group chat API** | `backend/blueprints/group_chat.py` | Blueprint handlers stay thin; complex logic in **importable services** with unit tests where feasible. **`GET /api/group_chat/<id>/messages`** read path lives in **`backend/services/group_chat_messages.py`**. **Chat Media v2:** presigned upload routes removed from blueprint; use **`backend/blueprints/chat_uploads.py`** + **`backend/services/chat_uploads.py`**. |
| **KB / Steve / retrieval services** | `backend/services/knowledge_base.py`, `steve_knowledge_base.py`, `networking_retrieval.py` | Clear module boundaries (e.g. seeds vs runtime resolution vs RAG); no circular imports. |
| **Flask monolith retirement** | `bodybuilding_app.py` | Net reduction of `@app.route` surface over time; new work only in blueprints. |

---

## Cursor rules

See **`.cursor/rules/frontend-pages-and-routing.mdc`**, **`.cursor/rules/chat-surfaces.mdc`**, **`.cursor/rules/backend-monolith-boundaries.mdc`** — applied when editing matching paths.

---

## Reference line counts (approximate; re-check after refactors)

| Area | File | ~Lines |
|------|------|--------|
| Client | `pages/CommunityFeed.tsx` | 5,400+ |
| Client | `pages/ChatThread.tsx` | 4,300+ |
| Client | `pages/GroupChatThread.tsx` | 3,900+ |
| Client | `pages/PostDetail.tsx` | 2,900+ |
| Client | `pages/OnboardingChat.tsx` | 2,700+ |
| Flask | `bodybuilding_app.py` | 33,000+ |
| Blueprint | `backend/blueprints/group_chat.py` | 3,200+ |
| Service | `backend/services/steve_knowledge_base.py` | 2,300+ |
| Service | `backend/services/knowledge_base.py` | 2,200+ |
| Service | `backend/services/networking_retrieval.py` | 1,500+ |
