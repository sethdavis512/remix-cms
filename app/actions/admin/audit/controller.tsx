import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '../../../middleware/auth.ts'
import { listContentTypes, type ContentType } from '../../../data/content-types.server.ts'
import { listAuditEntries, type AuditEntry } from '../../../data/audit.server.ts'
import { routes } from '../../../routes.ts'
import { AdminShell, cardStyle } from '../../../ui/admin-shell.tsx'

// Read-only audit trail. Every mutating admin action calls logAudit; automatic
// (scheduler / due release) transitions are recorded with the actor 'system'.
// This page lists the latest 200 entries newest first, with no pagination.

const AUDIT_LIMIT = 200

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default createController(routes.admin.audit, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      return context.render(
        <AuditPage
          entries={await listAuditEntries(db, AUDIT_LIMIT)}
          contentTypes={await listContentTypes(db)}
          user={currentUser(context)}
        />,
      )
    },
  },
})

// ----- Pages -----

interface AuditPageProps {
  entries: AuditEntry[]
  contentTypes: ContentType[]
  user?: AuthUser
}

function AuditPage(handle: Handle<AuditPageProps>) {
  return () => {
    let { entries, contentTypes, user } = handle.props

    return (
      <AdminShell heading="Audit log" activeNav="audit" contentTypes={contentTypes} user={user}>
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          {entries.length === 0 ? (
            <div mix={cardStyle}>
              <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
                No activity recorded yet. Admin changes will appear here.
              </p>
            </div>
          ) : (
            <div mix={cardStyle}>
              <table mix={tableStyle}>
                <thead>
                  <tr>
                    <th mix={thStyle}>When</th>
                    <th mix={thStyle}>Actor</th>
                    <th mix={thStyle}>Action</th>
                    <th mix={thStyle}>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr>
                      <td mix={tdStyle}>{formatWhen(entry.createdAt)}</td>
                      <td mix={tdStyle}>{entry.actorEmail}</td>
                      <td mix={tdMonoStyle}>{entry.action}</td>
                      <td mix={tdStyle}>{entry.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p mix={css({ margin: 0, fontSize: '13px', color: 'var(--text-tertiary)' })}>
            Showing the most recent {AUDIT_LIMIT} entries, newest first.
          </p>
        </div>
      </AdminShell>
    )
  }
}

// ----- Styles -----

const tableStyle = css({ width: '100%', borderCollapse: 'collapse', fontSize: '14px' })
const thStyle = css({
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-tertiary)',
  borderBottom: '1px solid var(--border)',
})
const tdStyle = css({ padding: '12px', borderBottom: '1px solid var(--border)' })
const tdMonoStyle = css({
  padding: '12px',
  borderBottom: '1px solid var(--border)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: '13px',
  color: 'var(--text-tertiary)',
})
