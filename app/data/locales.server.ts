import type { AppDatabase } from './db.ts'
import { locales, type LocaleRow } from './schema.ts'

// Clean shape returned to controllers (never the raw row). The default locale
// is seeded by the migration ('en') and cannot be changed or deleted.
export interface Locale {
  id: number
  code: string
  name: string
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

function toLocale(row: LocaleRow): Locale {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listLocales(db: AppDatabase): Promise<Locale[]> {
  let rows = await db.findMany(locales, { orderBy: ['code', 'asc'] })
  return rows.map(toLocale)
}

export async function findLocale(db: AppDatabase, id: number): Promise<Locale | null> {
  let row = await db.find(locales, id)
  return row ? toLocale(row) : null
}

export async function findLocaleByCode(db: AppDatabase, code: string): Promise<Locale | null> {
  let row = await db.findOne(locales, { where: { code } })
  return row ? toLocale(row) : null
}

// The migration guarantees exactly one default locale exists.
export async function getDefaultLocale(db: AppDatabase): Promise<Locale> {
  let row = await db.findOne(locales, { where: { is_default: 1 } })
  if (!row) throw new Error('No default locale found; run migrations.')
  return toLocale(row)
}

export async function createLocale(db: AppDatabase, code: string, name: string): Promise<Locale> {
  let now = Date.now()
  let created = await db.create(
    locales,
    { code, name, is_default: 0, created_at: now, updated_at: now },
    { returnRow: true },
  )
  return toLocale(created)
}

export async function deleteLocale(db: AppDatabase, id: number): Promise<void> {
  await db.delete(locales, id)
}
