# ADR-0011: D1 Foreign Keys and Cascade Integrity

Status: Accepted
Date: 2026-08-18
Author: Romeiro Fernandes

## Context & Problem Statement

`6f5e16b Room links done + schema refactoring` adds `references()` to `backend/src/db/schema.js` across 5 tables in one diff. Before this commit, every FK-like column was a bare `text` — `matchParticipants.matchId`, `userId`, `opponentId`, `userSettings.userId`, `rooms.ownerId`, `roomMembers.roomCode/userId` — with no database-level enforcement. The app relied on application code to delete orphan rows, but `spec.md §2.1` already warns about the need for efficient admin pagination and auditability, and `6f5e16b`'s own diff shows the risk: a deleted user leaves `matchParticipants` rows pointing at a ghost `userId`, and a closed `rooms.roomCode` leaves `roomMembers` orphaned.

D1 is SQLite, so FKs are opt-in (`PRAGMA foreign_keys`) and Drizzle must emit them as `references(() => table.id, { onDelete: ... })`. The migration `0010_foreign_keys.sql` is the first time the project turns them on.

## Decision

Enforce **referential integrity in D1 via `references()`** in `drizzle-orm/sqlite-core` (`backend/src/db/schema.js`, commit `6f5e16b`), with explicit `onDelete` policies per relationship:

- `matchParticipants.matchId → matches.id` `onDelete: cascade` — a match hard-delete cleans its participants.
- `matchParticipants.userId → users.id` `onDelete: cascade` — deleting a user (e.g., GDPR erasure, orphaned guest GC when it ships) cascades their participations; `opponentId → users.id` uses `onDelete: set null` to preserve the row with a null opponent.
- `userSettings.userId → users.id` `onDelete: cascade` — settings die with the user.
- `rooms.ownerId → users.id` `onDelete: cascade` — a room owned by a deleted user is reaped (rooms are ephemeral per ADR-0012's link TTL, so this is safe).
- `roomMembers (roomCode → rooms.roomCode, userId → users.id)` both `onDelete: cascade` — membership evaporates with either side.

All FKs are emitted by `drizzle-kit` into `migrations/0010_foreign_keys.sql`; the journal in `migrations/meta/_journal.json` records the ordering after `0009_drop_avatar_id.sql`.

## Alternatives Considered & Trade-offs

- **Application-level cascading (status quo ante)**: Every `DELETE FROM users WHERE id = ?` must manually `DELETE FROM matchParticipants / roomMembers / userSettings` in code. Rejected: it leaks integrity into every route, is easy to forget (the pre-`6f5e16b` code did forget), and leaves orphans on crash or partial failure. D1's per-request isolation makes app-level cascades race-prone.
- **No FKs, rely on `LEFT JOIN` null handling**: Queries like leaderboard `JOIN users` would always need `COALESCE`/`WHERE users.id IS NOT NULL` to hide ghosts. Rejected: it pushes garbage collection into every read path instead of one schema declaration.
- **`onDelete: restrict` everywhere**: Prevents deleting a user who has participations — safe but hostile to GDPR erasure and guest cleanup. Rejected per product: guest rows (ADR-0006) must be GC-able.
- **Deferrable FKs**: SQLite supports `DEFERRABLE INITIALLY DEFERRED`, but the workload is request-scoped `drizzle(c.env.DB)` transactions — immediate enforcement is simpler and fails fast.

Trade-off accepted: `onDelete: cascade` means a `DELETE FROM users` is irrevocable fanout — a mistaken admin delete cascades to all participations. Mitigated by the fact that the app has no admin `DELETE users` route today; the cascade is primarily for future GC tooling.

## Consequences

*Positive:*
- Hard deletes are now safe — no orphan `matchParticipants` or `roomMembers` after user/room/match deletion.
- `LEFT JOIN` queries (leaderboard, `TypeGraph`) no longer need ghost filtering; `opponentId set null` preserves history rows when an opponent is erased while still showing the participant's own `wpm`/`accuracy`.

*Negative:*
- SQLite FKs require `PRAGMA foreign_keys = ON` per connection — `drizzle-orm/d1` enables this via the `d1-http` driver, but a raw `DB.exec` outside Drizzle would silently bypass it.
- Migration ordering matters: `0010_foreign_keys.sql` must run after `0008_match_persistence.sql` which created `matches`/`matchParticipants` — `drizzle-kit` handles this, but manual SQL in `wrangler d1 execute` must respect it.

## Related Decisions

- REFINES [ADR-0002] — retrofits the D1+Drizzle schema defined there with database-level guarantees that were missing at `ba1dd14`.
- REFINES [ADR-0005] and [ADR-0010] — every table those ADRs introduced (`matches`, `matchParticipants`, `rooms`, `roomMembers`, `userSettings`) is the subject of this FK pass.
- Complements ADR-0010's `SUPERSEDES` claim — server-authoritative writes are only durable if the rows they create are not left dangling after a later delete.
