# Signal Clone — Backend (FastAPI)

REST + WebSocket API for the Signal clone: mocked phone onboarding, contacts,
direct and group conversations, real-time messaging, receipts and reactions.

## Stack

| Concern    | Choice                                        |
| ---------- | --------------------------------------------- |
| Framework  | FastAPI                                       |
| ORM        | SQLAlchemy 2.0 (async)                        |
| Database   | SQLite via `aiosqlite`                        |
| Realtime   | Native WebSockets, in-process connection hub  |
| Auth       | JWT bearer tokens (PyJWT), mocked OTP         |

## Running locally

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env          # optional — defaults work as-is

uvicorn app.main:app --reload --port 8000
```

- API: <http://127.0.0.1:8000>
- Interactive docs: <http://127.0.0.1:8000/docs>
- Health check: <http://127.0.0.1:8000/health>

The database is created and seeded automatically on first boot. To reseed, delete
`signal.db` and restart, or run the seeder directly:

```bash
python -m app.seed
```

## Demo accounts

Every seeded account signs in with the fixed code **`123456`**.

| Phone          | Name          | Username  |
| -------------- | ------------- | --------- |
| `+15550100001` | Prithvi Ahuja | `@prithvi`|
| `+15550100002` | Aisha Khan    | `@aisha`  |
| `+15550100003` | Rohan Mehta   | `@rohan`  |
| `+15550100004` | Meera Iyer    | `@meera`  |
| `+15550100005` | Dev Sharma    | `@dev`    |
| `+15550100006` | Sara Lopez    | `@sara`   |
| `+15550100007` | Arjun Nair    | `@arjun`  |
| `+15550100008` | Nina Patel    | `@nina`   |

## Project layout

```
app/
  main.py              FastAPI app, CORS, router mounting, startup/seed
  core/
    config.py          Pydantic settings from the environment
    security.py        JWT issue/verify
  db/
    models.py          SQLAlchemy schema (the full ERD lives here)
    migrate.py         Additive ALTER TABLE pass for existing databases
    session.py         Async engine, session factory, SQLite PRAGMAs
  schemas.py           Pydantic request/response models
  api/
    deps.py            Session + current-user dependencies
    routes/
      auth.py          Onboarding, login, profile
      contacts.py      Address book and user directory
      conversations.py Inbox, direct threads, group admin
      messages.py      History, send, receipts, reactions, delete
      uploads.py       Attachment upload, type/size validation
      ws.py            WebSocket endpoint
  realtime/
    hub.py             Per-user socket registry and fan-out
  services/
    conversations.py   Conversation queries/mutations
    messages.py        Message pipeline and receipt state machine
    serializers.py     ORM -> API shapes
    loaders.py         Shared eager-loading options
  seed.py              Demo dataset
```

## Database schema

```
users ──┬── contacts (owner_id / contact_user_id — self-referential M2M)
        │
        ├── conversation_members ──── conversations
        │                                   │
        └── messages ───────────────────────┘
               ├── message_receipts   (per-recipient delivered/read)
               └── message_reactions  (per-user emoji)
```

**`users`** — `id`, `phone` (unique), `username` (unique, nullable),
`display_name`, `about`, `avatar_color`, `avatar_url`, `is_online`,
`last_seen_at`, `created_at`.

**`contacts`** — `id`, `owner_id` → users, `contact_user_id` → users,
`nickname`, `created_at`. Unique on `(owner_id, contact_user_id)`.

**`conversations`** — `id`, `type` (`direct` | `group`), `name`, `description`,
`avatar_color`, `created_by_id`, `disappearing_seconds`, `last_message_at`,
`created_at`. Direct threads and groups share one table so the inbox query, the
message pipeline and the websocket fan-out have a single code path;
`last_message_at` is denormalised so the inbox sorts without touching `messages`.

**`conversation_members`** — `id`, `conversation_id`, `user_id`, `role`
(`admin` | `member`), `last_read_at`, `is_muted`, `is_pinned`, `joined_at`.
Unique on `(conversation_id, user_id)`. `last_read_at` is what the unread badge
counts against.

**`messages`** — `id`, `conversation_id`, `sender_id` (NULL for system
messages), `kind` (`text` | `image` | `file` | `system`), `body`, `status`,
`reply_to_id` (self-FK, for quoted replies), `attachment_url` / `_name` /
`_mime` / `_size`, `expires_at` (disappearing messages), `deleted_at` (soft
delete so the tombstone stays in the thread), `created_at`. Indexed on
`(conversation_id, created_at)`. A caption is just `body` alongside an
attachment, so no extra table is needed.

Messages also carry `edited_at` (set on edit, rendered as a quiet "edited"
marker) and `is_forwarded` (a label; forwarded copies are independent rows, so
deleting the original never blanks the copy).

**`message_receipts`** — `id`, `message_id`, `user_id`, `delivered_at`,
`read_at`. Unique on `(message_id, user_id)`. This is the per-recipient truth;
`messages.status` is the aggregate the sender's check marks render.

**`message_reactions`** — `id`, `message_id`, `user_id`, `emoji`, `created_at`.
Unique on `(message_id, user_id, emoji)`.

### Message status machine

```
sending  (client-side only, optimistic bubble)
   -> sent       persisted, no recipient socket connected
   -> delivered  at least one recipient's socket acknowledged it
   -> read       every recipient has opened the conversation
