import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import * as s from 'remix/data-schema'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '../../../middleware/auth.ts'
import {
  findContentTypeByApiId,
  listContentTypes,
  type ContentType,
} from '../../../data/content-types.server.ts'
import {
  createEntry,
  deleteEntry,
  findEntry,
  listEntries,
  publishEntry,
  unpublishEntry,
  updateEntryData,
  type Entry,
} from '../../../data/entries.server.ts'
import { buildEntrySchema } from '../../../utils/field-schema.ts'
import type { FieldDef } from '../../../utils/fields.ts'
import { routes } from '../../../routes.ts'
import {
  AdminShell,
  cardStyle,
  dangerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../../ui/admin-shell.tsx'
import { FieldInput } from '../../../ui/form-fields.tsx'
import { ApiSnippets } from '../../../ui/api-snippets.tsx'

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

function notFound() {
  return new Response('Not Found', { status: 404 })
}

// Map validation issues to a { fieldName: message } record for inline display.
function issuesToErrors(issues: ReadonlyArray<{ path?: ReadonlyArray<unknown>; message: string }>) {
  let errors: Record<string, string> = {}
  for (let issue of issues) {
    let segment = issue.path?.[0]
    let key =
      segment && typeof segment === 'object' && 'key' in segment
        ? String((segment as { key: unknown }).key)
        : String(segment ?? '')
    if (key && !errors[key]) errors[key] = issue.message
  }
  return errors
}

export default createController(routes.admin.content, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByApiId(db, context.params.type)
      if (!contentType) return notFound()

      // Single types skip the list and go straight to their one entry.
      if (contentType.kind === 'single') {
        let entries = await listEntries(db, contentType.id)
        if (entries[0]) {
          return redirect(
            routes.admin.content.editForm.href({
              type: contentType.apiId,
              entryId: String(entries[0].id),
            }),
            303,
          )
        }
        return redirect(routes.admin.content.newForm.href({ type: contentType.apiId }), 303)
      }

      let entries = await listEntries(db, contentType.id)
      let session = context.get(Session)!
      let flash = session.get('message')

      // A concrete id for the "get a single entry" snippet: prefer a published
      // entry so the snippet returns data immediately, else any entry, else 1.
      let sampleId =
        entries.find((entry) => entry.status === 'published')?.id ?? entries[0]?.id ?? 1

      let allTypes = await listContentTypes(db)
      return context.render(
        <EntriesIndexPage
          contentType={contentType}
          entries={entries}
          contentTypes={allTypes}
          user={currentUser(context)}
          flash={typeof flash === 'string' ? flash : null}
          origin={context.url.origin}
          sampleId={sampleId}
        />,
      )
    },

    async newForm(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByApiId(db, context.params.type)
      if (!contentType) return notFound()

      let allTypes = await listContentTypes(db)
      return context.render(
        <EntryFormPage
          mode="new"
          contentType={contentType}
          contentTypes={allTypes}
          user={currentUser(context)}
          values={{}}
          errors={{}}
        />,
      )
    },

    async create(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByApiId(db, context.params.type)
      if (!contentType) return notFound()

      let formData = context.get(FormData)!
      let parsed = s.parseSafe(buildEntrySchema(contentType.fields), formData)

      if (!parsed.success) {
        let allTypes = await listContentTypes(db)
        return context.render(
          <EntryFormPage
            mode="new"
            contentType={contentType}
            contentTypes={allTypes}
            user={currentUser(context)}
            values={rawValues(formData, contentType.fields)}
            errors={issuesToErrors(parsed.issues)}
          />,
          { status: 400 },
        )
      }

      let entry = await createEntry(db, contentType.id, parsed.value as Record<string, unknown>)
      context.get(Session)!.flash('message', 'Entry created.')
      return redirect(
        routes.admin.content.editForm.href({ type: contentType.apiId, entryId: String(entry.id) }),
        303,
      )
    },

    async editForm(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByApiId(db, context.params.type)
      if (!contentType) return notFound()

      let entry = await findEntry(db, Number(context.params.entryId))
      if (!entry || entry.contentTypeId !== contentType.id) return notFound()

      let session = context.get(Session)!
      let flash = session.get('message')
      let allTypes = await listContentTypes(db)
      return context.render(
        <EntryFormPage
          mode="edit"
          contentType={contentType}
          entry={entry}
          contentTypes={allTypes}
          user={currentUser(context)}
          values={entry.data}
          errors={{}}
          flash={typeof flash === 'string' ? flash : null}
        />,
      )
    },

    async update(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByApiId(db, context.params.type)
      if (!contentType) return notFound()

      let entry = await findEntry(db, Number(context.params.entryId))
      if (!entry || entry.contentTypeId !== contentType.id) return notFound()

      let formData = context.get(FormData)!
      let parsed = s.parseSafe(buildEntrySchema(contentType.fields), formData)

      if (!parsed.success) {
        let allTypes = await listContentTypes(db)
        return context.render(
          <EntryFormPage
            mode="edit"
            contentType={contentType}
            entry={entry}
            contentTypes={allTypes}
            user={currentUser(context)}
            values={rawValues(formData, contentType.fields)}
            errors={issuesToErrors(parsed.issues)}
          />,
          { status: 400 },
        )
      }

      await updateEntryData(db, entry.id, parsed.value as Record<string, unknown>)
      context.get(Session)!.flash('message', 'Entry saved.')
      return redirect(
        routes.admin.content.editForm.href({ type: contentType.apiId, entryId: String(entry.id) }),
        303,
      )
    },

    async publish(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByApiId(db, context.params.type)
      if (!contentType) return notFound()

      let entry = await findEntry(db, Number(context.params.entryId))
      if (!entry || entry.contentTypeId !== contentType.id) return notFound()

      if (entry.status === 'published') {
        await unpublishEntry(db, entry.id)
        context.get(Session)!.flash('message', 'Entry unpublished.')
      } else {
        await publishEntry(db, entry.id)
        context.get(Session)!.flash('message', 'Entry published.')
      }

      return redirect(
        routes.admin.content.editForm.href({ type: contentType.apiId, entryId: String(entry.id) }),
        303,
      )
    },

    async destroy(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByApiId(db, context.params.type)
      if (!contentType) return notFound()

      let entry = await findEntry(db, Number(context.params.entryId))
      if (entry && entry.contentTypeId === contentType.id) {
        await deleteEntry(db, entry.id)
        context.get(Session)!.flash('message', 'Entry deleted.')
      }

      return redirect(routes.admin.content.index.href({ type: contentType.apiId }), 303)
    },
  },
})

