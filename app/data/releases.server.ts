import { rawSql } from 'remix/data-table'
import { and, eq, inList } from 'remix/data-table/operators'

import type { AppDatabase } from './db.ts'
import { entries, releaseItems, releases, type ReleaseItemRow, type ReleaseRow } from './schema.ts'
import { findEntry, type Entry } from './entries.server.ts'
import { findContentType } from './content-types.server.ts'
import { logAudit } from './audit.server.ts'
import { entryLabel } from '../utils/fields.ts'

// Sanity-style content releases: a named group of publish/unpublish actions on
// entries that fires as one unit, either on a schedule (scheduled_at) or
// manually ("publish now"). Entries staged for publish stay drafts (invisible
// to the public API) until the release fires.

export type ReleaseStatus = 'open' | 'published'
export type ReleaseAction = 'publish' | 'unpublish'

export interface Release {
  id: number
  name: string
  status: ReleaseStatus
  scheduledAt: number | null
  publishedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ReleaseItem {
  id: number
  releaseId: number
  entryId: number
  action: ReleaseAction
  createdAt: number
}

function toRelease(row: ReleaseRow): Release {
  return {
    id: row.id,
    name: row.name,
    status: row.status === 'published' ? 'published' : 'open',
    scheduledAt: row.scheduled_at ?? null,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toReleaseItem(row: ReleaseItemRow): ReleaseItem {
  return {
    id: row.id,
    releaseId: row.release_id,
    entryId: row.entry_id,
    action: row.action === 'unpublish' ? 'unpublish' : 'publish',
    createdAt: row.created_at,
  }
}

export async function listReleases(db: AppDatabase): Promise<Release[]> {
  let rows = await db.findMany(releases, { orderBy: ['created_at', 'desc'] })
  return rows.map(toRelease)
}

export async function listOpenReleases(db: AppDatabase): Promise<Release[]> {
  let rows = await db.findMany(releases, {
    where: { status: 'open' },
    orderBy: ['created_at', 'desc'],
  })
  return rows.map(toRelease)
}

export async function findRelease(db: AppDatabase, id: number): Promise<Release | null> {
  let row = await db.find(releases, id)
  return row ? toRelease(row) : null
}

export async function createRelease(
  db: AppDatabase,
  name: string,
  scheduledAt: number | null,
): Promise<Release> {
  let now = Date.now()
  let created = await db.create(
    releases,
    {
      name,
      status: 'open',
      scheduled_at: scheduledAt ?? undefined,
      created_at: now,
      updated_at: now,
    },
    { returnRow: true },
  )
  return toRelease(created)
}

export async function updateRelease(
  db: AppDatabase,
  id: number,
  input: { name: string; scheduledAt: number | null },
): Promise<Release> {
  if (input.scheduledAt == null) {
    // Unscheduling needs scheduled_at set back to NULL, which the typed write
    // API can't express; use the raw escape hatch.
    await db.exec(
      rawSql('update releases set name = ?, scheduled_at = null, updated_at = ? where id = ?', [
        input.name,
        Date.now(),
        id,
      ]),
    )
    let row = await db.find(releases, id)
    if (!row) throw new Error(`Release ${id} not found`)
    return toRelease(row)
  }

  let updated = await db.update(releases, id, {
    name: input.name,
    scheduled_at: input.scheduledAt,
    updated_at: Date.now(),
  })
  return toRelease(updated)
}

export async function deleteRelease(db: AppDatabase, id: number): Promise<void> {
  await db.delete(releases, id)
}

export async function listReleaseItems(db: AppDatabase, releaseId: number): Promise<ReleaseItem[]> {
  let rows = await db.findMany(releaseItems, {
    where: { release_id: releaseId },
    orderBy: ['created_at', 'asc'],
  })
  return rows.map(toReleaseItem)
}

// Releases an entry belongs to (for the entry edit page). Only open releases
// matter there, so published ones are filtered out.
export async function listOpenReleasesForEntry(
  db: AppDatabase,
  entryId: number,
): Promise<Release[]> {
  let items = await db.findMany(releaseItems, { where: { entry_id: entryId } })
  if (items.length === 0) return []
  let rows = await db.findMany(releases, {
    where: and(inList('id', items.map((item) => item.release_id)), eq('status', 'open')),
  })
  return rows.map(toRelease)
}

export async function addReleaseItem(
  db: AppDatabase,
  releaseId: number,
  entryId: number,
  action: ReleaseAction,
): Promise<ReleaseItem | null> {
  let existing = await db.findOne(releaseItems, {
    where: { release_id: releaseId, entry_id: entryId },
  })
  if (existing) return null

  let created = await db.create(
    releaseItems,
    { release_id: releaseId, entry_id: entryId, action, created_at: Date.now() },
    { returnRow: true },
  )
  return toReleaseItem(created)
}

export async function removeReleaseItem(db: AppDatabase, itemId: number): Promise<void> {
  await db.delete(releaseItems, itemId)
}

export async function countReleaseItems(db: AppDatabase, releaseId: number): Promise<number> {
  let rows = await db.findMany(releaseItems, { where: { release_id: releaseId } })
  return rows.length
}

// Fire a release: apply every item's action and mark the release published,
// all in one transaction so a release never half-publishes.
export async function publishRelease(db: AppDatabase, releaseId: number): Promise<void> {
  let now = Date.now()
  let items: ReleaseItemRow[] = []
  await db.transaction(async (tx) => {
    items = await tx.findMany(releaseItems, { where: { release_id: releaseId } })
    for (let item of items) {
      if (item.action === 'unpublish') {
        await tx.update(entries, item.entry_id, { status: 'draft', updated_at: now })
      } else {
        await tx.update(entries, item.entry_id, {
          status: 'published',
          published_at: now,
          updated_at: now,
        })
      }
    }
    await tx.update(releases, releaseId, { status: 'published', published_at: now, updated_at: now })
  })

  // Record audit entries only after the transaction has committed. The entry
  // transitions a release performs are automatic, so they are logged as 'system'
  // regardless of who (if anyone) triggered the release.
  for (let item of items) {
    let entry = await findEntry(db, item.entry_id)
    if (!entry) continue
    let contentType = await findContentType(db, entry.contentTypeId)
    if (!contentType) continue
    let unpublish = item.action === 'unpublish'
    await logAudit(
      db,
      'system',
      unpublish ? 'entry.unpublished' : 'entry.published',
      'entry',
      entry.id,
      `${unpublish ? 'Unpublished' : 'Published'} "${entryLabel(entry.id, entry.data, contentType.fields)}" (${contentType.name}) via release`,
    )
  }
}

// Publish every open release whose scheduled time has passed. Called from a
// timer in server.ts and lazily before public API reads, so scheduled content
// goes live on time whether or not the process has been running continuously.
export async function runDueReleases(db: AppDatabase): Promise<Release[]> {
  let rows = await db.findMany(releases, {
    where: { status: 'open' },
    orderBy: ['scheduled_at', 'asc'],
  })
  let now = Date.now()
  let due = rows.filter((row) => row.scheduled_at != null && row.scheduled_at <= now)
  for (let row of due) {
    await publishRelease(db, row.id)
  }
  return due.map(toRelease)
}

// Entries referenced by a release's items, keyed by entry id (for display).
export async function entriesForReleaseItems(
  db: AppDatabase,
  items: ReleaseItem[],
): Promise<Map<number, Entry>> {
  let map = new Map<number, Entry>()
  if (items.length === 0) return map
  for (let item of items) {
    let entry = await findEntry(db, item.entryId)
    if (entry) map.set(entry.id, entry)
  }
  return map
}
