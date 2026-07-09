import { DatabaseSync } from 'node:sqlite'

import { createDatabase } from 'remix/data-table'
import { createSqliteDatabaseAdapter } from 'remix/data-table/sqlite'

// SQLite database, backed by Node's built-in node:sqlite (requires Node >= 24).
// The same helper backs the app (a file DB) and tests (an in-memory DB).

export function createSqliteDatabase(filename: string) {
  let sqlite = new DatabaseSync(filename)
  sqlite.exec('PRAGMA foreign_keys = ON')
  return createDatabase(createSqliteDatabaseAdapter(sqlite))
}

export type AppDatabase = ReturnType<typeof createSqliteDatabase>

export const DATABASE_PATH = process.env.DATABASE_PATH ?? './db/app.sqlite'

// The app-wide database instance. Tests build their own via createSqliteDatabase.
export const db = createSqliteDatabase(DATABASE_PATH)