```

## API overview

All routes are under `/api`. Everything except `/auth/start`, `/auth/register`
and `/auth/login` requires `Authorization: Bearer <token>`.

### Auth

| Method | Path             | Purpose                                     |
| ------ | ---------------- | ------------------------------------------- |
| POST   | `/auth/start`    | "Send" a verification code; says if registered |
| POST   | `/auth/register` | Verify the code and create the profile      |
| POST   | `/auth/login`    | Verify the code for an existing account     |
| GET    | `/auth/me`       | Restore the session from a stored token     |
| PATCH  | `/auth/me`       | Update display name, about, avatar, username|
| POST   | `/auth/logout`   | Record last-seen (tokens are stateless)     |

### Contacts

| Method | Path                    | Purpose                              |
| ------ | ----------------------- | ------------------------------------ |
| GET    | `/contacts`             | The caller's address book            |
| POST   | `/contacts`             | Add by phone or username             |
| DELETE | `/contacts/{id}`        | Remove a contact                     |
| GET    | `/contacts/directory`   | Search all users (for the pickers)   |

### Conversations

| Method | Path                                          | Purpose                     |
| ------ | --------------------------------------------- | --------------------------- |
| GET    | `/conversations`                              | Inbox, pinned then recent   |
| GET    | `/conversations/search?q=`                    | Chats, people and message bodies |
| GET    | `/conversations/{id}`                         | One conversation            |
| POST   | `/conversations/direct`                       | Open (or reuse) a 1:1 thread|
| POST   | `/conversations/groups`                       | Create a group              |
| PATCH  | `/conversations/{id}`                         | Rename / describe / timer (admin) |
| PATCH  | `/conversations/{id}/settings`                | Mute and pin (per member)   |
| GET    | `/conversations/{id}/members`                 | List members                |
| POST   | `/conversations/{id}/members`                 | Add members (admin)         |
| DELETE | `/conversations/{id}/members/{userId}`        | Remove, or leave yourself   |
| POST   | `/conversations/{id}/members/{userId}/promote`| Grant admin                 |

### Messages

| Method | Path                                                | Purpose             |
| ------ | --------------------------------------------------- | ------------------- |
| GET    | `/conversations/{id}/messages?limit=&before_id=`    | Paged history       |
| POST   | `/conversations/{id}/messages`                      | Send                |
| POST   | `/conversations/{id}/messages/read`                 | Mark the thread read|
| POST   | `/conversations/{id}/messages/{mid}/reactions`      | Toggle a reaction   |
| PATCH  | `/conversations/{id}/messages/{mid}`                | Edit your own text  |
| POST   | `/conversations/{id}/messages/{mid}/forward`        | Copy into other chats |
| DELETE | `/conversations/{id}/messages/{mid}`                | Delete for everyone |

### Attachments

| Method | Path             | Purpose                                      |
| ------ | ---------------- | -------------------------------------------- |
| POST   | `/uploads`       | Store one file (multipart `file` field)      |
| GET    | `/uploads/{name}`| Serve a stored file (static, outside `/api`) |

`POST /api/uploads` returns the metadata to hand straight to the send endpoint:

```json
{ "url": "/uploads/9f3c….png", "name": "photo.png",
  "mime": "image/png", "size": 20480, "kind": "image" }
