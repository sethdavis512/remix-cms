import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '../../../middleware/auth.ts'
import {
  createContentType,
  deleteContentType,
  findContentType,
  findContentTypeByApiId,
  listContentTypes,
  updateContentType,
  type ContentType,
} from '../../../data/content-types.server.ts'
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  parseFieldDefs,
  pluralize,
  slugify,
  type FieldDef,
} from '../../../utils/fields.ts'
import { routes } from '../../../routes.ts'
import {
  AdminShell,
  cardStyle,
  dangerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../../ui/admin-shell.tsx'

const BLANK_ROWS = 3

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

export default createController(routes.admin.types, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let contentTypes = await listContentTypes(db)
      return context.render(
        <TypesIndexPage contentTypes={contentTypes} user={currentUser(context)} />,
      )
    },

    async newForm(context) {
      let db = context.get(Database)!
      let contentTypes = await listContentTypes(db)
      return context.render(<BuilderPage mode="new" contentTypes={contentTypes} user={currentUser(context)} />)
    },

    async create(context) {
      let db = context.get(Database)!
      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim()
      let kind: 'collection' | 'single' =
        String(formData.get('kind') ?? 'collection') === 'single' ? 'single' : 'collection'
      let fields = parseFieldDefs(formData)
      let apiId = slugify(name)

      let contentTypes = await listContentTypes(db)

      let error = await validateType(db, { name, apiId })
      if (error) {
        return context.render(
          <BuilderPage
            mode="new"
            contentTypes={contentTypes}
            user={currentUser(context)}
            name={name}
            kind={kind}
            fields={fields}
            error={error}
          />,
          { status: 400 },
        )
      }

      await createContentType(db, {
        name,
        apiId,
        apiIdPlural: pluralize(apiId),
        kind,
        fields,
      })

      return redirect(routes.admin.types.index.href(), 303)
    },

    async editForm(context) {
      let db = context.get(Database)!
      let id = Number(context.params.typeId)
      if (!Number.isInteger(id)) return new Response('Not Found', { status: 404 })

      let contentType = await findContentType(db, id)
      if (!contentType) return new Response('Not Found', { status: 404 })

      let contentTypes = await listContentTypes(db)
      return context.render(
        <BuilderPage
          mode="edit"
          contentType={contentType}
          contentTypes={contentTypes}
          user={currentUser(context)}
          name={contentType.name}
          kind={contentType.kind}
          fields={contentType.fields}
        />,
      )
    },

    async update(context) {
      let db = context.get(Database)!
      let id = Number(context.params.typeId)
      if (!Number.isInteger(id)) return new Response('Not Found', { status: 404 })

      let contentType = await findContentType(db, id)
      if (!contentType) return new Response('Not Found', { status: 404 })

      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim()
      let kind: 'collection' | 'single' =
        String(formData.get('kind') ?? 'collection') === 'single' ? 'single' : 'collection'
      let fields = parseFieldDefs(formData)
      let apiId = slugify(name)

      let contentTypes = await listContentTypes(db)

      let error = await validateType(db, { name, apiId, ignoreId: id })
      if (error) {
        return context.render(
          <BuilderPage
            mode="edit"
            contentType={contentType}
            contentTypes={contentTypes}
            user={currentUser(context)}
            name={name}
            kind={kind}
            fields={fields}
            error={error}
          />,
          { status: 400 },
        )
      }

      await updateContentType(db, id, {
        name,
        apiId,
        apiIdPlural: pluralize(apiId),
        kind,
        fields,
      })

      return redirect(routes.admin.types.index.href(), 303)
    },

    async destroy(context) {
      let db = context.get(Database)!
      let id = Number(context.params.typeId)
      if (Number.isInteger(id)) await deleteContentType(db, id)
      return redirect(routes.admin.types.index.href(), 303)
    },
  },
})

async function validateType(
  db: import('../../../data/db.ts').AppDatabase,
  input: { name: string; apiId: string; ignoreId?: number },
): Promise<string | null> {
  if (input.name === '') return 'Name is required.'
  if (input.apiId === '') return 'Name must contain at least one letter or number.'

  let existing = await findContentTypeByApiId(db, input.apiId)
  if (existing && existing.id !== input.ignoreId) {
    return `A content type with the api id "${input.apiId}" already exists.`
  }
  return null
}

// ----- Pages -----

