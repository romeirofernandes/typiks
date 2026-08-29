# ADR-0002: D1 SQLite + Drizzle ORM for Persistence

Status: Accepted
Date: 2025-06-23
Author: Romeiro Fernandes

## Context & Problem Statement

`a7787a7` used MongoDB (Mongoose). By `1e49716 setting up drizzle` and `a8a5e9d made migrations`, the backend had already pivoted: `backend/drizzle.config.js` declares `dialect: sqlite`, `driver: d1-http`, `schema: ./src/db/schema.js`; `wrangler.jsonc` binds `DB` (`database_name: typiks`, `8bccfddd…`). The reason was practical: when you looked it up, you found **there is no MongoDB driver that runs on Cloudflare Workers**. Staying on Mongo would have meant a separate Atlas cluster plus a bridge that doesn't exist for `workerd`. Once Workers was chosen (ADR-0001, Render sleep), **D1 SQLite was the natural fit** — it's the only durable store co-located with Workers and Durable Objects.

## Decision

Adopt **Cloudflare D1 (SQLite)** as the durable store and **Drizzle ORM** (`drizzle-orm@^0.45.2`, `drizzle-kit@^0.18.1`) as the query layer.

- `drizzle.config.js` uses `dialect: sqlite` + `driver: d1-http` with `wranglerConfigPath`, so `drizzle-kit` reads the binding without a separate connection string.
- `backend/src/db/schema.js` is the single source of truth: `sqliteTable` with `text`/`integer`/`real` + `index`/`uniqueIndex`/`primaryKey` + `.references(() => users.id, { onDelete: 'cascade' })` (added in `6f5e16b` and ADR-0011).
- Migrations are `drizzle-kit` SQL in `backend/migrations/0000_...sql` through `0010_foreign_keys.sql`, applied via D1. `meta/_journal.json` tracks them; `0000_snapshot.json` is the initial `users` snapshot.
- Runtime usage is `drizzle(c.env.DB)` per request (`backend/src/index.js`, `backend/src/services/match-results.js`), not a singleton pool — D1's HTTP driver is request-scoped, matching Workers' isolate model.

## Alternatives Considered & Trade-offs

- **Staying on MongoDB (Mongoose)**: You checked and found no Mongo driver that runs on Cloudflare Workers (`workerd`). That alone ruled it out — you'd need an external Atlas cluster and a bridge that doesn't exist for Workers. Rejected.
- **Prisma vs Drizzle**: Once D1 was chosen, the ORM choice was Prisma or Drizzle. You had worked with Drizzle before, so you picked Drizzle. No deep bake-off — familiarity was the deciding factor.
- **TypeORM / Kysely / raw SQL**: Not seriously evaluated; Prisma and Drizzle were the two you considered.

Trade-off accepted: D1 is SQLite (no `pg_trgm`, per-request HTTP overhead) but fits the write-once-per-match pattern; Drizzle is light and `sqliteTable` gives you schema-as-code plus `drizzle-kit` migrations in one artifact.

## Consequences

*Positive:*
- One schema file (`src/db/schema.js`, ~260 lines) defines 11 tables, 20+ indexes, and all FKs — a future reader can grep it before touching any route.
- Queries like `rankedGameLogs` per-user-per-mode or `matchParticipants` per-room are indexed (`userModeIdx`, `roomCodeIdx`) without manual Atlas index management.
- Migrations 0007–0010 show reversible evolution: `avatarId` added (`0004_solid_harbor`) then removed (`0009_drop_avatar_id`) when `blobatar` superseded it (ADR-0011).

*Negative:*
- D1 is SQLite: no `SELECT ... FOR UPDATE` semantics, no `pg_trgm`/`tsvector` for full-text search, and per-request HTTP overhead vs a pooled PG connection. For Typiks' write-once-per-match pattern this is acceptable; it would not suit high-frequency event streaming.
- Migration ergonomics are weaker than Prisma — `drizzle-kit` generates SQL but FK ordering and `onDelete: cascade` must be manually verified (the `6f5e16b` diff proves this required a dedicated commit).
- Any future switch to Postgres would require rewriting `sqliteTable` to `pgTable` and rethinking `wrangler.jsonc` bindings.

## Related Decisions

- DEPENDS ON [ADR-0001] — D1 bindings only exist on Cloudflare Workers; this decision is moot on Node.
- Enables ADR-0004 (Durable Objects persist to D1 once per match, not per keystroke) and ADR-0005 (normalized competitive schema).
- REFINES the initial `users`-only baseline described in `spec.md §1.1`; REFINED BY ADR-0010 (server-authoritative matches) and ADR-0011 (FK hardening).
