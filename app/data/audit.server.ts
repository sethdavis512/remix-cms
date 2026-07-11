import type { AppDatabase } from './db.ts'
import { auditLog, type AuditLogRow } from './schema.ts'

// Append-only audit trail of admin mutations: who did what to which subject and
// when. Rows are written by `logAudit` from every mutating admin action (and by
// automatic transitions with the actor 'system'); the read-only /admin/audit
// page lists the most recent ones via `listAuditEntries`.

export interface AuditEntry {
  id: number
  actorEmail: string
  action: string
  subjectType: string
  subjectId: number | null
  summary: string
  createdAt: number
}

function toAuditEntry(row: AuditLogRow): AuditEntry {
  return {
    id: row.id,
    actorEmail: row.actor_email,
    action: row.action,
    subjectType: row.subject_type,
    subjectId: row.subject_id ?? null,
    summary: row.summary,
    createdAt: row.created_at,
  }
}

// Record one admin mutation. Auditing must never break the action it records,
// so every failure is swallowed after a console.error. Pass 'system' as the
// actor for automatic (scheduler / due release) transitions.
export async function logAudit(
  db: AppDatabase,
  actorEmail: string,
  action: string,
  subjectType: string,
  subjectId: number | null,
  summary: string,
): Promise<void> {
  try {
    await db.create(auditLog, {
      actor_email: actorEmail,
      action,
      subject_type: subjectType,
      // A nullable column is left NULL by omitting it on insert.
      subject_id: subjectId ?? undefined,
      summary,
      created_at: Date.now(),
    })
  } catch (error) {
    console.error('Failed to write audit log entry', error)
  }
}

export async function listAuditEntries(db: AppDatabase, limit = 200): Promise<AuditEntry[]> {
  let rows = await db.findMany(auditLog, { orderBy: ['created_at', 'desc'], limit })
  return rows.map(toAuditEntry)
}
