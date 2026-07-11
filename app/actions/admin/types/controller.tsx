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
import { listComponents, type Component } from '../../../data/components.server.ts'
import { countEntriesForType } from '../../../data/entries.server.ts'
import { logAudit } from '../../../data/audit.server.ts'
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  parseFieldDefs,
  pluralize,
  slugify,
  type FieldDef,
  type FieldType,
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
      return context.render(
        <BuilderPage
          mode="new"
          contentTypes={contentTypes}
          components={await listComponents(db)}
          user={currentUser(context)}
        />,
      )
    },

    async create(context) {
      let db = context.get(Database)!
      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim()
      let kind: 'collection' | 'single' =
        String(formData.get('kind') ?? 'collection') === 'single' ? 'single' : 'collection'
      let localized = String(formData.get('localized') ?? 'no') === 'yes'
      let fields = parseFieldDefs(formData, { allowComponent: true })
      let apiId = slugify(name)

      let contentTypes = await listContentTypes(db)
      let components = await listComponents(db)

      let error = (await validateType(db, { name, apiId })) ?? validateFields(fields, components)
      if (error) {
        return context.render(
          <BuilderPage
            mode="new"
            contentTypes={contentTypes}
            components={components}
            user={currentUser(context)}
            name={name}
            kind={kind}
            localized={localized}
            fields={fields}
            error={error}
          />,
          { status: 400 },
        )
      }

      let created = await createContentType(db, {
        name,
        apiId,
        apiIdPlural: pluralize(apiId),
        kind,
        localized,
        fields,
      })
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'content_type.created',
        'content_type',
        created.id,
        `Created content type "${created.name}"`,
      )

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
          components={await listComponents(db)}
          user={currentUser(context)}
          name={contentType.name}
          kind={contentType.kind}
          localized={contentType.localized}
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
      let localized = String(formData.get('localized') ?? 'no') === 'yes'
      let fields = parseFieldDefs(formData, { allowComponent: true })
      let apiId = slugify(name)

      let contentTypes = await listContentTypes(db)
      let components = await listComponents(db)

      let error =
        (await validateType(db, { name, apiId, ignoreId: id })) ??
        validateFields(fields, components)
      if (error) {
        return context.render(
          <BuilderPage
            mode="edit"
            contentType={contentType}
            contentTypes={contentTypes}
            components={components}
            user={currentUser(context)}
            name={name}
            kind={kind}
            localized={localized}
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
        localized,
        fields,
      })
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'content_type.updated',
        'content_type',
        id,
        `Updated content type "${name}"`,
      )

      return redirect(routes.admin.types.index.href(), 303)
    },

    // Confirmation page for deletion, which cascades every entry of the type.
    async confirmDestroy(context) {
      let db = context.get(Database)!
      let id = Number(context.params.typeId)
      if (!Number.isInteger(id)) return new Response('Not Found', { status: 404 })

      let contentType = await findContentType(db, id)
      if (!contentType) return new Response('Not Found', { status: 404 })

      let contentTypes = await listContentTypes(db)
      return context.render(
        <ConfirmDeletePage
          contentType={contentType}
          entryCount={await countEntriesForType(db, contentType.id)}
          contentTypes={contentTypes}
          user={currentUser(context)}
        />,
      )
    },

    async destroy(context) {
      let db = context.get(Database)!
      let id = Number(context.params.typeId)
      let contentType = Number.isInteger(id) ? await findContentType(db, id) : null
      if (contentType) {
        await deleteContentType(db, contentType.id)
        await logAudit(
          db,
          currentUser(context)?.email ?? 'system',
          'content_type.deleted',
          'content_type',
          contentType.id,
          `Deleted content type "${contentType.name}"`,
        )
      }
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

// Component fields must point at an existing component.
function validateFields(fields: FieldDef[], components: Component[]): string | null {
  for (let field of fields) {
    if (field.type !== 'component') continue
    if (!field.component) {
      return `Field "${field.label}" must select a component.`
    }
    if (!components.some((component) => component.apiId === field.component)) {
      return `Field "${field.label}" references an unknown component.`
    }
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
                      <a
                        href={routes.admin.types.confirmDestroy.href({ typeId: String(type.id) })}
                        mix={dangerButtonStyle}
                      >
                        Delete
                      </a>
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

function ConfirmDeletePage(
  handle: Handle<{
    contentType: ContentType
    entryCount: number
    contentTypes: ContentType[]
    user?: AuthUser
  }>,
) {
  return () => {
    let { contentType, entryCount, contentTypes, user } = handle.props

    return (
      <AdminShell
        heading={`Delete ${contentType.name}`}
        activeNav="types"
        contentTypes={contentTypes}
        user={user}
      >
        <div mix={cardStyle}>
          <h2 mix={css({ margin: '0 0 12px', fontSize: '16px' })}>
            Delete "{contentType.name}"?
          </h2>
          <p mix={css({ margin: '0 0 12px', fontSize: '14px' })}>
            This permanently deletes the content type and cascades to all of its content.
            This cannot be undone.
          </p>
          <p mix={warningStyle}>
            {entryCount === 0
              ? 'This content type has no entries.'
              : entryCount === 1
                ? '1 entry will be permanently deleted along with it.'
                : `${entryCount} entries will be permanently deleted along with it.`}
          </p>
          <div mix={css({ display: 'flex', gap: '10px', marginTop: '16px' })}>
            <form
              method="POST"
              action={routes.admin.types.destroy.href({ typeId: String(contentType.id) })}
            >
              <button type="submit" mix={primaryDangerButtonStyle}>
                Delete content type
              </button>
            </form>
            <a href={routes.admin.types.index.href()} mix={secondaryButtonStyle}>
              Cancel
            </a>
          </div>
        </div>
      </AdminShell>
    )
  }
}

interface BuilderPageProps {
  mode: 'new' | 'edit'
  contentType?: ContentType
  contentTypes: ContentType[]
  components: Component[]
  user?: AuthUser
  name?: string
  kind?: 'collection' | 'single'
  localized?: boolean
  fields?: FieldDef[]
  error?: string
}

function BuilderPage(handle: Handle<BuilderPageProps>) {
  return () => {
    let {
      mode,
      contentType,
      contentTypes,
      components,
      user,
      name = '',
      kind = 'collection',
      localized = false,
      fields = [],
      error,
    } = handle.props

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
              <label mix={[fieldLabelStyle, css({ flex: '1 1 160px' })]}>
                <span>Localized</span>
                <select name="localized" mix={inputStyle}>
                  <option value="no" selected={!localized}>
                    No
                  </option>
                  <option value="yes" selected={localized}>
                    Yes
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
              <span>Component</span>
              <span>Repeatable</span>
              <span>Required</span>
              <span>Unique</span>
              <span>Options (comma-separated)</span>
            </div>

            {rows.map((field) => (
              <FieldRow field={field} components={components} />
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

function FieldRow(handle: Handle<{ field: FieldDef | null; components: Component[] }>) {
  return () => {
    let { field, components } = handle.props
    let type: FieldType = field?.type ?? 'text'
    // Unique is meaningless for booleans and component groups; options only
    // apply to enumerations. Render an inactive cell (with a hidden input) for
    // the rest so every row still submits an aligned value for both names.
    let uniqueApplies = type !== 'boolean' && type !== 'component'
    let optionsApply = type === 'enumeration'

    return (
      <div mix={rowStyle}>
        <input type="text" name="field_name" value={field?.name ?? ''} placeholder="title" mix={cellInputStyle} />
        <input type="text" name="field_label" value={field?.label ?? ''} placeholder="Title" mix={cellInputStyle} />
        <select name="field_type" mix={cellInputStyle}>
          {FIELD_TYPES.map((fieldType) => (
            <option value={fieldType} selected={field?.type === fieldType}>
              {FIELD_TYPE_LABELS[fieldType]}
            </option>
          ))}
        </select>
        <select name="field_component" mix={cellInputStyle}>
          <option value="" selected={!field?.component}>
            None
          </option>
          {components.map((component) => (
            <option value={component.apiId} selected={field?.component === component.apiId}>
              {component.name}
            </option>
          ))}
        </select>
        <YesNoSelect name="field_repeatable" value={field?.repeatable ?? false} />
        <YesNoSelect name="field_required" value={field?.required ?? false} />
        {uniqueApplies ? (
          <YesNoSelect name="field_unique" value={field?.unique ?? false} />
        ) : (
          <InactiveCell name="field_unique" value="no" label="n/a" />
        )}
        {optionsApply ? (
          <input
            type="text"
            name="field_options"
            value={field?.options.join(', ') ?? ''}
            placeholder="draft, published"
            mix={cellInputStyle}
          />
        ) : (
          <InactiveCell name="field_options" value="" label="Enumeration only" />
        )}
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
  gridTemplateColumns: '1.1fr 1.1fr 0.9fr 1fr 0.8fr 0.7fr 0.7fr 1.2fr',
  gap: '8px',
  padding: '0 2px 6px',
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--text-tertiary)',
  '@media (max-width: 1100px)': { display: 'none' },
})

const rowStyle = css({
  display: 'grid',
  gridTemplateColumns: '1.1fr 1.1fr 0.9fr 1fr 0.8fr 0.7fr 0.7fr 1.2fr',
  gap: '8px',
  marginBottom: '8px',
  '@media (max-width: 1100px)': { gridTemplateColumns: '1fr 1fr' },
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

const warningStyle = css({
  margin: 0,
  padding: '12px 16px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--danger)',
  background: 'var(--danger-soft)',
  border: '1px solid var(--danger)',
})

const primaryDangerButtonStyle = css({
  font: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '9px 16px',
  borderRadius: '8px',
  border: '1px solid transparent',
  background: 'var(--danger)',
  color: '#fff',
  '&:hover': { opacity: 0.9 },
})

// One grid cell that keeps a builder row's parallel-array inputs aligned even
// when the control does not apply to the row's field type: a disabled control
// shows the state visually while a hidden input carries the fixed submitted
// value (a disabled control submits nothing on its own).
function InactiveCell(handle: Handle<{ name: string; value: string; label: string }>) {
  return () => {
    let { name, value, label } = handle.props
    return (
      <span mix={inactiveCellStyle}>
        <input type="hidden" name={name} value={value} />
        {label}
      </span>
    )
  }
}

const inactiveCellStyle = css({
  display: 'flex',
  alignItems: 'center',
  padding: '8px 10px',
  fontSize: '13px',
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: '7px',
  background: 'var(--surface-2)',
})
