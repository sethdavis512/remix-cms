import { rawSql } from 'remix/data-table'

import type { AppDatabase } from './db.ts'
import { entries, type EntryRow } from './schema.ts'
import { listContentTypes } from './content-types.server.ts'

export type EntryStatus = 'draft' | 'published'

// Clean shape returned to controllers and serialized by the API.
export interface Entry {
  id: number
  contentTypeId: number
  data: Record<string, unknown>
  locale: string
  status: EntryStatus
  publishedAt: number | null
  publishAt: number | null
  unpublishAt: number | null
  createdAt: number
  updatedAt: number
}

export function toEntry(row: EntryRow): Entry {
  let data: Record<string, unknown> = {}
  try {
    let parsed = JSON.parse(row.data)
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch {
    data = {}
  }

  return {
    id: row.id,
    contentTypeId: row.content_type_id,
    data,
    locale: row.locale,
    status: row.status === 'published' ? 'published' : 'draft',
    publishedAt: row.published_at ?? null,
    publishAt: row.publish_at ?? null,
    unpublishAt: row.unpublish_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// When `locale` is given, only entries in that locale are returned. Callers
// pass it for localized content types and omit it otherwise.
export async function listEntries(
  db: AppDatabase,
  contentTypeId: number,
  locale?: string,
): Promise<Entry[]> {
  let rows = await db.findMany(entries, {
    where: locale
      ? { content_type_id: contentTypeId, locale }
      : { content_type_id: contentTypeId },
    orderBy: ['created_at', 'desc'],
  })
  return rows.map(toEntry)
}

export async function listPublishedEntries(
  db: AppDatabase,
  contentTypeId: number,
  locale?: string,
): Promise<Entry[]> {
  let rows = await db.findMany(entries, {
    where: locale
      ? { content_type_id: contentTypeId, status: 'published', locale }
      : { content_type_id: contentTypeId, status: 'published' },
    orderBy: ['created_at', 'desc'],
  })
  return rows.map(toEntry)
}

export async function countEntriesInLocale(db: AppDatabase, locale: string): Promise<number> {
  let rows = await db.findMany(entries, { where: { locale } })
  return rows.length
}

export async function countEntriesForType(db: AppDatabase, contentTypeId: number): Promise<number> {
  let rows = await db.findMany(entries, { where: { content_type_id: contentTypeId } })
  return rows.length
}

export async function findEntry(db: AppDatabase, id: number): Promise<Entry | null> {
  let row = await db.find(entries, id)
  return row ? toEntry(row) : null
}

export async function findPublishedEntry(db: AppDatabase, id: number): Promise<Entry | null> {
  let row = await db.findOne(entries, { where: { id, status: 'published' } })
  return row ? toEntry(row) : null
}

export async function createEntry(
  db: AppDatabase,
  contentTypeId: number,
  data: Record<string, unknown>,
  locale: string,
): Promise<Entry> {
  let now = Date.now()
  let created = await db.create(
    entries,
    {
      content_type_id: contentTypeId,
      data: JSON.stringify(data),
      locale,
      status: 'draft',
      created_at: now,
      updated_at: now,
    },
    { returnRow: true },
  )
  return toEntry(created)
}

export async function updateEntryData(
  db: AppDatabase,
  id: number,
  data: Record<string, unknown>,
): Promise<Entry> {
  let updated = await db.update(entries, id, {
    data: JSON.stringify(data),
    updated_at: Date.now(),
  })
  return toEntry(updated)
}

export async function publishEntry(db: AppDatabase, id: number): Promise<Entry> {
  let now = Date.now()
  let updated = await db.update(entries, id, {
    status: 'published',
    published_at: now,
    updated_at: now,
  })
  return toEntry(updated)
}

export async function unpublishEntry(db: AppDatabase, id: number): Promise<Entry> {
  // status is the source of truth for published vs draft; the API filters on it.
  // published_at is left as-is (a nullable column can't be re-nulled through the
  // typed write API), which is harmless because drafts are never served.
  let updated = await db.update(entries, id, {
    status: 'draft',
    updated_at: Date.now(),
  })
  return toEntry(updated)
}

// Set (or clear, with null) an entry's publish/unpublish timers. Clearing a
// timer needs the column set back to NULL, which the typed write API cannot
// express, so this always goes through the raw escape hatch.
export async function setEntrySchedule(
  db: AppDatabase,
  id: number,
  input: { publishAt: number | null; unpublishAt: number | null },
): Promise<Entry> {
  await db.exec(
    rawSql('update entries set publish_at = ?, unpublish_at = ?, updated_at = ? where id = ?', [
      input.publishAt,
      input.unpublishAt,
      Date.now(),
      id,
    ]),
  )
  let row = await db.find(entries, id)
  if (!row) throw new Error(`Entry ${id} not found`)
  return toEntry(row)
}

export async function deleteEntry(db: AppDatabase, id: number): Promise<void> {
  await db.delete(entries, id)
}

// After an entry is deleted, remove any references to it held by relation
// fields on other entries (of any type): a single relation is set to null, a
// many-relation drops the id from its list. This is a full scan of every type
// that has a relation field — acceptable at current scale given generic JSON
// storage (you cannot query inside entry data). Only entries whose data changes
// are written back.
export async function nullifyRelationsToEntry(db: AppDatabase, deletedId: number): Promise<void> {
  let types = await listContentTypes(db)
  for (let type of types) {
    let relationFields = type.fields.filter((field) => field.type === 'relation')
    if (relationFields.length === 0) continue

    let rows = await listEntries(db, type.id)
    for (let entry of rows) {
      let data = { ...entry.data }
      let changed = false
      for (let field of relationFields) {
        let value = data[field.name]
        if (Array.isArray(value)) {
          let filtered = value.filter((id) => id !== deletedId)
          if (filtered.length !== value.length) {
            data[field.name] = filtered
            changed = true
          }
        } else if (value === deletedId) {
          data[field.name] = null
          changed = true
        }
      }
      if (changed) await updateEntryData(db, entry.id, data)
    }
  }
}
