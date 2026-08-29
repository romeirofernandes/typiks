# ADR-0001: Cloudflare Workers + Hono as Backend Runtime

Status: Accepted
Date: 2025-06-23
Author: Romeiro Fernandes

## Context & Problem Statement

`a7787a7 react frontend and backend with mongodb setup done` introduced a conventional Node backend — `backend/server.js`, `backend/config/db.js` (Mongoose/MongoDB). Within three days, at `bab332a shifting to cloudflare worker`, every one of those files was deleted and replaced with `backend/wrangler.jsonc` + `backend/src/index.js` wired to `Hono`.

The driver was **portfolio deployability for your resume**, not an abstract latency benchmark. A Node/Express backend on Render sleeps after ~15 minutes of inactivity and takes ~60 seconds to cold-start. For a solo project that recruiters/HR open directly from your resume/website, that 1-minute "waking up" spinner creates the exact wrong impression — the site looks broken. You wanted the whole backend on a runtime that **stays up** and wakes in milliseconds. Cloudflare Workers (with D1 + Durable Objects + WebSockets in the same deploy) lets you ship the entire stateful backend to `wrangler deploy` and never pay the Render sleep tax. The real-time needs (global queue, per-game sharding via `idFromName('game-${gameId}')`, presence) were a second-order win; the first-order win was "HR clicks and it just works."

## Decision

Adopt **Cloudflare Workers** as the sole backend runtime and **Hono** (`hono@^4.11.7`, `backend/src/index.js:1`) as the HTTP layer.

- `Hono()` with `c.env.DB` / `c.env.GAME_ROOM` / `c.env.MATCHMAKER` etc. maps 1:1 to `wrangler.jsonc` bindings (`d1_databases`, `durable_objects.bindings`, `migrations` v1–v4 for `GameRoom`/`PrivateRoom`/`PresenceHub`/`MatchmakingRoom`).
- `hono/cors` with explicit `origin: ['https://typiks.vercel.app','http://localhost:5173']` and `allowHeaders: ['Content-Type','Authorization']` replaces Express `cors()` middleware.
- `compatibility_date: 2025-08-01` + `compatibility_flags: ["nodejs_compat"]` keeps `jose`/`drizzle-orm` working inside `workerd` without a Node process.
- All REST (`/api/users`, `/api/rooms`, `/api/stats`) and WS upgrade sharding (`/ws`, `/ws/game/:gameId` → `idFromName('game-${gameId}')`, `/ws/room/:roomCode`, `/ws/presence`) lives in one `app` that is deployed with `wrangler deploy` (`backend/package.json` `deploy` script).

## Alternatives Considered & Trade-offs

- **Node + Express + Mongoose on Render (status quo ante, `a7787a7`)**: Familiar and cheap, but Render's free tier sleeps after ~15 min idle and cold-starts ~60 s. For a CA portfolio link that HR/recruiters open cold, that spinner *is* the product. You also lose Durable Objects/D1 co-location and would need Redis + sticky sessions for rooms. Rejected primarily for **deploy impression**, secondarily for stateful coordination cost.
- **Fastify on Render/Cloud Run/Fly**: Same Render sleep tax as Express (if on Render) or a different billable VM tax elsewhere. Lower overhead than Express but still needs an external store for rooms. Not a fix for the "always up" requirement.
- **Next.js API routes (Vercel)**: Would couple `frontend` (already a Vite SPA `vite@^6.3.5`) to the backend runtime and still has no binding to Durable Objects/D1. Rejected for portability and for not solving the sleep problem portably.
- **Hono on Bun/Deno**: Fast, but no native binding to D1/Durable Objects. Hono was chosen because it is the idiomatic Workers framework: `c.env` typing via `worker-configuration.d.ts`, `hono/cors` matching `wrangler.jsonc` origins, and zero-cold-start routing in `workerd`.

Trade-off accepted: Workers' 128 MB isolate and CPU limits force disciplined per-request work (no per-keystroke D1 writes, see ADR-0004) and `nodejs_compat` for `jose`/`drizzle-orm`. You also accept Cloudflare lock-in. In return the whole backend — REST, D1, 4 Durable Object classes, WebSockets — deploys with one `wrangler deploy` and stays warm for that HR click.

## Consequences

*Positive:*
- One command (`wrangler dev` / `wrangler deploy`) runs the entire stateful backend; `miniflare` via `@cloudflare/vitest-pool-workers` gives identical local semantics for tests (`backend/vitest.config.mjs`).
- Match throughput is sharded by game/room code — no single bottleneck beyond the global `MatchmakingRoom` queue, which is intentionally low-traffic.
- D1 and Durable Objects are co-located, so `persistRankedMatchResult` in `GameRoom.js` can write without cross-region hops.

*Negative:*
- Workers isolate limits (memory, CPU) must be respected in every DO; heavy compute (e.g., word generation) is kept to `generateWords`/`generateSeed` utilities, not per-keystroke DB writes.
- `nodejs_compat` is required for `jose` and `drizzle-orm`; any future Node-only dependency must be vetted for `workerd` compatibility.
- Vendor lock-in to Cloudflare for stateful coordination — migrating GameRooms off Workers would require reimplementing the entire real-time layer.

## Related Decisions

- SUPERSEDES the Node + Express + MongoDB architecture established in `a7787a7` and deleted in `bab332a`.
- `DEPENDS ON` nothing — this is the root runtime choice on which ADR-0002 (D1+Drizzle) and ADR-0003 (JWT via `jose`) depend.
- Enables ADR-0004 (Durable Objects) — the bindings in `wrangler.jsonc: durable_objects.bindings` only exist on this runtime.
