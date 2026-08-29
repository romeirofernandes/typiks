# Implementation Plan: Live Room Links

Reference: `docs/adr/0004-live-links.md` (accepted). Scope locked in the grilling
session. This plan covers the code changes only — ADR-0004 records the decisions.

## Overview

Two new surfaces, everything else reuses existing machinery:

1. **Backend**: public room-status endpoint `GET /api/rooms/:code/status`.
2. **Frontend**: public `/join/:code` route + choice screen + "Copy invite link"
   button in the room lobby.

Flow summary:
- `/join/:code` → status check (everyone) → authenticated: auto-join via
  CreateRoom; unauthenticated: choice screen → "Join as guest" (guest sign-in +
  provision) or "Sign in" (redirect + return).

## Backend changes

### 1. Status endpoint — `backend/src/routes/rooms.js`

Add `GET /:code/status`, **no auth** (public — a link visitor has no token yet).

- Sanitize `:code` (reuse `sanitizeRoomCode` semantics: uppercase, strip
  `[^A-Z0-9]`, must be exactly 6). 400 on bad code.
- `const roomId = c.env.PRIVATE_ROOM.idFromName(\`room-${roomCode}\`)`, get stub.
- `stub.fetch('https://private-room.internal/status')` → the DO answers from its
  own state (no new storage).

Response shape:
```json
{
  "code": "K8M2J9",
  "exists": true,           // ownerId set (room configured)
  "live": true,             // exists && members.size > 0
  "full": false,            // exists && members.size >= settings.maxPlayers
  "inProgress": false,      // exists && game state is not lobby
  "memberCount": 3,
  "maxPlayers": 8
}
```
`exists: false` → room never configured or last member left (dead link).

### 2. DO status handler — `backend/src/durable-objects/PrivateRoom.js`

In `fetch()` (lines 1554-1575), before the websocket-upgrade branch, add:

```js
if (request.method === 'GET' && url.pathname.endsWith('/status')) {
  return this.roomStatus(request);
}
```

New `roomStatus()` method:
- `await this.hydrate()`.
- `exists = Boolean(this.ownerId)`.
- `live = exists && this.members.size > 0`.
- `full = exists && this.members.size >= (this.settings?.maxPlayers ?? 8)`.
- `inProgress = exists && game-state != lobby` (same check `handleJoin` uses to
  reject joins, lines 1249-1259).
- `memberCount = this.members.size`, `maxPlayers = this.settings?.maxPlayers ?? 8`.
- Return JSON with `Content-Type: application/json`.

Note: `fetch()` currently returns 400 for any non-websocket request, so a GET
falls through to that — the new branch must come first. This endpoint must stay
unauthenticated; do **not** attach `requireFirebaseAuth`.

## Frontend changes

### 3. Env var — `VITE_APP_URL`

- Add to `frontend/.env.example` (and `.env` locally): `VITE_APP_URL`.
- Read via `import.meta.env.VITE_APP_URL` with fallback to `window.location.origin`.

### 4. Link builder — `frontend/src/lib/api-client.js` or new `frontend/src/lib/links.js`

```js
export function getRoomLink(roomCode) {
  const base = import.meta.env.VITE_APP_URL || window.location.origin;
  return `${base.replace(/\/$/, "")}/join/${roomCode}`;
}
```

### 5. Public route — `frontend/src/App.jsx`

- `const JoinLink = lazy(() => import("./pages/JoinLink"));`
- Add `<Route path="/join/:code" element={<JoinLink />} />` **outside**
  `ProtectedRoute` (alongside `/signin`), lines 36-39.

### 6. Status fetch — `frontend/src/lib/api-client.js`

Reuse `apiFetch` but it adds `Authorization` from a user; the status endpoint is
public. Either add a `{ auth: false }` option to `apiFetch` or use `fetch`
directly against the same base. Prefer a small `publicFetch` helper so the
endpoint stays anonymous.

### 7. JoinLink page — `frontend/src/pages/JoinLink.jsx` (new)

Renders the choice screen. Uses `useParams` for `:code`, `useAuth` for
`currentUser`.

Behavior (single status check, both branches — Q12):
- On mount: `publicFetch(\`/api/rooms/${code}/status\`)`.
  - `exists: false` or `full` → "room not available" screen (dead / full), with
    a link back to `/`. No guest sign-in happens.
  - `inProgress: true` → still allow join (existing room join handles
    mid-round state per Q4/Q10); do not special-case.
- **Authenticated**: on status `live/exists` → `navigate("/create-room", { state:
  { joinRoomCode: code, fromInvite: true } })` (the existing auto-join effect,
  CreateRoom.jsx:1039-1049). Dead → error screen.
- **Unauthenticated, room available**: render choice screen:
  - "Join as guest" → replicate `GuestSignInButton.handleGuestLogin`
    (`signInAnonymously` → `provisionUser.mutateAsync`) **after** a confirmed
    live status, then navigate to `/create-room` with `joinRoomCode` state.
  - "Sign in" → `navigate("/signin", { state: { from: \`/join/${code}\` } })`.
- Layout: standalone page (no AppShell — it's pre-auth). Reuse the
  `BackgroundGrid` + centered-card aesthetic from `SignIn.jsx`.

### 8. Sign-in returns to the link — `frontend/src/components/login-form.jsx`

After successful sign-in (both email and Google paths, lines 35, 58), navigate
to `location.state?.from || "/dashboard"` instead of hard-coded `/dashboard`.
Same for `signup-form.jsx` if "Sign in" ever routes there (keep it to
login-form now). Guests via GuestSignInButton also respect `state.from` when the
room is live — but the JoinLink page handles guest sign-in itself (step 7), so
`GuestSignInButton` only needs the `from` support if we reuse it there.

### 9. Copy invite link — `frontend/src/pages/game/CreateRoom.jsx`

`RoomCodeCard` (lines 1436-1508):
- Add `getRoomLink(roomCode)` to the copy logic — a second button "Copy invite
  link" beside the existing code-copy button (Q6-B), reusing the same
  `FiCopy`/`FiCheck` + "Copied!" pattern with its own `copied` state
  (`copyRoomLink` handler, `navigator.clipboard.writeText(getRoomLink(roomCode))`).
- Keep "Copy code" untouched for in-app friends.

## Verification

- `npm run build` + `npm run lint` in `frontend/`; `npm run lint` in `backend/`.
- Manual:
  1. Create a room → copy invite link → open in private window (no auth) →
     choice screen shows → "Join as guest" lands in the room lobby.
  2. Logged-in window opens same link → straight to lobby (no choice screen).
  3. Let the room empty (leave) → open stale link → "room not available", and
     no guest account was created (check: no new anonymous provision request in
     network tab).
  4. `GET /api/rooms/<badcode>/status` → 400; `GET /api/rooms/K8M2J9/status` →
     correct shape while room alive, `exists:false` after it dies.

## Non-goals (locked in grilling)

- No preview page (host name, player list) — status check only.
- No host approval queue.
- No TTL / room revival — link lives = room lives.
- No guest-upgrade prompt after unranked link-joins.
- Ranked play stays in matchmaking; links are unranked-only by construction.
