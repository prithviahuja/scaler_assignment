# Signal Clone — Frontend (Next.js)

The Signal Desktop interface: nav rail, conversation list, chat pane, and a
details drawer, with real-time messaging over a websocket.

## Stack

| Concern          | Choice                          |
| ---------------- | ------------------------------- |
| Framework        | Next.js 15 (App Router)         |
| Language         | TypeScript (strict)             |
| Styling          | Tailwind CSS 3 + CSS variables  |
| State            | Zustand                         |
| Icons            | lucide-react                    |
| Dates            | date-fns                        |

## Running locally

The backend must be running first (see `../backend/README.md`).

```bash
cd frontend
npm install
cp .env.local.example .env.local   # point NEXT_PUBLIC_API_URL at the backend
npm run dev
```

Open <http://localhost:3000>. Sign in with any demo account — the onboarding
screen lists four of them and the verification code is always `123456`.

To see real-time messaging, open the app in two different browsers (or one
normal and one private window) and sign in as two different people.

### Environment

| Variable              | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | Base URL of the FastAPI backend, no trailing slash. The websocket URL is derived from it. |

## Project layout

```
src/
  app/
    layout.tsx           Root layout, fonts, toaster
    page.tsx             Auth gate: splash -> onboarding -> app shell
    globals.css          Theme tokens for light and dark
  components/
    AppShell.tsx         Three-column layout, keyboard shortcuts
    NavRail.tsx          Chats / Calls / Stories / Settings rail
    ConversationList.tsx Search, All/Unread filter, chat rows
    ChatPane.tsx         Header, message list, date dividers, typing bubble
    MessageBubble.tsx    Bubbles, tails, ticks, quotes, reactions, menu
    VoiceNote.tsx        Voice-message player: waveform, seek, timer
    ForwardModal.tsx     Pick chats to forward a message into
    Composer.tsx         Auto-growing input, emoji picker, reply + attachment preview
    ConversationInfoPanel.tsx  Contact info and group admin controls
    SettingsPane.tsx     Profile, appearance, placeholder sections
    ComposeModal.tsx     New chat / new group / add contact
    Onboarding.tsx       Phone -> code -> profile registration
    ui/                  Avatar, Modal, Button, TextField, Toaster, ComingSoon
  lib/
    api.ts               Typed fetch wrapper around the REST API
    socket.ts            Websocket client: heartbeat + backoff reconnect
    types.ts             Mirrors the backend Pydantic schemas
    format.ts            Signal's timestamp and presence labels
    recorder.ts          MediaRecorder wrapper for voice messages
    avatar.ts            Signal's avatar tile palette
  store/
    useAppStore.ts       Single Zustand store: auth, data, realtime, UI
```

## How the realtime pieces fit

- **Optimistic sends.** A bubble appears immediately with a temporary negative
  id and a `client_id`, showing the clock icon. The REST response (or the
  websocket echo, whichever lands first) replaces it by matching `client_id`.
  A failure flips it to a retryable "Not delivered" state.
- **Receipts.** Opening a focused thread sends a `read` frame; the backend turns
  that into `message:status` events, which is what flips the sender's single
  check to a double check.
- **Typing.** Keystrokes are throttled to one "started" frame every two seconds
  with a trailing "stopped". Indicators also expire client-side after four
  seconds so a dropped frame cannot leave one stuck on.
- **Presence.** The socket is authoritative. `ready` seeds the online set and
  `presence` events keep it current.
- **Attachments.** The file uploads as soon as it is picked and is staged in the
  composer with a thumbnail; sending then only posts the metadata. Because the
  file is already hosted by that point, the optimistic bubble can render the
  real image straight away rather than juggling a temporary blob URL.
- **Voice messages** take the same path: record, upload, then send. The
  microphone track is released on send, cancel *and* unmount, so the browser's
  recording indicator never stays lit.
- **The unread divider** freezes `my_last_read_at` when a thread is opened,
  before it is marked read, so the line does not slide away as you read.
- **History paging** holds a per-conversation in-flight lock and de-duplicates
  by id — a short thread sits at `scrollTop: 0`, which would otherwise fire the
  loader repeatedly and prepend the same page twice.

## Keyboard shortcuts

| Shortcut           | Action              |
| ------------------ | ------------------- |
| `Ctrl/Cmd + N`     | New chat            |
| `Ctrl/Cmd + ,`     | Settings            |
| `Ctrl/Cmd + Shift + D` | Toggle dark mode |
| `Enter`            | Send                |
| `Shift + Enter`    | New line            |
| `Escape`           | Close modal / drawer|

## Deploying to Vercel

1. Push this repository to GitHub.
2. In Vercel, **Add New → Project**, import the repo and set
   **Root Directory** to `frontend`. The framework preset is detected
   automatically.
3. Add the environment variable `NEXT_PUBLIC_API_URL` with your Render backend
   URL, e.g. `https://signal-clone-api.onrender.com` (no trailing slash).
4. Deploy, then set `CORS_ORIGINS` on the backend to the resulting Vercel URL
   and redeploy the backend.

`NEXT_PUBLIC_*` variables are inlined at build time, so changing the API URL
needs a redeploy, not just a restart.