```

The client uploads first and sends the message second, so a message row never
points at a file that failed to store. Uploads are authenticated, capped at
`MAX_UPLOAD_MB` (15 MB by default, rejected with `413`), and restricted to an
allow-list of image, **audio** and document types (`415` otherwise). Stored
filenames are random UUIDs with a vetted extension, so a hostile filename
cannot escape the upload directory.

Voice messages reuse this endpoint unchanged — the browser records to
webm/opus (or mp4/aac on Safari), uploads it like any other file, and the
response comes back with `kind: "audio"`. The recorded length travels with the
*message* rather than the upload, as `attachment_duration_ms`, because only the
client can measure it reliably.

### WebSocket — `/api/ws?token=<jwt>`

Client → server:

```jsonc
{"type": "ping"}
{"type": "typing",       "payload": {"conversation_id": 1, "is_typing": true}}
{"type": "delivered",    "payload": {"message_ids": [12, 13]}}
{"type": "read",         "payload": {"conversation_id": 1}}
{"type": "message:send", "payload": {"conversation_id": 1, "body": "hi", "client_id": "…"}}
```

Server → client:

```jsonc
{"type": "ready",                "payload": {"user_id": 1, "online_user_ids": [2, 5]}}
{"type": "message:new",          "payload": { /* Message */ }}
{"type": "message:updated",      "payload": { /* Message */ }}
{"type": "message:status",       "payload": {"id": 9, "status": "read", "read_by": [2]}}
{"type": "typing",               "payload": {"conversation_id": 1, "user_id": 2, "is_typing": true}}
{"type": "presence",             "payload": { /* User */ }}
{"type": "conversation:new"}  {"type": "conversation:update"}  {"type": "conversation:removed"}
```

Fan-out is always *by user id*: routes resolve a conversation to its member ids
and hand them to the hub, which keeps the hub free of database knowledge and
makes it straightforward to swap for Redis pub/sub across multiple workers.

## Deploying to Render

1. Push this repository to GitHub.
2. In Render, **New → Web Service**, point it at the repo and set
   **Root Directory** to `backend` (or use the included `render.yaml` blueprint).
3. Build command: `pip install -r requirements.txt`
   Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Environment variables: set `JWT_SECRET`, and set `CORS_ORIGINS` to your
   Vercel URL once the frontend is deployed.
5. Health check path: `/health`.

**On SQLite and upload persistence:** Render's free instances have no persistent
disk, so both the database and the `uploads/` directory live in the container
filesystem and reset on each deploy — the demo data is reseeded automatically,
so the app is always usable, but attachments sent before a redeploy will 404
afterwards. For durable storage, attach a Render disk and set
`DATABASE_URL=sqlite+aiosqlite:////var/data/signal.db` plus
`UPLOAD_DIR=/var/data/uploads`. A production system would put attachments in
object storage (S3, Cloudinary) instead — only `_persist` in `uploads.py` and
the returned URL would change.

Render's free tier also idles after inactivity; the first request after a cold
start takes a few seconds, and the frontend's websocket reconnects on its own.

## Schema changes on an existing database

`Base.metadata.create_all` creates missing tables but never alters existing
ones, so a database file created before a column was added would fail every
query selecting it. On startup the app runs `db/migrate.py`, which compares
each mapped table against `PRAGMA table_info` and issues
`ALTER TABLE ... ADD COLUMN` for anything missing.

It is **additive only** — nothing there drops or retypes a column, so it cannot
destroy data. Renames and type changes still mean recreating the file (delete
`signal.db` and restart to reseed). A production system would use Alembic.

## Assumptions

- **Verification is mocked.** Any phone number works and the code is always
  `123456`; no SMS is sent and there are no passwords.
- **Encryption is simulated.** Message bodies are stored in plain text. The
  assignment explicitly allows this; the UI says so in Settings.
- **Presence is real, not mocked.** Online status comes from live websocket
  connections; `last_seen_at` is persisted when the last socket closes.
- **One reaction per person per message**, matching Signal — reacting with a new
  emoji replaces the previous one.
- **Deletes are "for everyone"** and soft, so the tombstone remains in the thread.
- **The websocket hub is in-process**, which assumes a single worker. Scaling out
  would need a shared pub/sub backend.
- **Attachments are stored on local disk and served unauthenticated** from
  `/uploads/<random-uuid>`. The filename is unguessable, but anyone holding the
  URL can fetch it — there is no per-conversation access check on the static
  route. Real object storage with signed, expiring URLs would be the fix.
