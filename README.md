# Secure Messaging Platform — Signal Clone

A functional clone of Signal Messenger: register with a phone number, manage
contacts, hold one-on-one and group conversations, and send and receive messages
in real time — inside a recreation of Signal Desktop's interface.

Encryption is **simulated**, as the assignment allows. Everything else — the
messaging, receipts, presence, group administration and persistence — is real.

Beyond the brief it also ships **voice messages**, message **editing** and
**forwarding**, group **read-receipt avatars**, an **unread divider** and
**desktop notifications** — see [Beyond the brief](#-beyond-the-brief).

```
.
├── backend/     FastAPI + SQLAlchemy + SQLite + WebSockets   → deploy to Render
└── frontend/    Next.js (TypeScript) + Tailwind + Zustand    → deploy to Vercel
```

Each folder is self-contained and deploys independently. See
[`backend/README.md`](backend/README.md) and
[`frontend/README.md`](frontend/README.md) for per-service detail, including the
full API reference and schema notes.

---

## Quick start

Two terminals:

```bash
# 1 — backend
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```bash
# 2 — frontend
cd frontend
npm install
cp .env.local.example .env.local      # NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
npm run dev
```

Open <http://localhost:3000>.

The database is created and seeded on first boot — eight users, six direct
threads and three groups with history — so the app is usable immediately.

### Signing in

Verification is mocked: **the code is always `123456`** for every account. The
onboarding screen offers four demo accounts as one-click buttons.

| Phone          | Name          |
| -------------- | ------------- |
| `+15550100001` | Prithvi Ahuja |
| `+15550100002` | Aisha Khan    |
| `+15550100003` | Rohan Mehta   |
| `+15550100004` | Meera Iyer    |

(`+15550100005` – `+15550100008` also exist: Dev Sharma, Sara Lopez, Arjun Nair,
Nina Patel.)

**To see real-time messaging**, open the app in two browsers — or one normal and
one private window — and sign in as two different people. Typing indicators,
delivery, read receipts and presence all update live.

---

## Features

### Authentication / onboarding
- Phone-number registration with a mocked fixed OTP.
- Display name, optional username, about line, and a Signal avatar colour.
- Login, logout, and session persistence via a JWT in `localStorage`.

### Contacts and conversation list
- Conversations sorted by most recent activity, with pinned chats on top.
- One search box over conversation titles, people, and message bodies.
- Add a contact by phone number or username.
- Unread badges and last-message previews ("You: …", sender name in groups).
- Live online dots and "last seen" subtitles.
- All / Unread filter chips.

### One-on-one messaging
- Real-time delivery over WebSockets.
- Timestamps in every bubble, with date dividers between days.
- Delivery and read receipts — the single/double check experience.
- Typing indicators, in both the chat pane and the conversation list.
- Full status lifecycle: sending → sent → delivered → read, plus a retryable
  failed state.
- Everything persists in SQLite.

### Group messaging
- Create a group with a name and members.
- Real-time group messaging with per-sender colours and avatars.
- View members; add, remove and promote to admin (admin-gated).
- Leave a group; system messages record every membership change.
- All group data and messages persist.

### The Signal experience
- Nav rail + conversation list + chat pane, with a details drawer.
- Signal's bubble shapes, including squared corners within a run of messages.
- Modals for new chat, new group and add contact; search and filters.
- In-app toast notifications for messages arriving in background threads.
- Settings with profile editing, appearance, and placeholder sections.

### Placeholders (as permitted)
Voice and video calls, Stories, linked devices, and real end-to-end encryption
are present as clearly-labelled "Coming soon" surfaces.

### Bonus features implemented
- Attachments — images and files, with captions, inline photo rendering and
  download chips.
- Message reactions (emoji), one per person, toggleable.
- Reply-to / quoted messages.
- Disappearing messages — functional, with a server-side timer and purge.
- Delete for everyone, leaving a tombstone in the thread.
- Dark mode, following the system preference and toggleable.
- Responsive layout for mobile, tablet and desktop.
- Keyboard shortcuts.

All seven bonus items from the brief are implemented.

---

## ⭐ Beyond the brief

The brief did not ask for any of the following. They were added because they
are the details that separate "a chat app" from "feels like Signal", and each
one is wired end to end — schema, API, websocket broadcast and UI.

### 🎤 Voice messages

Hold the microphone in the composer and talk. The browser records through
`MediaRecorder`, the clip uploads through the same authenticated attachment
pipeline as photos and files, and it arrives as a Signal-style player: a
play/pause control, a seekable waveform and a running timer.

- **Format negotiation.** Chrome and Firefox record webm/opus; Safari only
  offers mp4/aac. The recorder asks the browser what it supports rather than
  hard-coding a container, and the file extension follows.
- **Duration is measured client-side** and stored on the message
  (`attachment_duration_ms`). Recorded webm frequently reports `Infinity` for
  `duration`, so the player trusts the sender's measurement and only falls
  back to the audio element.
- **The microphone track is always released** on send, cancel or unmount, so
  the browser's recording indicator never stays lit.
- Clips under half a second are rejected as accidental taps, and the
  conversation list previews them as "🎤 Voice message".

### ✏️ Message editing

Edit your own text from the bubble menu. The composer switches into an edit
mode with a banner, Escape cancels, and the saved message carries a quiet
"edited" marker next to its timestamp — exactly like Signal. The edit
broadcasts over the existing `message:updated` channel, so every participant's
thread *and* chat-list preview update live. Attachments and system messages
are deliberately not editable, and the API rejects editing someone else's
message with a 403.

### ↪️ Message forwarding

Forward any message into one or more other conversations from a searchable
picker that shows exactly what is being sent. Forwarded copies are
**independent rows, not pointers** — deleting the original later cannot blank
out what people already received. The reply context is intentionally dropped,
since it would reference a message the new audience cannot see, and membership
is re-checked per target so the endpoint cannot be used to post into a
conversation you are not part of.

### 👀 Read-receipt avatars

In a group, your most recent message shows a small stack of avatars for the
people who have actually opened it, with a tooltip naming them. This is the
`message_receipts` table paying off: because delivery and read state are
stored per recipient rather than as a single column, "who has seen this" is a
question the schema can already answer.

### 🔴 Unread divider

Opening a thread with unread messages draws Signal's red "Unread messages"
rule immediately above the first one you have not seen. The boundary is
**frozen at the moment you open the thread**, before it is marked read, so the
line stays where it is while you read instead of sliding to the bottom.

### 🔔 Desktop notifications

Opt in from Settings → Notifications and new messages raise a real OS
notification while the tab is in the background; clicking one focuses the app.
Muted conversations stay silent, the in-app toast is used instead when the
window is already visible, and the preference survives reloads. No push
service or service worker is required.

---

### Engineering extras

- **Additive auto-migration.** `create_all` builds missing tables but never
  alters existing ones, so pulling new code used to mean a stale database
  rejecting every query. On startup the app now diffs each mapped table
  against `PRAGMA table_info` and issues `ALTER TABLE ... ADD COLUMN` for
  anything missing. It is additive only — it can never drop or retype a
  column, so it cannot destroy data. (Alembic would be the answer at real
  scale; this keeps a single-file SQLite demo honest.)
- **Guarded history paging.** A short thread opens at `scrollTop: 0`, which
  fired the "load older" handler repeatedly and prepended the same page more
  than once. Paging now holds a per-conversation in-flight lock, de-duplicates
  by message id, and stops asking once the top of the thread is reached.

---

## Architecture

```
┌────────────────────────────┐          ┌──────────────────────────────┐
│  Next.js (Vercel)          │          │  FastAPI (Render)            │
│                            │  REST    │                              │
│  components  ─┐            │ ───────► │  api/routes/*  ──┐           │
│               ├─ store ────┤          │                  ├─ services │
│  lib/api.ts  ─┘   (zustand)│ ◄─────── │  realtime/hub  ──┘     │     │
│  lib/socket.ts             │    WS    │                        ▼     │
└────────────────────────────┘          │           SQLAlchemy ──► SQLite
                                        └──────────────────────────────┘
```

**Writes go over REST, broadcasts come back over the WebSocket.** Sending is an
ordinary `POST`, so a failure surfaces as a real HTTP error the UI can act on;
the server then fans the saved message out to every member's sockets. The
socket also accepts `message:send` for a pure-websocket path.

**The hub broadcasts by user id, never by conversation.** Routes resolve a
conversation to its member ids and hand them over. The hub therefore knows
nothing about the database, and swapping it for Redis pub/sub to run multiple
workers would not touch any route.

**Receipts are per-recipient rows, not a column.** `message_receipts` holds one
row per recipient with `delivered_at` and `read_at`; `messages.status` is the
collapsed aggregate the sender's check marks render. That is what makes read
receipts correct in groups, where "read" means *everyone* has opened the
thread — and it is also what lets the UI show *which* people have seen your
last group message.

**One table for direct threads and groups.** A `conversations.type` discriminator
keeps the inbox query, the message pipeline and the fan-out on a single code
path, with `conversation_members.role` carrying group admin rights.

### Database schema

```
users ──┬── contacts (owner_id / contact_user_id — self-referential M2M)
        │
        ├── conversation_members ──── conversations
        │                                   │
        └── messages ───────────────────────┘
               ├── message_receipts   (per-recipient delivered/read)
               └── message_reactions  (per-user emoji)
```

| Table                  | Key columns                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| `users`                | `phone` (unique), `username` (unique), `display_name`, `about`, `avatar_color`, `is_online`, `last_seen_at`     |
| `contacts`             | `owner_id`, `contact_user_id`, `nickname` — unique per pair                                                     |
| `conversations`        | `type` (`direct`/`group`), `name`, `description`, `disappearing_seconds`, `last_message_at` (denormalised)      |
| `conversation_members` | `conversation_id`, `user_id`, `role`, `last_read_at`, `is_muted`, `is_pinned` — unique per pair                 |
| `messages`             | `conversation_id`, `sender_id`, `kind` (`text`/`image`/`file`/`audio`/`system`), `body`, `status`, `reply_to_id`, `attachment_url`/`_name`/`_mime`/`_size`/`_duration_ms`, `edited_at`, `is_forwarded`, `expires_at`, `deleted_at`, `created_at`|
| `message_receipts`     | `message_id`, `user_id`, `delivered_at`, `read_at` — unique per pair                                            |
| `message_reactions`    | `message_id`, `user_id`, `emoji` — unique per triple                                                            |

Column-by-column notes are in [`backend/README.md`](backend/README.md#database-schema)
and the schema itself is documented inline in `backend/app/db/models.py`.

---

## Deployment

The two folders deploy separately.

**Backend → Render.** New Web Service, root directory `backend`, build
`pip install -r requirements.txt`, start
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health check `/health`. Set
`JWT_SECRET`, and set `CORS_ORIGINS` to the frontend URL once it exists. A
`render.yaml` blueprint is included.

**Frontend → Vercel.** Import the repo, root directory `frontend`, and set
`NEXT_PUBLIC_API_URL` to the Render URL (no trailing slash). Redeploy the
backend afterwards with `CORS_ORIGINS` pointed at the Vercel URL.

Order matters only in that the frontend needs the backend's URL at build time;
deploy the backend first.

### A note on SQLite and uploads in production

Render's free instances have no persistent disk, so the SQLite file and the
`uploads/` directory both live in the container filesystem and are recreated on
each deploy. The seeder runs automatically against an empty database, so the
deployed demo is always populated — but messages and attachments sent before a
redeploy will not survive it. For durable storage, attach a Render disk and set
`DATABASE_URL=sqlite+aiosqlite:////var/data/signal.db` and
`UPLOAD_DIR=/var/data/uploads`.

Free instances also idle after inactivity; the first request after a cold start
takes a few seconds, and the frontend's websocket reconnects with backoff on its
own.

---

## Assumptions

- **Verification is mocked.** Any phone number is accepted and the code is always
  `123456`. There are no passwords; sessions are real signed JWTs.
- **Encryption is simulated.** Message bodies are stored in plain text. The
  Settings screen states this in the app.
- **Presence is genuine**, derived from live websocket connections rather than
  faked.
- **One reaction per person per message**, matching Signal.
- **Deletes are "for everyone"** and soft, so the tombstone remains visible.
- **The websocket hub is in-process**, so the backend assumes a single worker.
- **Attachments are stored on the backend's local disk** and served from
  `/uploads/<random-uuid>`. Uploads are authenticated, size-capped and
  type-restricted, but the static URL itself is unauthenticated — unguessable
  rather than access-controlled. Object storage with signed URLs is the
  production answer.

## Feature map

Where to look when reviewing a particular behaviour:

| Behaviour | Backend | Frontend |
| --- | --- | --- |
| Voice messages | `api/routes/uploads.py` (audio allow-list) | `lib/recorder.ts`, `components/VoiceNote.tsx`, `components/Composer.tsx` |
| Message editing | `api/routes/messages.py` (`PATCH`), `services/messages.py` | `components/Composer.tsx`, `components/MessageBubble.tsx` |
| Message forwarding | `api/routes/messages.py` (`POST .../forward`) | `components/ForwardModal.tsx` |
| Read-receipt avatars | `message_receipts` + `read_by` in the serializer | `components/ChatPane.tsx` (`ReadReceipts`) |
| Unread divider | `my_last_read_at` on the conversation | `store/useAppStore.ts` (`unreadBoundary`), `ChatPane.tsx` |
| Desktop notifications | — (client only) | `store/useAppStore.ts`, `components/SettingsPane.tsx` |
| Realtime fan-out | `realtime/hub.py`, `api/routes/ws.py` | `lib/socket.ts` |

## Tech stack summary

| Layer     | Technology                                           |
| --------- | ---------------------------------------------------- |
| Frontend  | Next.js 15 (App Router), TypeScript, Tailwind CSS, Zustand |
| Backend   | FastAPI, SQLAlchemy 2.0 (async), Pydantic v2         |
| Database  | SQLite (`aiosqlite`)                                 |
| Realtime  | Native WebSockets                                    |
| Auth      | JWT bearer tokens, mocked OTP                        |
| Hosting   | Vercel (frontend) · Render (backend)                 |
