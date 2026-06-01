# Chat Media Upload v2 — API & policy spec

Living reference for the resumable multipart upload pipeline (DM + group chat).

## Policy decisions (locked)

1. **Client-first compression** — videos optimized on-device before upload; server HEVC→H.264 only as async fallback.
2. **All chat media via multipart** — no new single-PUT or Cloud Run blob proxy paths for chat.
3. **Posts/stories** — out of scope for v2; reuse kernel in a follow-up.
4. **Upload caps** — KB-backed `chat_media_max_bytes` / `chat_media_max_daily` enforced at `init`.
5. **Background uploads** — web/native WebView resumes from IndexedDB outbox when C-Point returns to the foreground. True app-closed native background upload is deferred until a Capacitor URLSession/WorkManager bridge ships.
6. **Quality choice** — videos expose Standard / HD in preview. Standard runs best-effort optimization; HD preserves the original where possible.

## Session API

| Route | Body | Response |
|-------|------|----------|
| `POST /api/chat/uploads/init` | `{ context, filename, content_type, expected_bytes, media_kind }` | `{ session_id, upload_id, part_size, key, public_url }` |
| `POST /api/chat/uploads/part-url` | `{ session_id, part_number }` | `{ upload_url }` |
| `POST /api/chat/uploads/complete` | `{ session_id, parts?: [{ part_number, etag? }] }` | `{ public_url, key }` |
| `POST /api/chat/uploads/abort` | `{ session_id }` | `{ success }` |

### Context shapes

- DM: `{ "type": "dm", "recipient_id": "<user id>" }`
- Group: `{ "type": "group", "group_id": <int> }`

### Auth invariants

- DM init: recipient exists + not blocked.
- Group init: active membership.
- All mutating routes re-verify session owner + context validity.
- Part presigned TTL: 15 min; session TTL: 1 h.

## Client flow

1. Optional transcode/compress (`videoTranscode.ts` / `compressImageForUpload`).
2. `init` → upload parts with per-part retry → `complete`.
3. Existing send endpoint with `media_urls` JSON only.
4. Persist progress in `mediaOutbox` (IndexedDB v2, ArrayBuffer blobs — best-effort; upload proceeds if IDB fails).
5. Media send endpoints receive the same `client_key` as the optimistic bubble so commit retries are idempotent.

**ETag / CORS:** Browser PUT to R2 presigned URLs often cannot read the `ETag` response header unless the bucket CORS rule exposes it. The client treats a successful part PUT as complete even without ETag; on `complete`, the server calls R2 `ListParts` to resolve ETags when the client omits them.

## v2.1: outbox resume, caps UX, and quality

- `MediaOutboxRecord` now stores upload session metadata (`sessionId`, `uploadId`, `partSize`, `key`, `publicUrl`), `completedParts`, uploaded URL, status, retry count, and a short-lived lock so app-level and thread-level resume hooks cannot process the same job twice.
- `uploadChatMediaBlob` accepts a `resumeRecord` and forwards stored `completedParts` into `uploadMultipartBlob({ resumeParts })`, so foreground/app-return retry skips parts already uploaded to R2.
- If an upload completed but message commit did not, resume retries only `/send_dm_media` or `/api/group_chat/:id/send_media` with the stored URL and `client_key`.
- `/send_dm_media`, `/send_video_message`, and `/api/group_chat/:id/send_media` accept `client_key` for idempotency. Retrying a commit with the same key returns the existing message instead of creating a duplicate.
- Client upload cap blocks from `/api/chat/uploads/init` (`upload_size_limit`, `upload_daily_limit`) are converted into the shared entitlements surface instead of raw upload errors.
- User-facing copy avoids storage terms: “Sending...”, “Sent”, “Not sent — tap to retry”. Technical errors such as ETag/CORS/IndexedDB/R2 are logged only.

## v2.2: user control and recovery

- DM and group media gallery pages support selection mode and viewer-level delete for media the current user is authorized to remove. Bulk delete uses `POST /api/chat/dm/remove_media_bulk` and `POST /api/group_chat/<group_id>/remove_media_bulk`; the backend removes only authorized items and returns removed/failed counts.
- Gallery deletes update MySQL and Firestore mirrors through the same media update/delete helpers as single attachment removal, and now physically purge the authorized object from R2/local upload storage. If a media-only message loses its final attachment, the existing soft/hard delete behavior is used; stale clients render a "Media deleted" placeholder instead of a broken image/video.
- Active v2 uploads register an `AbortController` by optimistic `clientKey`. The visible upload banner exposes a cancel action; cancel aborts fetches, calls multipart abort through `uploadChatMediaBlob`, removes the outbox row/blob, and removes the optimistic bubble.
- App-level resume is the primary runner and runs on mount/focus/native foreground. Upload rows heartbeat `lockedAt` while active, stale lock recovery is about 60 seconds, ghost `uploading`/`committing` rows become failed, and automatic resume stops after five attempts.
- Missing IndexedDB blobs (unrecoverable) are silently cleaned from the outbox with no user-facing toast; only resume-progress and retry-limit messages are surfaced during active recovery attempts. The UI still avoids promising true app-closed background upload; native URLSession/WorkManager remains a future phase.

## Metrics

Client logs `chat_upload_metric` events (duration, bytes, parts, retries, failure_reason).
Server logs structured fields on init/complete/abort/janitor.

## Janitor

`POST /api/cron/chat-uploads-janitor` — aborts expired multipart sessions and marks DB rows expired.
