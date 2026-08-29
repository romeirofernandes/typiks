# ADR-0006: Guest Identity via Firebase Anonymous Auth

Status: Accepted
Date: 2026-08-08
Author: Romeiro Fernandes

## Context & Problem Statement

The "Try now" button (`frontend/src/components/auth/TestCredentialsDock.jsx`) signs every visitor into a **single shared Firebase account** (`test@mail.com` / `123456`). Because all backend state — Durable Object rooms, queue entries, D1 `users`/`stats`/`gameLogs` — is keyed by Firebase UID (`users.id` in `backend/src/db/schema.js`), two strangers using the button are literally the same user:

- Both land in the same `MatchmakingRoom` queue slot under one UID.
- The second WebSocket is treated as a session replacement for the first, so the earlier player is kicked mid-game with "replaced by newer session" (`frontend/src/pages/game/Game.jsx:330`).
- Game results and ratings collide and double-write under one identity.

Session-handling tweaks cannot fix sharing one identity; the root cause is identity collapse.

## Decision

Adopt **Firebase Anonymous Auth (`signInAnonymously`)** as the guest identity mechanism, replacing the fixed test account (`f84beb0 Guest accounts done`).

- Each browser that chooses "Play as Guest" gets its own persistent UID, stored in Firebase `localStorage` persistence. Two visitors never collide.
- Anonymous users ride the existing token pipeline end-to-end: `getIdToken()` → `verifyFirebaseIdToken()` (`backend/src/middleware/firebaseAuth.js`) → `auth.uid`. No new token format, no new verification path.
- Backend auto-provisions guest profiles: when a verified token carries no email (anonymous), `POST /api/users` creates a profile with a synthetic email (`guest-<uid>@guest.typiks`) so `users.email NOT NULL UNIQUE` is untouched — no migration.
- Guests get a fun generated username (adjective+animal+suffix, e.g. `SwiftFox82`) since they appear on the leaderboard and globe.
- Guests are fully ranked — they may queue ranked, accrue rating, and appear on leaderboards. Product decision; ranked integrity concerns accepted for the guest tier.
- Guests may convert to a permanent account by linking credentials (anonymous → email/password or Google). Firebase keeps the same UID during linking, so all stats, rating, friends carry over. Frontend forces `getIdToken(true)` after `linkWithCredential`.

## Alternatives Considered & Trade-offs

- **Custom guest tokens**: backend-minted identity separate from Firebase. Rejected: duplicates auth (token format, verification, expiry, parallel identity table) for zero benefit when Firebase already supplies persistent anonymous UIDs.
- **Nullable email + `is_guest` flag**: Rejected as unnecessary schema migration; synthetic email satisfies uniqueness without touching D1.
- **Guests casual/bot only**: Rejected by product — guests should be fully ranked to lower friction.
- **Frontend-fabricated email**: Rejected — leaks identity shaping to client and is spoofable; provisioning belongs server-side.
- **Keep shared test account with session multiplexing**: Rejected — `WSCoordinator` session replacement semantics are correct for one user with two tabs, not for two users sharing one UID; fixing it would mask the bug.

## Consequences

*Positive:*
- Removes the shared-account collision class. The "session replaced" path now only triggers for genuine double-connects (same browser, two tabs), which is correct.
- No D1 migration; `users` keeps `email NOT NULL UNIQUE` via synthetic emails.
- Upgrade path preserves identity; the synthetic email is replaced by the real email on link/convert.

*Negative:*
- Orphaned guest rows accumulate if a visitor taps "Play as Guest" then abandons — no cleanup job yet (accepted).
- Firebase console must have **Anonymous** provider enabled; synthetic emails (`@guest.typiks`) must never be treated as real email targets.
- Generic "save your progress" prompt (localStorage-flagged, once after first finished game) adds a small UX surface.

## Related Decisions

- DEPENDS ON [ADR-0003] — reuses the `jose` JWKS verification path; anonymous tokens carry `email: null` which this ADR branches on.
- SUPERSEDES the shared `test@mail.com`/`123456` guest model and `TestCredentialsDock.jsx`.
- Enables ADR-0012 (live room links reuse the same anonymous auto-provision for unauthenticated visitors).
