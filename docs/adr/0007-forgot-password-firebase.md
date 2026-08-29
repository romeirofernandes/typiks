# ADR-0007: Forgot Password via Firebase Built-in Reset

Status: Accepted
Date: 2026-08-08
Author: Romeiro Fernandes

## Context & Problem Statement

There is no way to recover a forgotten password. If a user loses it, they are locked out permanently — no "Forgot password?" link in `frontend/src/components/login-form.jsx`, no reset route in `frontend/src/App.jsx`, no email infra in the backend.

The obvious self-hosted solution — a custom-themed email with a reset code from the Worker — is expensive: the backend is a Cloudflare Worker (`backend/wrangler.jsonc`, `nodejs_compat`) where `nodemailer` over Gmail SMTP *could* work, but would require `GMAIL_USER`/`GMAIL_PASSWORD` as `wrangler` secrets, a Firebase Admin SDK service-account key (only Admin SDK can set a Firebase password, and `firebase-admin` is not installed — auth is verified with `jose` via JWKS in `backend/src/middleware/firebaseAuth.js`), and a reset-code store (D1 table or KV) with expiry/single-use/rate-limit — none of which exists. Firebase already ships this as a first-party SDK call.

## Decision

Use **Firebase's built-in password reset** (`sendPasswordResetEmail`) — frontend-only, zero backend changes (`59c768c Forgot password done`).

- Add public `/forgot-password` (`frontend/src/pages/ForgotPassword.jsx`) and a "Forgot password?" link under the password field in `login-form.jsx`.
- Collect email → `sendPasswordResetEmail(auth, email, { url: ${window.location.origin}/signin })`. Firebase sends its branded email; the user lands on Firebase's hosted "set new password" page and `continueUrl` bounces to `/signin`.
- Generic success messaging: always "If an account exists for that email, a reset link is on its way" — never reveals whether an email is registered (anti-enumeration). Only `auth/invalid-email` and `auth/too-many-requests` are surfaced.
- Rate limiting is Firebase's job (`auth/too-many-requests`).
- Guests need nothing special: `guest-<uid>@guest.typiks` exists only in D1 `users`, not in Firebase Auth; a reset for it fails `user-not-found` which the generic message swallows. Backend, D1, `wrangler.jsonc` untouched.

## Alternatives Considered & Trade-offs

- **Self-hosted nodemailer + Gmail SMTP** (`GMAIL_USER`): Rejected — needs service-account key (not installed), SMTP secrets, reset-code store with expiry/rate-limit, all to produce an email Firebase already sends.
- **Admin SDK `generatePasswordResetLink` + nodemailer**: Generate link server-side, email ourselves. Rejected — same key + SMTP cost, but ships the same Firebase reset page — no UX win.
- **No recovery at all**: Rejected — lockout after invested rating/history is unacceptable.

## Consequences

*Positive:*
- No `firebase-admin`, no service-account key, no SMTP secrets, no D1 migration — entire self-hosted path avoided.
- Two new frontend surfaces only; `sendPasswordResetEmail` is the sole new `firebase/auth` import.
- Generic messaging is the standard privacy trade-off and is expected.

*Negative:*
- Email is Firebase-branded (customizable only via Firebase console — app name/logo). Not themed to Typiks; accepted as recovery > branding.
- Depends on Firebase email deliverability; no self-hosted retry queue.

## Related Decisions

- DEPENDS ON [ADR-0003] — the project already trusts Firebase Auth via `jose` verification; this ADR intentionally avoids introducing `firebase-admin`.
- Independent of ADR-0006 (guest login) but shares the same anti-enumeration posture — guest synthetic emails are naturally hidden.
