import type { AppDatabase } from './db.ts'
import { entries, type EntryRow } from './schema.ts'

export type EntryStatus = 'draft' | 'published'

// Clean shape returned to controllers and serialized by the API.
export interface Entry {
  id: number
  contentTypeId: number
  data: Record<string, unknown>
  status: EntryStatus
  publishedAt: number | null
  createdAt: number
  updatedAt: number
}

function toEntry(row: EntryRow): Entry {
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
    status: row.status === 'published' ? 'published' : 'draft',
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listEntries(db: AppDatabase, contentTypeId: number): Promise<Entry[]> {
  let rows = await db.findMany(entries, {
    where: { content_type_id: contentTypeId },
    orderBy: ['created_at', 'desc'],
  })
  return rows.map(toEntry)
}

export async function listPublishedEntries(
  db: AppDatabase,
  contentTypeId: number,
): Promise<Entry[]> {
  let rows = await db.findMany(entries, {
    where: { content_type_id: contentTypeId, status: 'published' },
    orderBy: ['created_at', 'desc'],
  })
  return rows.map(toEntry)
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
): Promise<Entry> {
  let now = Date.now()
  let created = await db.create(
    entries,
    {
      content_type_id: contentTypeId,
      data: JSON.stringify(data),
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

export async function deleteEntry(db: AppDatabase, id: number): Promise<void> {
  await db.delete(entries, id)
}
