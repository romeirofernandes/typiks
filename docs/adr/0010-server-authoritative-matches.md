# ADR-0010: Server-Authoritative Match Persistence — `matches` + `matchParticipants`

Status: Accepted
Date: 2026-08-18
Author: Romeiro Fernandes

## Context & Problem Statement

`c42ab1b Server-authoritative match results + normalized match tables` lands after the app relied on client-authoritative results: the client posted `I won` with `score`/`progress` and the backend trusted it to increment `users`/`userModeStats`/`rankedGameLogs`. That lets a client rig the score and climb the leaderboard — even if not many people play yet, the site has to be correct. `spec.md §2.1` calls this class of bug fraud-prone. The schema also couldn't distinguish ranked vs unranked, team vs FFA, or disconnected vs finished.

The schema before this commit is `rankedGameLogs` + `games` + denormalized counters: no `matches` row to own a lobby's lifecycle, no `placement`/`result`/`wpm`/`accuracy`/`disconnected`/`ratingBefore/After` per participant, no `seed` determinism for word-list audits, and `userSettings.regionAnalyticsConsent` is a stub. `spec.md §4.1`'s Room/Match/Participant definitions have no backing tables.

## Decision

Introduce **server-authoritative `matches` + `matchParticipants`** (`backend/src/db/schema.js`, migration `0008_match_persistence.sql`) and move result calculation into `GameRoom`/`PrivateRoom` Durable Objects, with `persistRankedMatchResult` (`backend/src/services/match-results.js`) writing once per finished participant.

- `matches` (`id` PK, `roomCode` nullable, `mode: ranked|ffa|coop`, `modeSeconds`, `difficulty`, `seed`, `status`, `startedAt/endedAt/createdAt`, indexes on `roomCode`, `status`, `createdAt`) owns the lifecycle `spec.md §4.4` describes — one row per game run.
- `matchParticipants` (composite PK `matchId+userId`, FK `matchId → matches.id cascade`, `userId → users.id cascade`, `opponentId → users.id set null`, fields `placement`, `result: win|loss|draw|null`, `score/opponentScore`, `progress`, `correctChars`, `wpm: real`, `accuracy: real`, `disconnected`, `ratingBefore/After`, indexes on `matchId`, `userId`, `userDate`) records each participant's immutable facts. `wpm`/`accuracy` are `real` (the migration that adds `real` import is part of this commit).
- `userSettings` (`userId PK → users.id cascade`, `regionAnalyticsConsent: 0|1`) gates `accuracy by region` analytics per `spec.md §2.1`.
- `GameRoom` no longer trusts `POST`'d `score`: it derives `wpm`/`accuracy`/`correctChars` from its in-memory `activeGames` progress (the only authority that saw the typing), and calls `persistRankedMatchResult` once per game. Already-persisted `gameId+userId` pairs are unique (`ranked_game_logs_game_user_unique` + `matchParticipants` PK), so double-submit is idempotent — the same property `69cd297 Harden ranked matchmaking...` relied on for queue double-claims.
- `Persisted gameIds` for history: `rankedGameLogs` is kept for backward-compatible history reads (the 364-day `TypeGraph`), but new ranked history can be derived from `matchParticipants` filtered by `mode: ranked`.

## Alternatives Considered & Trade-offs

- **Keep client-authoritative `POST /result`**: Rejected — any client can automate `won: 1` at impossible WPM; `rankedGameLogs` alone cannot settle team modes (no `placement`) or disconnects (no `disconnected` flag).
- **Single denormalized `rankedGameLogs` with added columns**: Could have added `wpm`/`accuracy`/`disconnected` to `rankedGameLogs` and avoided a new table. Rejected: `rankedGameLogs` is per-user-per-ranked-game; `matches` is per-game-run. Private FFA/3v3 and unranked rooms need a shared `matches` row with multiple `matchParticipants` — a single log table per user cannot own that lifecycle.
- **Per-keystroke D1 writes from the DO**: Would give replay fidelity, but per `spec.md §3.4` D1 is not an event sink and would saturate under 6-player fanout (`spec.md §4.2` cap of 6). Rejected — amortize to one write per participant at `finished`.

Trade-off accepted: two persistence paths coexist (`rankedGameLogs` + `matches`/`matchParticipants`) until a future migration consolidates reads. In return, rating recomputation and fraud detection become possible from immutable, server-derived facts.

## Consequences

*Positive:*
- Hardened against duplicate submissions — the same `gameId+userId` double-write is a no-op (unique index), fixing the class of bug `69cd297` addressed for matchmaking at the results layer.
- Team modes and unranked private rooms now have a uniform `matches` owner; `placement` and `result: null` for FFA vs `win/loss/draw` for 1v1 cover both without a mode-specific table.
- `seed` per `matches`/`games` makes word-list audits deterministic without storing the full text per match.

*Negative:*
- Two sources of truth for ranked history (`rankedGameLogs` for the `TypeGraph`'s current queries, `matchParticipants` for new matches) — a future read-side migration must choose one.
- `userSettings` consent is currently boolean; richer per-feature analytics consent would need another column/migration.

## Related Decisions

- SUPERSEDES the client-authoritative result flow where `score`/`progress` from the client was trusted to increment `users`/`userModeStats` directly.
- DEPENDS ON [ADR-0004] — only the Durable Object that ran the match has authoritative progress to derive `wpm`/`accuracy` from.
- REFINES [ADR-0005] — extends the normalized competitive schema (`userModeStats`/`rankedGameLogs`/`games`) with the `matches` lifecycle the spec promised.
- REFINED BY [ADR-0011] — the FK pass (`references(() => ...)`) immediately after this commit retrofits integrity onto the tables defined here.
