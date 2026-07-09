# Persistence: SQLite, node:sqlite, SQL migrations

**Status:** Accepted (Milestone 1)

## Context

The CMS needs a database that is trivial to run locally, fits the Remix v3
`data-table` layer, and does not add native build steps. The `data-table` layer
supports SQLite, Postgres, and MySQL adapters, plus a SQL-first migration system.

## Decision

Use **SQLite**, backed by Node's built-in **`node:sqlite`** (`DatabaseSync`)
through `remix/data-table/sqlite`. Schema changes are **hand-written SQL
migrations**; the runtime `table(...)` definitions mirror them for typed queries.

- Connection: `app/data/db.ts` builds a `DatabaseSync`, enables
  `PRAGMA foreign_keys = ON`, and wraps it with `createSqliteDatabaseAdapter` +
  `createDatabase`. The same helper backs the app (a file DB at
  `./db/app.sqlite`) and the tests (an in-memory `:memory:` DB).
- Migrations: plain SQL in `db/migrations/<timestamp>_<slug>/up.sql` (and
  `down.sql`). `db/migrate.ts` runs them via `createMigrationRunner` +
  `loadMigrations`; `db/seed.ts` creates the first admin. Both are exposed as
  `npm run db:migrate` and `npm run db:seed`.

## Why

- **Zero new runtime dependencies.** `node:sqlite` is built in, so there is no
  `better-sqlite3` native compile step. Password hashing likewise uses built-in
  `node:crypto` (scrypt), keeping the minimal-starter footprint.
- **Migrations own DDL, schema.ts documents it.** Per the framework guidance,
  migrations are the immutable source of truth for the actual database shape;
  `app/data/schema.ts` mirrors columns for typed reads/writes but does not create
  tables. Migrations never import app code, so replaying them stays stable.
- SQLite is ideal for local dev and single-node deployment. Switching to Postgres
  later is a matter of swapping the adapter in `app/data/db.ts`.

## Consequences

- **Node >= 24.3 is required.** `node:sqlite` is only stable on Node 24. This is
  declared in `package.json` `engines`, but a machine defaulting to Node 22 hits
  confusing failures; adding `.nvmrc` and a preflight is tracked as TEC-301.
- Timestamps are stored as epoch-millisecond integers.
- The generic content model (see [data-model](./data-model.md)) means only three
  real tables exist regardless of how many content types are created:
  `users`, `content_types`, `entries` (plus the migration journal).

## Where it lives

- `app/data/db.ts`, `app/data/schema.ts`
- `db/migrations/20260708120000_init/{up,down}.sql`, `db/migrate.ts`, `db/seed.ts`
