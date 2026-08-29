# ADR-0008: TanStack Query for Server State

Status: Accepted
Date: 2026-08-13
Author: Romeiro Fernandes

## Context & Problem Statement

`818b71c Tanstack Query is in place` lands after the app has `AuthContext` + ad-hoc `useEffect`/`fetch` in `Game.jsx`/`CreateRoom.jsx`/`Profile.jsx`. You had free time and were exploring modern data-fetching practices — you heard TanStack Query could replace every `useEffect` fetch with a managed cache and make the app faster/better organized, so you installed the skill and migrated. It was an intentional experiment to see if it actually improved performance and maintainability, not a migration forced by a production bug.

## Decision

Adopt **TanStack Query** (`@tanstack/react-query@^5.101.4` in `frontend/package.json`) as the server-state layer, with `usePlayerPreferences` and `meKeys`/`userKeys` as the key factory.

- Central `QueryClient` with `staleTime`/`gcTime` tuned per resource (user, stats, rooms) — reads are cached and deduped across routes.
- Query keys are derived from the backend contract (`meKeys`, `userKeys`, `query-keys` module), so `invalidateQueries` after `POST /api/users` or `persistRankedMatchResult` in `GameRoom` naturally refetches dashboards without prop drilling.
- Mutations (e.g., `useProvisionUser` for guest auto-provision, username change) use `useMutation` with optimistic `onSuccess` invalidation, not manual `setState` after fetch.
- `usePlayerPreferences` co-locates `nextWordCondition` persistence with its query, avoiding a separate Zustand/Redux slice for what is fundamentally server-derived preference.

## Alternatives Considered & Trade-offs

- **Redux + Thunk / Zustand**: Global stores for server data require manual cache invalidation, `loading` flags per slice, and manual dedup of identical requests. They treat server state as client state — every fetch is a manual write to the store. Rejected: more boilerplate for the same freshness problem TanStack solves with `staleTime`/`refetchOnWindowFocus`.
- **SWR**: Similar stale-while-revalidate ergonomics, but TanStack's `queryKey` factory, `select` for derived data, and `useMutation` + `queryClient.invalidateQueries` give finer-grained control for invalidating `rankedGameLogs` after a match without refetching unrelated keys. SWR's `mutate` is coarser.
- **Ad-hoc `useEffect` + `fetch` (status quo ante)**: Zero dependency, but every page reimplements `loading`/`error`/`retry` and misses background refetch after a WebSocket `MATCH_FOUND` or `ROOM_CLOSED`. Rejected — the 818b71c diff already shows the duplication cost.
- **Apollo/Relay (GraphQL)**: Powerful, but the backend is REST (`Hono` routes, not a GraphQL schema). Rejected: no GraphQL layer to justify the client.

Trade-off accepted: `+~12 kB` bundle (`@tanstack/react-query` + `react-query` devtools if enabled) and a new mental model (`queryKey` stability, `gcTime`). In return, leaderboards, profiles, and dashboards share one cache and refetch coherently after WS events.

## Consequences

*Positive:*
- One `QueryClient` eliminates N× fetch duplication across `Dashboard`, `Profile`, `Leaderboard`, `TheGlobe` — all read the same cached `users`/`userModeStats`.
- `invalidateQueries` after `GameRoom`'s `persistRankedMatchResult` ensures the 364-day `TypeGraph` and rating displays update without a full reload.
- Devtools (`@tanstack/react-query-devtools` when enabled) make cache misses and stale times observable, which manual `useEffect`fetch never did.

*Negative:*
- Query keys must be stable and centrally defined (`meKeys` etc.) — a typo'd key silently creates a shadow cache.
- `staleTime` tuning is required; too-aggressive `refetchOnWindowFocus` can spam D1 reads if not throttled (mitigated by 1 s progress persist interval in `GameRoom`).

## Related Decisions

- DEPENDS ON [ADR-0003] — all queries attach `Authorization: Bearer <Firebase ID token>` and assume `jose` verification on the backend; anonymous guests (ADR-0006) flow through the same cache keys.
- Enables ADR-0009 (typing engine is purely client-ephemeral and intentionally *bypasses* TanStack — Free Play discards on refresh, so it never hits the cache).
- REFINES the data fetching posture that existed after `eeb36df dashboard done along with protected component` — before this ADR every page owned its own fetch.
