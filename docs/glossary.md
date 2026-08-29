# Glossary

Terms used across the codebase and docs. Maintained alongside ADRs.

## Identity & Auth

- **Firebase UID**: The unique identifier Firebase assigns to an auth
  account. Every backend record that belongs to a player (`users.id`,
  `userModeStats.userId`, `rankedGameLogs.userId`, Durable Object room
  members) keys off this string.
- **Anonymous Auth**: Firebase sign-in method (`signInAnonymously`) that
  gives a browser a persistent UID without credentials. The UID is stored in
  localStorage and survives reloads until the browser signs out or clears
  storage. This is the guest identity mechanism.
- **Synthetic email**: A fabricated, unique email
  (`guest-<uid>@guest.typiks`) stored in `users.email` for anonymous users,
  because the `users` table requires `email NOT NULL UNIQUE`. Replaced by the
  real email if the guest converts to a permanent account.
- **Account upgrade / linking**: Converting an anonymous Firebase account
  into a permanent one (email/password or Google) via Firebase credential
  linking. Firebase preserves the same UID, so all user data carries over.
- **ID token**: A short-lived JWT minted by `currentUser.getIdToken()` and
  verified server-side by `verifyFirebaseIdToken()` in
  `backend/src/middleware/firebaseAuth.js`.
- **Password reset email**: The email Firebase sends via
  `sendPasswordResetEmail` when a user forgets their password. It carries a
  one-time OOB code baked into a link; the user sets a new password on
  Firebase's hosted page, then the `continueUrl` returns them to `/signin`.
  Firebase-branded, not Typiks-themed (ADR-0002).
- **OOB code**: One-time out-of-band code Firebase embeds in reset (and
  verify-email) links. Consumed server-side by Firebase; the app never reads or
  stores it.
- **continueUrl**: The `actionCodeSettings.url` passed to
  `sendPasswordResetEmail` — where the user lands after completing the reset on
  Firebase's hosted page. Set to `${window.location.origin}/signin`
  (`frontend/src/pages/ForgotPassword.jsx`).
- **Anti-enumeration (password reset)**: The `/forgot-password` page always
  shows "If an account exists for that email, a reset link is on its way" rather
  than revealing whether an email is registered. Guest synthetic emails fail
  `user-not-found`, which the generic message swallows.

## Matching & Sessions

- **MatchmakingRoom**: Durable Object holding the ranked queue.
- **GameRoom**: Durable Object for one active match, responsible for the
  game lifecycle (`waiting_for_players` → `countdown` → `playing` →
  `finished`/`aborted`), persistence, and alarms.
- **Session replacement**: When a second websocket authenticates as the same
  player identity, the first connection is closed with
  "replaced by newer session". Correct for a repeated identity (two tabs);
  previously triggered wrongly when two visitors shared the fixed test
  account.
- **Session ID**: A per-connection identifier (`playerToSession` /
  `sessionOrder`) used to distinguish websocket connections so only the
  newest connection for an identity stays active.

## Gameplay & Data

- **Ranked queue**: The matchmaking flow that pairs players by mode and
  rating; only reachable by authenticated users (including guests).
- **Leaderboard / globe**: Public surfaces showing top players by rating.
  Guests appear here under generated usernames by product decision.
- **userModeStats**: Per-user, per-mode (e.g. 15s/60s) stats row holding
  rating, games played/won/lost/drawn, total score.
- **rankedGameLogs**: One row per player per ranked game: score, opponent,
  rating before/after.
- **Guard**: `backend/src/routes/users.js` `POST /` provisions a player
  profile; previously required an email claim, now also auto-provisions
  anonymous guests with a synthetic email and generated username.

## Rooms & Links

- **Room link**: The shareable URL that identifies a room by its code
  (`typiks.app/join/<roomCode>`). The room code is the Durable Object name,
  so the link maps 1:1 to the room with no separate identity layer.
- **Join link / invite link**: The link a host copies to let anyone enter a
  room without typing the code. Always points to an **unranked** room —
  ranked play happens only through the matchmaking queue, never a shared
  room.
- **Guest join**: An unauthenticated visitor entering a room via a join
  link. They are signed in with Anonymous Auth (a full account with a
  synthetic email and generated username) before joining — identical to the
  in-app "Play as guest" path. Playing an unranked room does not touch their
  rating.
- **Room status check**: The minimal pre-join probe
  (`GET /api/rooms/:code/status`) that reports whether a room is live, full,
  or in-progress before a visitor signs in — so a dead link never silently
  creates an account. Not a preview page.
- **Link lifetime**: A link is valid while its room is alive (at least one
  member connected) and dies when the last member leaves. No TTL; dead links
  degrade gracefully through the room status check.
