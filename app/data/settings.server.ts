import { rawSql } from 'remix/data-table'

import type { AppDatabase } from './db.ts'
import { settings } from './schema.ts'

// Simple key/value application settings. Seeded by migration; read at the
// request boundary. The one setting so far is 'require_api_token', which gates
// the public read API independently of whether any tokens exist.

export const REQUIRE_API_TOKEN_KEY = 'require_api_token'

export async function getSetting(db: AppDatabase, key: string): Promise<string | null> {
  let row = await db.findOne(settings, { where: { key } })
  return row ? row.value : null
}

// Upsert a setting. A text primary key can't be re-inserted, so this uses an
// on-conflict update through the raw escape hatch.
export async function setSetting(db: AppDatabase, key: string, value: string): Promise<void> {
  await db.exec(
    rawSql('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = ?', [
      key,
      value,
      value,
    ]),
  )
}

// Whether the public read API currently requires a bearer token.
export async function isApiTokenRequired(db: AppDatabase): Promise<boolean> {
  return (await getSetting(db, REQUIRE_API_TOKEN_KEY)) === 'true'
}
