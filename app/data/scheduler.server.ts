import { rawSql } from 'remix/data-table'

import type { AppDatabase } from './db.ts'
import { entries } from './schema.ts'
import { findContentType } from './content-types.server.ts'
import { toEntry, type Entry } from './entries.server.ts'
import { runDueReleases, type Release } from './releases.server.ts'
import { dispatchEntryEvent, entryEventPayload } from './webhooks.server.ts'
import { logAudit } from './audit.server.ts'
import { entryLabel } from '../utils/fields.ts'

// Everything time-driven in one place: due releases plus per-entry
// publish_at / unpublish_at timers. Called from the 60s timer in server.ts and
// lazily before public API reads, so scheduled content flips on time whether
// or not the process has been running continuously.

export interface ScheduledWorkResult {
  releases: Release[]
  publishedEntries: Entry[]
  unpublishedEntries: Entry[]
}

export async function runScheduledWork(db: AppDatabase): Promise<ScheduledWorkResult> {
  let releases = await runDueReleases(db)
  let now = Date.now()

  // Drafts whose publish time has passed go live; the fired timer is cleared
  // so it never re-triggers (clearing needs NULL, hence rawSql).
  let publishedEntries: Entry[] = []
  let draftRows = await db.findMany(entries, { where: { status: 'draft' } })
  for (let row of draftRows) {
    if (row.publish_at == null || row.publish_at > now) continue
    await db.exec(
      rawSql(
        'update entries set status = ?, published_at = ?, publish_at = null, updated_at = ? where id = ?',
        ['published', now, now, row.id],
      ),
    )
    let updated = await db.find(entries, row.id)
    if (updated) publishedEntries.push(toEntry(updated))
  }

  // Published entries whose unpublish time has passed go back to draft.
  let unpublishedEntries: Entry[] = []
  let publishedRows = await db.findMany(entries, { where: { status: 'published' } })
  for (let row of publishedRows) {
    if (row.unpublish_at == null || row.unpublish_at > now) continue
    await db.exec(
      rawSql(
        'update entries set status = ?, unpublish_at = null, updated_at = ? where id = ?',
        ['draft', now, row.id],
      ),
    )
    let updated = await db.find(entries, row.id)
    if (updated) unpublishedEntries.push(toEntry(updated))
  }

  // Timer-driven transitions are automatic, so they are audited as 'system'.
  for (let entry of publishedEntries) {
    let contentType = await findContentType(db, entry.contentTypeId)
    if (!contentType) continue
    await dispatchEntryEvent(db, 'entry.published', entryEventPayload(entry, contentType.apiId))
    await logAudit(
      db,
      'system',
      'entry.published',
      'entry',
      entry.id,
      `Published "${entryLabel(entry.id, entry.data, contentType.fields)}" (${contentType.name}) on schedule`,
    )
  }
  for (let entry of unpublishedEntries) {
    let contentType = await findContentType(db, entry.contentTypeId)
    if (!contentType) continue
    await dispatchEntryEvent(db, 'entry.unpublished', entryEventPayload(entry, contentType.apiId))
    await logAudit(
      db,
      'system',
      'entry.unpublished',
      'entry',
      entry.id,
      `Unpublished "${entryLabel(entry.id, entry.data, contentType.fields)}" (${contentType.name}) on schedule`,
    )
  }

  return { releases, publishedEntries, unpublishedEntries }
}
