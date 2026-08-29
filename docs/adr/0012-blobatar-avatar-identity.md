# ADR-0012: Avatar Identity via `blobatar`

Status: Accepted
Date: 2026-08-18
Author: Romeiro Fernandes

## Context & Problem Statement

`40436bd cooked` added `avatarId text NOT NULL default 'avatar1'` to `users`, and `0004_solid_harbor.sql` seeded it. By `5df3f39 Codebase revamped and new avatars added`, every avatar was a static asset choice — `avatar1` through `avatarN` in `frontend/src/assets` or similar — requiring a D1 column, a migration, and a UI picker. Two problems surfaced:

- The column is user-editable state that must be fetched on every `users` read (leaderboard, globe, presence, room lobby) and kept in sync after a username change.
- The set is closed — adding a new avatar means shipping a new asset, bumping `avatarN+1`, and migrating existing users if the default changes.

`0007_user_avatar_id.sql` and `0009_drop_avatar_id.sql` show the churn: the column is added, defaulted, and then dropped within the same August 18 window. The product needs an avatar that is unique per user, requires no picker, and needs no column.

## Decision

Derive **avatar identity deterministically from the user's UID** via **`blobatar`** (`blobatar@^0.2.0` in `frontend/package.json`, `5df3f39`).

- Frontend renders `<Blobatar id={user.id} size={32} />` (or equivalent) — the SVG is generated from the UID hash, so two users never collide and one user always sees the same avatar.
- `users.avatarId` is removed (`0009_drop_avatar_id.sql` + `backend/src/db/schema.js` dropping `avatarId: text('avatar_id')`). The `users` table now has no avatar column at all — avatar is a presentation concern, not a persistence concern.
- No picker, no asset pipeline, no D1 write on avatar change. Changing username (ADR-0006's anonymous → permanent link flow) does not affect the avatar because it is keyed by `users.id` (Firebase UID), not `username`.

## Alternatives Considered & Trade-offs

- **Keep `avatarId` column with static assets**: Rejected — the column is pure UI state that pollutes every `users` read, and the closed asset set scales poorly. The migration pair `0007`/`0009` proves the churn.
- **Gravatar / DiceBear / external avatar service**: Generates from email/username, but introduces an external network dependency for every leaderboard/globe render and leaks user email hashes. Rejected: `blobatar` is local, deterministic, and has no network or privacy cost.
- **Store avatar SVG in D1 (`users.avatarSvg text`)**: Persisted, but stores a redundant derivative of `id` — every new user would write a multi-KB SVG that could be regenerated. Rejected: it wastes D1 storage for no read benefit.
- **No avatar (initials only)**: Minimal, but weaker visual identity for a social game built around `TheGlobe` and `Leaderboard` where avatars are the primary differentiator. Rejected by product.

Trade-off accepted: avatars are not user-customizable — a player cannot pick `avatar3` vs `avatar7`. Personalization is intentionally traded for zero-state, deterministic identity. A future "custom avatar" would require re-adding a column, but that is a deliberate product gate, not an accident.

## Consequences

*Positive:*
- Zero D1 storage for avatars; `users` reads (leaderboard, presence, roomMembers) return one less column and never need a join to an asset table.
- Deterministic: `user.id` → same SVG on every device, survives username changes and anonymous → permanent linking (ADR-0006) because the UID is stable.
- `0009_drop_avatar_id.sql` removes the migration debt introduced by `0004_solid_harbor` — the schema is smaller after this ADR than before.

*Negative:*
- Avatar is not editable — a user who dislikes their generated blob cannot change it without changing UID (i.e., creating a new account).
- Visual uniqueness relies on `blobatar`'s hash distribution; collisions are negligible but the design space is limited to what `blobatar` generates vs a hand-crafted set.

## Related Decisions

- SUPERSEDES the `avatarId` column added in `40436bd` / `migrations/0004_solid_harbor.sql` and removed in `0009_drop_avatar_id.sql`.
- REFINES [ADR-0002] — reduces the `users` table to identity/profile fields (`username`, `email`, `country`, `rating`, etc.), removing presentation state from persistence.
- Independent of ADR-0006 (guest login) but benefits it: anonymous guests get a meaningful avatar without choosing one, improving the first-session UX.
