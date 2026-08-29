# ADR-0005: Normalized Competitive Schema for Ratings and History

Status: Accepted
Date: 2026-04-04
Author: Romeiro Fernandes

## Context & Problem Statement

At `spec.md` baseline the DB was `users` alone (`users.id` = Firebase UID, `rating: 800` + counters). By `ba1dd14 Dashboard + New Schema` and `0af3383 Profile page refactoring`, the product had outgrown it — ranked play needs ratings that differ by duration, exactly like chess.com's bullet/blitz/rapid. A single `users.rating` makes no sense when 15 s and 60 s are different skills. You kept `users.rating` as the **highest of the three per-mode ratings** (the headline rank) and introduced per-mode tables so each mode has its own ladder. This mirrors chess.com and other platforms you took inspiration from. Without that split, friend/room graphs and the 364-day `TypeGraph` would also stay unindexed.

## Decision

Normalize competitive and social state into **six new tables** in `backend/src/db/schema.js`, keeping `users` as the identity root and preserving `users.rating` as the max of per-mode ratings:

- **Per-mode ratings**: `userModeStats` (PK `userId+modeSeconds`, per-mode `rating`/`gamesPlayed/Won/Lost/Drawn`/`totalScore`) holds the 15/30/60 s ladders; `users.rating` remains the headline `GREATEST` of the three. Inspired by chess.com's separate bullet/blitz/rapid ratings.
- **Immutable history**: `rankedGameLogs` (unique `gameId+userId`, `userDate` + `modeSeconds` indexes for the 364-day `TypeGraph`, `ratingBefore/After`, `won/isDraw`), `games` (seeded word-list: `modeSeconds`/`difficulty`/`seed`/`status`, `finishedAt`).
- **Social graph**: `friendRequests` (`senderId`/`receiverId`/`status`, unique on `sender+receiver`), `friendships` (composite PK `userA+userB`, `userA < userB` canonicalization), `roomInvites` (unique pending invite on `roomCode+inviter+invitee+status`).
- **Product identity**: `users` gains `country`, `lastSeenAt`, `nextWordCondition` (`text` default `auto`, `commit c8e0f80`), and the `city` column is later removed.

All are `sqliteTable` via `drizzle-orm/sqlite-core` so `drizzle-kit` generates `0001_bent_puck.sql` through `0003_rated_modes.sql` with deterministic index names (`friend_requests_receiver_status_idx`, etc.).

## Alternatives Considered & Trade-offs

- **Stay on `users` counters only**: Zero migrations, but leaderboard tie-breaks, per-mode rating (15 vs 60 s are different skills), and fraud detection (impossible WPM spikes per `spec.md §2.1`) become impossible. Rejected: it blocks every multiplayer feature in `spec.md §4`.
- **Single denormalized `matches` JSON blob**: One table with a JSON `participants` array. Simple writes, but no `JOIN` to `users` for usernames, no indexes on `modeSeconds`/`createdAt`, and no admin pagination. Rejected.
- **MongoDB documents per user with nested arrays**: Would avoid JOINs, but loses D1 co-location (ADR-0002) and forces application-level dedup for `friend_requests_sender_receiver_unique`. Rejected with the Workers pivot.
- **Per-keystroke event table**: Preserve every keystroke for replay. Rejected per ADR-0004 — D1 would saturate; Typiks records per-match aggregates (`wpm`/`accuracy`/`score` in `rankedGameLogs` and later `matchParticipants`) plus seeded `seed` to reconstruct the word list deterministically.

Trade-off accepted: more tables mean more indexes to maintain (`meta/_journal.json` tracks 11 SQL files) and broader surface for FK hardening (see ADR-0011). In return, every read path is indexed and rating recomputation is possible from the immutable logs.

## Consequences

*Positive:*
- `userModeStats` enables per-mode dashboards and leaderboards without rewriting `users.rating` semantics; `games` with `seed` makes word lists reproducible without storing the full text per match.
- `friendRequests`/`friendships` canonicalization (`userA < userB`) prevents duplicate friendships and makes `WHERE userA = ? OR userB = ?` index-friendly.
- The later `matches`/`matchParticipants` design (ADR-0010) can reference this base without redesigning identity — `matchParticipants.userId` FK points to `users.id` because this ADR established `users` as the stable PK.

*Negative:*
- Any new mode (e.g., team FFA) must touch `userModeStats` PK and `rankedGameLogs` `modeSeconds` indexes — schema changes are not free.
- `roomInvites`'s `uniquePendingInvite` on 4 columns is strict; a relaxed flow (e.g., re-inviting after decline) requires explicit `status` handling rather than a blind insert.

## Related Decisions

- REFINES [ADR-0002] — this is the first substantive schema built atop D1+Drizzle beyond `users`.
- DEPENDS ON [ADR-0001] (Workers) for D1 binding availability.
- Enables ADR-0009 (shared typing engine assumes per-mode stats exist) and REFINED BY ADR-0010 (server-authoritative `matches`/`matchParticipants`) and ADR-0011 (FK hardening adds `references(() => users.id)` to every table defined here).