function TypesIndexPage(handle: Handle<{ contentTypes: ContentType[]; user?: AuthUser }>) {
  return () => {
    let { contentTypes, user } = handle.props

    return (
      <AdminShell
        heading="Content-Type Builder"
        activeNav="types"
        contentTypes={contentTypes}
        user={user}
        actions={
          <a href={routes.admin.types.newForm.href()} mix={primaryButtonStyle}>
            New content type
          </a>
        }
      >
        {contentTypes.length === 0 ? (
          <div mix={cardStyle}>
            <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
              No content types yet. Create one to get started.
            </p>
          </div>
        ) : (
          <div mix={cardStyle}>
            <table mix={tableStyle}>
              <thead>
                <tr>
                  <th mix={thStyle}>Name</th>
                  <th mix={thStyle}>API ID</th>
                  <th mix={thStyle}>Fields</th>
                  <th mix={thStyle}>Kind</th>
                  <th mix={thStyle} />
                </tr>
              </thead>
              <tbody>
                {contentTypes.map((type) => (
                  <tr>
                    <td mix={tdStyle}>{type.name}</td>
                    <td mix={tdMonoStyle}>{type.apiId}</td>
                    <td mix={tdStyle}>{type.fields.length}</td>
                    <td mix={tdStyle}>{type.kind}</td>
                    <td mix={tdActionsStyle}>
                      <a
                        href={routes.admin.content.index.href({ type: type.apiId })}
                        mix={secondaryButtonStyle}
                      >
                        Entries
                      </a>
                      <a href={routes.admin.types.editForm.href({ typeId: String(type.id) })} mix={secondaryButtonStyle}>
                        Edit
                      </a>
                      <form
                        method="POST"
                        action={routes.admin.types.destroy.href({ typeId: String(type.id) })}
                      >
                        <button type="submit" mix={dangerButtonStyle}>
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminShell>
    )
  }
}

interface BuilderPageProps {
  mode: 'new' | 'edit'
  contentType?: ContentType
  contentTypes: ContentType[]
  user?: AuthUser
  name?: string
  kind?: 'collection' | 'single'
  fields?: FieldDef[]
  error?: string
}

function BuilderPage(handle: Handle<BuilderPageProps>) {
  return () => {
    let { mode, contentType, contentTypes, user, name = '', kind = 'collection', fields = [], error } =
      handle.props

    let actionHref =
      mode === 'edit' && contentType
        ? routes.admin.types.update.href({ typeId: String(contentType.id) })
        : routes.admin.types.create.href()

    let rows: (FieldDef | null)[] = [...fields]
    for (let i = 0; i < BLANK_ROWS; i++) rows.push(null)

    return (
      <AdminShell
        heading={mode === 'edit' ? `Edit ${contentType?.name ?? 'content type'}` : 'New content type'}
        activeNav="types"
        contentTypes={contentTypes}
        user={user}
      >
        <form method="POST" action={actionHref} mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          {error ? <p mix={formErrorStyle}>{error}</p> : null}

          <div mix={cardStyle}>
            <div mix={css({ display: 'flex', gap: '16px', flexWrap: 'wrap' })}>
              <label mix={[fieldLabelStyle, css({ flex: '2 1 220px' })]}>
                <span>Display name</span>
                <input type="text" name="name" value={name} placeholder="e.g. Article" mix={inputStyle} />
              </label>
              <label mix={[fieldLabelStyle, css({ flex: '1 1 160px' })]}>
                <span>Kind</span>
                <select name="kind" mix={inputStyle}>
                  <option value="collection" selected={kind === 'collection'}>
                    Collection
                  </option>
                  <option value="single" selected={kind === 'single'}>
                    Single
                  </option>
                </select>
              </label>
            </div>
          </div>

          <div mix={cardStyle}>
            <h2 mix={css({ margin: '0 0 4px', fontSize: '15px' })}>Fields</h2>
            <p mix={css({ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-tertiary)' })}>
              Leave a row's name blank to skip it. Save and re-open to add more rows.
            </p>

            <div mix={rowHeaderStyle}>
              <span>Name</span>
              <span>Label</span>
              <span>Type</span>
              <span>Required</span>
              <span>Unique</span>
              <span>Options (comma-separated)</span>
            </div>

            {rows.map((field) => (
              <FieldRow field={field} />
            ))}
          </div>

          <div mix={css({ display: 'flex', gap: '10px' })}>
            <button type="submit" mix={primaryButtonStyle}>
              {mode === 'edit' ? 'Save changes' : 'Create content type'}
            </button>
            <a href={routes.admin.types.index.href()} mix={secondaryButtonStyle}>
              Cancel
            </a>
          </div>
        </form>
      </AdminShell>
    )
  }
}

function FieldRow(handle: Handle<{ field: FieldDef | null }>) {
  return () => {
    let field = handle.props.field

    return (
      <div mix={rowStyle}>
        <input type="text" name="field_name" value={field?.name ?? ''} placeholder="title" mix={cellInputStyle} />
        <input type="text" name="field_label" value={field?.label ?? ''} placeholder="Title" mix={cellInputStyle} />
        <select name="field_type" mix={cellInputStyle}>
          {FIELD_TYPES.map((type) => (
            <option value={type} selected={field?.type === type}>
              {FIELD_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <YesNoSelect name="field_required" value={field?.required ?? false} />
        <YesNoSelect name="field_unique" value={field?.unique ?? false} />
        <input
          type="text"
          name="field_options"
          value={field?.options.join(', ') ?? ''}
          placeholder="draft, published"
          mix={cellInputStyle}
        />
      </div>
    )
  }
}

function YesNoSelect(handle: Handle<{ name: string; value: boolean }>) {
  return () => {
    let { name, value } = handle.props
    return (
      <select name={name} mix={cellInputStyle}>
        <option value="no" selected={!value}>
          No
        </option>
        <option value="yes" selected={value}>
          Yes
        </option>
      </select>
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
const tdActionsStyle = css({
  padding: '12px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  gap: '8px',
  justifyContent: 'flex-end',
  alignItems: 'center',
})

const fieldLabelStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 600,
})

const inputStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '14px',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  width: '100%',
})

const rowHeaderStyle = css({
  display: 'grid',
  gridTemplateColumns: '1.2fr 1.2fr 1fr 0.8fr 0.8fr 1.5fr',
  gap: '8px',
  padding: '0 2px 6px',
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--text-tertiary)',
  '@media (max-width: 860px)': { display: 'none' },
})

const rowStyle = css({
  display: 'grid',
  gridTemplateColumns: '1.2fr 1.2fr 1fr 0.8fr 0.8fr 1.5fr',
  gap: '8px',
  marginBottom: '8px',
  '@media (max-width: 860px)': { gridTemplateColumns: '1fr 1fr' },
})

const cellInputStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '13px',
  padding: '8px 10px',
  borderRadius: '7px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  width: '100%',
})

const formErrorStyle = css({
  margin: 0,
  padding: '12px 16px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--danger)',
  background: 'var(--danger-soft)',
  border: '1px solid var(--danger)',
})
