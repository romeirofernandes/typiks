# ADR-0003: Firebase ID-Token Verification via `jose` JWKS

Status: Accepted
Date: 2025-06-23
Author: Romeiro Fernandes

## Context & Problem Statement

`5b3d101 backend verification of firebase uid` hardened every user-specific surface: REST routes must not trust a client-supplied `uid`, and WebSockets must not trust a `playerId` spoof. The shared-account bug that later motivated Guest Login (ADR-0006) was already visible — if a token's `sub` is not verified, two strangers can claim one UID and collide in `GameRoom`.

You chose **Firebase Auth** because you had worked with it before and wanted **Google sign-in without building OAuth in GCP** — that flow is tedious. A plain email/password-only login felt lame, slower, and higher-friction; "Sign in with Google" lowers friction for a typing game where you want players in quickly. Firebase gives you Google auth out of the box with `firebase@^11.9.1` in the Vite SPA (`AuthContext.jsx` persisting session in `localStorage`). The backend is a Worker (`backend/src/middleware/firebaseAuth.js`), not a Node process, so verification must run in `workerd`.

## Decision

Verify **Firebase ID tokens** on every authenticated request via **`jose`** (`jose@^6.2.2`, `createRemoteJWKSet` + `jwtVerify` in `backend/src/middleware/firebaseAuth.js`) and expose a Hono middleware `requireFirebaseAuth()`.

- JWKS is fetched from `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com` via `createRemoteJWKSet`; `jose` caches keys internally with automatic rotation — no manual `node-cache`/`KV` needed.
- Verification asserts `issuer: https://securetoken.google.com/${projectId}` and `audience: projectId` where `projectId` is `c.env.FIREBASE_PROJECT_ID` (`"typiks"` in `wrangler.jsonc: vars`), reading from `wrangler` secrets in prod. No service-account private key is stored.
- On success, `c.set('auth', { uid: payload.sub, email, emailVerified, name, picture })` — all downstream routes/Durable Object upgrades read `auth.uid` instead of a body/WS field.
- REST routes use `requireFirebaseAuth()` (`backend/src/routes/users/*.js`); WS upgrades use the same `verifyFirebaseIdToken` inline in `WSCoordinator.js:36-45` before accepting `JOIN_QUEUE`/`JOIN_GAME`.
- Anonymous (guest) tokens have `email === null` and are auto-provisioned in `POST /api/users` (synthetic `guest-<uid>@guest.typiks`), so the same verification path serves both tiers.

## Alternatives Considered & Trade-offs

- **Firebase Admin SDK (`firebase-admin`)**: `admin.auth().verifyIdToken()` is the canonical verifier. Rejected: it requires a service-account private key as a `wrangler` secret (operational burden, key rotation, GCP IAM), pulls in a large Node dependency tree that is not `workerd`-vetted, and is redundant when only verification (not minting or user management) is needed.
- **Session cookies / Lucia / custom JWT**: Would decouple the backend from Firebase token lifetime, but introduces a session store (D1 table or Durable Object), CSRF concerns, and a second token lifecycle to maintain alongside Firebase's. Rejected: Firebase already manages client-side session persistence (`AuthContext.jsx` + `getIdToken()`), and the backend only needs to *verify*, not *store*, sessions.
- **Unverified `Authorization: Bearer <uid>` or body-supplied `playerId`**: Zero verification cost, but allows immediate account takeover, stat tampering, and leaderboard poisoning — exactly the class of bug the `spec.md §1.2` "trusting UID from the client" warns about. Rejected.
- **Manual `jsonwebtoken` + `jwks-rsa`**: Works, but `jose` is the modern, Web-Crypto-native JOSE implementation that runs unmodified in `workerd` with `nodejs_compat`; `jsonwebtoken` depends on Node's `crypto` polyfills and is heavier.

Trade-off accepted: cold start of the first JWKS fetch adds ~20–40 ms if the cache is empty, and `FIREBASE_PROJECT_ID` must be kept in sync between Firebase console and `wrangler.jsonc`. In return, there are no long-lived secrets and no session table to GC.

## Consequences

*Positive:*
- Every user-specific D1 read/write is keyed by a verified `sub` — the root cause for the shared-account collision (later fixed by ADR-0006) and for spoofed `playerId` in `GameRoom`/`MatchmakingRoom` WS messages is eliminated.
- Zero secret rotation beyond `FIREBASE_PROJECT_ID`; JWKS rotates server-side at Google and `jose` follows.
- Guest and permanent accounts share one pipeline (`getIdToken()` → `verifyFirebaseIdToken` → `auth.uid`), so `POST /api/users` auto-provision logic stays simple.

*Negative:*
- Token verification is per-request; there is no server-side session revocation list — revocation relies on Firebase's ~1-hour ID-token TTL or explicit client re-auth.
- A misconfigured `FIREBASE_PROJECT_ID` fails closed (401) for all authed routes, with no fallback to anonymous.
- Any future migration off Firebase Auth (e.g., to Auth.js/Lucia) would require replacing both the client `firebase/auth` flow and this middleware.

## Related Decisions

- DEPENDS ON [ADR-0001] — this exact `jose` + `createRemoteJWKSet` pattern only works on Workers with `nodejs_compat`; on Node you would likely choose `firebase-admin`.
- Enables ADR-0004 (WebSocket authentication in `WSCoordinator`) and ADR-0006 (guest auto-provision reuses the same `email === null` branch).
- SUPERSEDES the pre-`5b3d101` posture of trusting client-supplied identity in REST/WS payloads.