// Read raw string values from FormData so the form can be re-rendered with the
// user's input after a validation error.
function rawValues(formData: FormData, fields: FieldDef[]): Record<string, unknown> {
  let values: Record<string, unknown> = {}
  for (let field of fields) {
    if (field.type === 'boolean') {
      values[field.name] = formData.get(field.name) != null
    } else {
      values[field.name] = formData.get(field.name) ?? ''
    }
  }
  return values
}

function entryLabel(entry: Entry, fields: FieldDef[]): string {
  let firstText = fields.find((f) => f.type === 'text' || f.type === 'email')
  if (firstText) {
    let value = entry.data[firstText.name]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return `Entry #${entry.id}`
}

// ----- Pages -----

interface IndexProps {
  contentType: ContentType
  entries: Entry[]
  contentTypes: ContentType[]
  user?: AuthUser
  flash?: string | null
  origin: string
  sampleId: number
}

function EntriesIndexPage(handle: Handle<IndexProps>) {
  return () => {
    let { contentType, entries, contentTypes, user, flash, origin, sampleId } = handle.props

    return (
      <AdminShell
        heading={contentType.name}
        activeNav="content"
        activeTypeApiId={contentType.apiId}
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        actions={
          <a
            href={routes.admin.content.newForm.href({ type: contentType.apiId })}
            mix={primaryButtonStyle}
          >
            New entry
          </a>
        }
      >
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          {entries.length === 0 ? (
            <div mix={cardStyle}>
              <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
                No entries yet. Create one to get started.
              </p>
            </div>
          ) : (
          <div mix={cardStyle}>
            <table mix={tableStyle}>
              <thead>
                <tr>
                  <th mix={thStyle}>Entry</th>
                  <th mix={thStyle}>Status</th>
                  <th mix={thStyle} />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr>
                    <td mix={tdStyle}>{entryLabel(entry, contentType.fields)}</td>
                    <td mix={tdStyle}>
                      <StatusBadge status={entry.status} />
                    </td>
                    <td mix={css({ padding: '12px', borderBottom: '1px solid var(--border)', textAlign: 'right' })}>
                      <a
                        href={routes.admin.content.editForm.href({
                          type: contentType.apiId,
                          entryId: String(entry.id),
                        })}
                        mix={secondaryButtonStyle}
                      >
                        Edit
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          <ApiSnippets
            origin={origin}
            apiIdPlural={contentType.apiIdPlural}
            sampleId={sampleId}
          />
        </div>
      </AdminShell>
    )
  }
}

interface FormProps {
  mode: 'new' | 'edit'
  contentType: ContentType
  entry?: Entry
  contentTypes: ContentType[]
  user?: AuthUser
  values: Record<string, unknown>
  errors: Record<string, string>
  flash?: string | null
}

function EntryFormPage(handle: Handle<FormProps>) {
  return () => {
    let { mode, contentType, entry, contentTypes, user, values, errors, flash } = handle.props

    let actionHref =
      mode === 'edit' && entry
        ? routes.admin.content.update.href({ type: contentType.apiId, entryId: String(entry.id) })
        : routes.admin.content.create.href({ type: contentType.apiId })

    return (
      <AdminShell
        heading={mode === 'edit' ? `Edit ${contentType.name}` : `New ${contentType.name}`}
        activeNav="content"
        activeTypeApiId={contentType.apiId}
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        actions={
          entry ? (
            <span mix={css({ display: 'flex', gap: '10px', alignItems: 'center' })}>
              <StatusBadge status={entry.status} />
              <form
                method="POST"
                action={routes.admin.content.publish.href({
                  type: contentType.apiId,
                  entryId: String(entry.id),
                })}
              >
                <button type="submit" mix={primaryButtonStyle}>
                  {entry.status === 'published' ? 'Unpublish' : 'Publish'}
                </button>
              </form>
            </span>
          ) : undefined
        }
      >
        {contentType.fields.length === 0 ? (
          <div mix={cardStyle}>
            <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
              This content type has no fields yet. Add fields in the{' '}
              <a href={routes.admin.types.editForm.href({ typeId: String(contentType.id) })}>
                Content-Type Builder
              </a>
              .
            </p>
          </div>
        ) : (
          <form method="POST" action={actionHref} mix={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}>
            <div mix={[cardStyle, css({ display: 'flex', flexDirection: 'column', gap: '18px' })]}>
              {contentType.fields.map((field) => (
                <FieldInput field={field} value={values[field.name]} error={errors[field.name]} />
              ))}
            </div>

            <div mix={css({ display: 'flex', gap: '10px' })}>
              <button type="submit" mix={primaryButtonStyle}>
                {mode === 'edit' ? 'Save entry' : 'Create entry'}
              </button>
              <a href={routes.admin.content.index.href({ type: contentType.apiId })} mix={secondaryButtonStyle}>
                Cancel
              </a>
              {entry ? (
                <form
                  method="POST"
                  action={routes.admin.content.destroy.href({
                    type: contentType.apiId,
                    entryId: String(entry.id),
                  })}
                  mix={css({ marginLeft: 'auto' })}
                >
                  <button type="submit" mix={dangerButtonStyle}>
                    Delete entry
                  </button>
                </form>
              ) : null}
            </div>
          </form>
        )}
      </AdminShell>
    )
  }
}

function StatusBadge(handle: Handle<{ status: 'draft' | 'published' }>) {
  return () => {
    let published = handle.props.status === 'published'
    return (
      <span
        mix={css({
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 10px',
          borderRadius: '999px',
          fontSize: '12px',
          fontWeight: 600,
          color: published ? 'var(--success)' : 'var(--text-tertiary)',
          background: published ? 'rgba(48, 164, 108, 0.14)' : 'var(--surface-2)',
        })}
      >
        {published ? 'Published' : 'Draft'}
      </span>
    )
  }
}

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
