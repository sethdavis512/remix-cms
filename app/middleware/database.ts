import type { Middleware } from 'remix/router'
import { Database } from 'remix/data-table'

import type { AppDatabase } from '../data/db.ts'

// Injects the database instance into request context so controllers read it with
// `get(Database)`. The instance is passed in, which keeps tests isolated (they
// supply their own in-memory database).
export function loadDatabase(database: AppDatabase): Middleware<{
  key: typeof Database
  value: AppDatabase
  property: 'db'
}> {
  return async (context, next) => {
    context.set(Database, database, { property: 'db' })
    return next()
  }
}
