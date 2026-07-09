import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { createMigrationRunner } from 'remix/data-table/migrations'
import { loadMigrations } from 'remix/data-table/migrations/node'
import { createSqliteDatabaseAdapter } from 'remix/data-table/sqlite'

// Applies (or reverts) SQL migrations under db/migrations.
// Usage: node --import remix/node-tsx db/migrate.ts [up|down]

let direction = process.argv[2] === 'down' ? 'down' : 'up'
let dbPath = process.env.DATABASE_PATH ?? './db/app.sqlite'

let sqlite = new DatabaseSync(dbPath)
sqlite.exec('PRAGMA foreign_keys = ON')

let adapter = createSqliteDatabaseAdapter(sqlite)
let migrations = await loadMigrations(path.resolve('db/migrations'))
let runner = createMigrationRunner(adapter, migrations)

let result = direction === 'up' ? await runner.up() : await runner.down()

console.log(`${direction} complete`, {
  applied: result.applied.map((entry) => entry.id),
  reverted: result.reverted.map((entry) => entry.id),
})
