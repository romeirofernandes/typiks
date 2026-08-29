# ADR-0004: Durable Objects for Stateful Real-time Coordination

Status: Accepted
Date: 2025-08-04
Author: Romeiro Fernandes

## Context & Problem Statement

Workers are stateless — a `fetch` handler cannot hold a WebSocket, a queue, or a lobby between requests. Typiks needs four stateful surfaces, all WebSocket-driven:

- **Ranked queue**: exactly-once pairing of two strangers from a global pool (`MatchmakingRoom`).
- **Ranked game**: a sharded, phase-machine-driven match (waiting → countdown 3500 ms → playing → finished/aborted) with rematch and 20s handoff timeout (`GameRoom.js`).
- **Private rooms**: lobby lifecycle (create/close, owner/member, `maxPlayers: 6`, `wordCount`, invites) with broadcast fanout (`PrivateRoom.js`).
- **Presence**: global online/offline with pub/sub, 45 s timeout, 15 s alarm (`PresenceHub.js`, `9653889 bot mode done, live online/offline with pubsubs`).

Per `spec.md §3.4`, per-keystroke progress cannot be written to D1 — D1 is for once-per-match facts. A stateful coordinator that persists between requests is required, and on Cloudflare the natural primitive for that is Durable Objects.

## Decision

Adopt **Cloudflare Durable Objects** as the *only* stateful real-time engine, with a shared `WSCoordinator` base and explicit sharding by name:

- `wrangler.jsonc: durable_objects.bindings` declares 4 classes — `MATCHMAKER → MatchmakingRoom` (`global-matchmaker`), `GAME_ROOM → GameRoom` (`game-${gameId}`), `PRIVATE_ROOM → PrivateRoom` (`room-${roomCode}`), `PRESENCE_HUB → PresenceHub` (`global-presence-hub`) — and `migrations` v1–v4 introduce each via `new_sqlite_classes` (storage-backed DOs).
- `WSCoordinator.js` handles the Hibernatable WS lifecycle (`handleSession`, session replacement vs multi-session, `setAlarm`-based timeouts), so each subclass only implements its phase logic.
- Sharding: `c.env.MATCHMAKER.idFromName('global-matchmaker')` for the single ranked queue (intentionally single — queue traffic is tiny), `idFromName('game-${gameId}')` per ranked match, `idFromName('room-${roomCode}')` per private lobby, and one global presence hub. Fanout cost grows with N=6 max per `spec.md §4.2`, so a single DO per game/room stays well under the ~1k/s soft limit.
- Persistence: each DO mirrors its phase in a single `roomState` storage key (`buildRoomState()` in `GameRoom.js`) and uses Durable Object alarms (not `setTimeout`) for `waitDeadline` (20 s) and `rematch` (10 s) — alarms survive eviction/restarts. D1 writes are amortized: `persistRankedMatchResult` once per finished game, throttled progress persist at `PROGRESS_PERSIST_INTERVAL_MS = 1000` ms.

## Alternatives Considered & Trade-offs

- **Redis pub/sub + Node WS fleet (Socket.IO)**: Well-known for real-time rooms, but needs a separate Redis fleet, sticky sessions, and manual sharding to avoid the "one object handles too many matches" hot spot (`spec.md §4.4`). Extra infra for a solo project and no co-location with D1.
- **Polling / Server-Sent Events**: Trivial, but sub-second typing progress, rematch negotiation, and presence would need aggressive polling, defeating the "amortize D1 writes" goal. Worse UX.
- **Single global DO for all games**: Simpler (`/ws` only), but one DO becomes the ~1,000 req/s bottleneck from `spec.md §3.1`. Sharding by `gameId`/`roomCode` costs one `idFromName` per upgrade and eliminates contention.
- **D1 as real-time event bus**: Writing every keystroke to D1. Rejected — D1 is a SQL facts store, not an event stream sink per `spec.md §3.4`; it would saturate under 6-player fanout (`spec.md §4.2` cap of 6).

This was the natural choice for the stack that was already on Workers + D1 — Durable Objects are Cloudflare's stateful primitive, so adopting them avoided introducing a second platform (Redis) and kept state, alarms, and WebSocket hibernation inside `workerd`.

Trade-off accepted: DOs are single-threaded with no cross-object transactions; a match that evicts mid-countdown must hydrate from `roomState` (hence the explicit phase machine). In return, no external coordination infra and free co-location with D1.

## Consequences

*Positive:*
- Four lifecycles are cleanly isolated — `MatchmakingRoom` only queues, `GameRoom` only runs one match+rematches, `PrivateRoom` owns `rooms`/`roomMembers` lifecycle, `PresenceHub` owns `userSessions`/`onlineStateByUser`.
- `WSCoordinator` centralizes session replacement semantics, so the "replaced by newer session" kick in `Game.jsx:330` now only fires for legitimate double-connects, not for two strangers colliding on one UID (fixed end-to-end by ADR-0006).
- `wrangler dev` with `miniflare` plus `@cloudflare/vitest-pool-workers` (`backend/vitest.config.mjs`) tests DO logic locally without a real edge deployment.

*Negative:*
- All DO code must be `workerd`-compatible and single-threaded — no `Worker threads`, no shared-memory tricks.
- Debugging a distributed race (e.g., `pendingGames` TTL 60 s in `MatchmakingRoom` vs `waitDeadline` 20 s in `GameRoom`) requires correlating `roomState` snapshots across two DO storage keys, not one DB.
- Scaling beyond 6 players per match (see `spec.md §4.2` cap of 6) would require throttling progress events per word, not per keystroke, and revisiting the per-object soft limit.

## Related Decisions

- DEPENDS ON [ADR-0001] — Durable Objects only exist on Workers — and [ADR-0002] — D1 is the durable sink that DOs write to once per match.
- DEPENDS ON [ADR-0003] — `WSCoordinator.js:36-45` verifies the Firebase JWT before any `JOIN_QUEUE`/`JOIN_GAME` is accepted.
- Enables ADR-0010 (server-authoritative `matches`/`matchParticipants` persistence from inside `GameRoom`) and ADR-0012 (live room links reuse `PRIVATE_ROOM` sharding).
- REFINED BY the addition of `PresenceHub` (v3) and `MatchmakingRoom` (v4) migrations — the initial `v1 GameRoom`-only design was widened without changing the sharding principle.
