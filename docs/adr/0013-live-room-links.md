# ADR-0013: Live Room Links for Unranked Rooms (`/join/<code>`)

Status: Accepted
Date: 2026-08-18
Author: Romeiro Fernandes

## Context & Problem Statement

Rooms are shared by copying a raw 6-character code (`ROOM_CODE_LENGTH`, `backend/src/routes/rooms.js:10`) that friends paste into the in-app join box. Sharing outside the app means transcribing a code. The landing promises "share one link," and link-sharing is the natural way to invite people who aren't in the app yet (`6f5e16b Room links done + schema refactoring`).

Every WebSocket join requires a verified Firebase ID token (`backend/src/durable-objects/WSCoordinator.js:36-45`), and `ProtectedRoute` bounces unauthenticated visitors to `/signin`. There is no token-less path into a room and no identity separate from a Firebase account.

## Decision

Add shareable room links `<app-origin>/join/<roomCode>` for **unranked rooms only** (`6f5e16b`). The code is the Durable Object name (`room-${code}`), so the link maps 1:1 to a room with no separate lookup.

- **Authenticated visitors** are routed straight into the existing auto-join flow (`frontend/src/pages/game/CreateRoom.jsx` already auto-joins from `location.state.joinRoomCode`).
- **Unauthenticated visitors** see a choice screen: "Join as guest" or "Sign in". Joining as guest reuses the Anonymous Auth + auto-provision pipeline (ADR-0006) — a guest is a full account with synthetic `guest-<uid>@guest.typiks` email and generated username. Sign-in redirects and returns to the link.
- A minimal **room status pre-check** (`GET /api/rooms/:code/status`, unauthenticated, reading `PrivateRoom` state) runs before joining for everyone — live/full/in-progress. For guests it prevents a dead link from silently creating an account; for signed-in users it gives "room not available" instead of a post-connect error. This is a guard, not a preview page.
- **No preview page, no host approval, no TTL.** A link is valid while its room is alive and dies when the last member leaves (existing lifecycle). Dead links degrade via the status check.
- **Unranked only** — ranked play stays in the `MatchmakingRoom` queue; link-joined guests play unranked and rating is untouched. No upgrade prompt after unranked link-join (ranked-only `GuestUpgradePrompt` remains).
- Lobby gains **"Copy invite link"** alongside "Copy code"; base is `VITE_APP_URL` env var falling back to `window.location.origin`.
- Public `/join/:code` lives **outside** `ProtectedRoute` (reachable before auth), feeding the same auto-join path once the visitor has an identity.

## Alternatives Considered & Trade-offs

- **Opaque share token** instead of room code in URL: Rejected — code already names the room; a token adds a lookup layer and hides nothing meaningful since the code is low-entropy by design.
- **Preview page with host/player info**: Rejected — needs richer status surface than a guard and adds friction; folded into minimal pre-check.
- **Host must approve link-joiners**: Rejected — turns a share link into an invite-request system; friend invites already cover vetting.
- **Link TTL / room revival after empty**: Rejected — contradicts the ephemeral room/session model; status check handles dead-link UX. Can be layered later.

## Consequences

*Positive:*
- Two new backend surfaces only (status endpoint + public `/join/:code` route); no changes to room identity, WS protocol, or lifecycle.
- Links are shareable externally (Discord, etc.) without the invitee being in the app — acquisition surface expands.

*Negative:*
- Guest arriving via link is a full account per ADR-0006 — a stray `users` row may be created if they tap "Join as guest" then bail. Accepted; matches existing guest behavior.
- `VITE_APP_URL` must be set in deployed envs or copied links carry wrong origin.
- Anyone with the link can join (unranked) — accepted; vetted invites remain via `roomInvites`.

## Related Decisions

- DEPENDS ON [ADR-0006] — unauthenticated link-join reuses the synthetic-email auto-provision.
- REFINES [ADR-0004] — reuses `PRIVATE_ROOM` sharding (`room-${code}`) without new DO classes.
- Complements ADR-0005/ADR-0010 — room links are unranked, so they never write to `matches`/`matchParticipants` or `rankedGameLogs`.
