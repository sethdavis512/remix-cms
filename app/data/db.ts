import pg from 'pg'
import { createPostgresDatabase } from 'remix/data-table/postgres'

// PostgreSQL, through remix/data-table/postgres (backed by `pg`). The app and
// the tests each open their own config-backed database, so `db.migrate(...)`,
// `db.reset(...)`, and `db.close()` are available on both.

// Timestamps are epoch milliseconds stored in bigint columns. `pg` hands int8
// back as a string by default; parse it to a number so rows match the
// `c.integer()` (number) typing in schema.ts. Epoch ms is far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value))

export type AppDatabase = ReturnType<typeof createPostgresDatabase>

// Keep `remix.json#db` in sync with this default so the `remix db` CLI talks
// to the same database as the app.
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/remix_cms'

export function openDatabase(connectionString: string = DATABASE_URL): AppDatabase {
  return createPostgresDatabase({ connectionString })
}

// The app-wide database instance. `pg` connects lazily on first query, so
// importing this module does not open a connection. Tests open their own
// database against TEST_DATABASE_URL (see app/router.test.ts).
export const db = openDatabase()
