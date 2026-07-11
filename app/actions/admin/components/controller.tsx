import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '../../../middleware/auth.ts'
import { listContentTypes, type ContentType } from '../../../data/content-types.server.ts'
import {
  createComponent,
  deleteComponent,
  findComponent,
  findComponentByApiId,
  listComponents,
  updateComponent,
  type Component,
} from '../../../data/components.server.ts'
import { logAudit } from '../../../data/audit.server.ts'
import {
  FIELD_TYPE_LABELS,
  SCALAR_FIELD_TYPES,
  parseFieldDefs,
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

// Component builder: reusable field groups that content types embed via
// fields of type 'component'. Components may only contain scalar field types
// (single-level nesting): parseFieldDefs is called without allowComponent, so
// a nested 'component' type can never be stored.

const BLANK_ROWS = 3

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

export default createController(routes.admin.components, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let flash = session.get('message')
      return context.render(
        <ComponentsIndexPage
          components={await listComponents(db)}
          contentTypes={await listContentTypes(db)}
          user={currentUser(context)}
          flash={typeof flash === 'string' ? flash : null}
        />,
      )
    },

    async newForm(context) {
      let db = context.get(Database)!
      return context.render(
        <ComponentBuilderPage
          mode="new"
          contentTypes={await listContentTypes(db)}
          user={currentUser(context)}
        />,
      )
    },

    async create(context) {
      let db = context.get(Database)!
      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim()
      let fields = parseFieldDefs(formData)
      let apiId = slugify(name)

      let error = await validateComponent(db, { name, apiId })
      if (error) {
        return context.render(
          <ComponentBuilderPage
            mode="new"
            contentTypes={await listContentTypes(db)}
            user={currentUser(context)}
            name={name}
            fields={fields}
            error={error}
          />,
          { status: 400 },
        )
      }

      let created = await createComponent(db, { name, apiId, fields })
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'component.created',
        'component',
        created.id,
        `Created component "${created.name}"`,
      )
      context.get(Session)!.flash('message', `Component "${name}" created.`)
      return redirect(routes.admin.components.index.href(), 303)
    },

    async editForm(context) {
      let db = context.get(Database)!
      let id = Number(context.params.componentId)
      if (!Number.isInteger(id)) return new Response('Not Found', { status: 404 })

      let component = await findComponent(db, id)
      if (!component) return new Response('Not Found', { status: 404 })

      return context.render(
        <ComponentBuilderPage
          mode="edit"
          component={component}
          contentTypes={await listContentTypes(db)}
          user={currentUser(context)}
          name={component.name}
          fields={component.fields}
        />,
      )
    },

    async update(context) {
      let db = context.get(Database)!
      let id = Number(context.params.componentId)
      if (!Number.isInteger(id)) return new Response('Not Found', { status: 404 })

      let component = await findComponent(db, id)
      if (!component) return new Response('Not Found', { status: 404 })

      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim()
      let fields = parseFieldDefs(formData)
      let apiId = slugify(name)

      let error = await validateComponent(db, { name, apiId, ignoreId: id })
      if (error) {
        return context.render(
          <ComponentBuilderPage
            mode="edit"
            component={component}
            contentTypes={await listContentTypes(db)}
            user={currentUser(context)}
            name={name}
            fields={fields}
            error={error}
          />,
          { status: 400 },
        )
      }

      await updateComponent(db, id, { name, apiId, fields })
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'component.updated',
        'component',
        id,
        `Updated component "${name}"`,
      )
      return redirect(routes.admin.components.index.href(), 303)
    },

    async destroy(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let id = Number(context.params.componentId)
      let component = Number.isInteger(id) ? await findComponent(db, id) : null

      if (component) {
        let referencedBy = await contentTypesUsing(db, component.apiId)
        if (referencedBy.length > 0) {
          session.flash(
            'message',
            `Cannot delete "${component.name}": content types still use it (${referencedBy
              .map((type) => type.name)
              .join(', ')}).`,
          )
        } else {
          await deleteComponent(db, component.id)
          await logAudit(
            db,
            currentUser(context)?.email ?? 'system',
            'component.deleted',
            'component',
            component.id,
            `Deleted component "${component.name}"`,
          )
          session.flash('message', `Component "${component.name}" deleted.`)
        }
      }

      return redirect(routes.admin.components.index.href(), 303)
    },
  },
})

async function validateComponent(
  db: import('../../../data/db.ts').AppDatabase,
  input: { name: string; apiId: string; ignoreId?: number },
): Promise<string | null> {
  if (input.name === '') return 'Name is required.'
  if (input.apiId === '') return 'Name must contain at least one letter or number.'

  let existing = await findComponentByApiId(db, input.apiId)
  if (existing && existing.id !== input.ignoreId) {
    return `A component with the api id "${input.apiId}" already exists.`
  }
  return null
}

// Content types whose schema embeds the given component api id, used to block
// deleting a component that is still referenced.
async function contentTypesUsing(
  db: import('../../../data/db.ts').AppDatabase,
  componentApiId: string,
): Promise<ContentType[]> {
  let all = await listContentTypes(db)
  return all.filter((type) =>
    type.fields.some((field) => field.type === 'component' && field.component === componentApiId),
  )
}

// ----- Pages -----

interface IndexProps {
  components: Component[]
  contentTypes: ContentType[]
  user?: AuthUser
  flash?: string | null
}

function ComponentsIndexPage(handle: Handle<IndexProps>) {
  return () => {
    let { components, contentTypes, user, flash } = handle.props

    return (
      <AdminShell
        heading="Components"
        activeNav="components"
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        actions={
          <a href={routes.admin.components.newForm.href()} mix={primaryButtonStyle}>
            New component
          </a>
        }
      >
        {components.length === 0 ? (
          <div mix={cardStyle}>
            <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
              No components yet. Create a reusable field group, then embed it from the
              Content-Type Builder with a field of type Component.
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
                  <th mix={thStyle} />
                </tr>
              </thead>
              <tbody>
                {components.map((component) => (
                  <tr>
                    <td mix={tdStyle}>{component.name}</td>
                    <td mix={tdMonoStyle}>{component.apiId}</td>
                    <td mix={tdStyle}>{component.fields.length}</td>
                    <td mix={tdActionsStyle}>
                      <a
                        href={routes.admin.components.editForm.href({
                          componentId: String(component.id),
                        })}
                        mix={secondaryButtonStyle}
                      >
                        Edit
                      </a>
                      <form
                        method="POST"
                        action={routes.admin.components.destroy.href({
                          componentId: String(component.id),
                        })}
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

interface BuilderProps {
  mode: 'new' | 'edit'
  component?: Component
  contentTypes: ContentType[]
  user?: AuthUser
  name?: string
  fields?: FieldDef[]
  error?: string
}

function ComponentBuilderPage(handle: Handle<BuilderProps>) {
  return () => {
    let { mode, component, contentTypes, user, name = '', fields = [], error } = handle.props

    let actionHref =
      mode === 'edit' && component
        ? routes.admin.components.update.href({ componentId: String(component.id) })
        : routes.admin.components.create.href()

    let rows: (FieldDef | null)[] = [...fields]
    for (let i = 0; i < BLANK_ROWS; i++) rows.push(null)

    return (
      <AdminShell
        heading={mode === 'edit' ? `Edit ${component?.name ?? 'component'}` : 'New component'}
        activeNav="components"
        contentTypes={contentTypes}
        user={user}
      >
        <form
          method="POST"
          action={actionHref}
          mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}
        >
          {error ? <p mix={formErrorStyle}>{error}</p> : null}

          <div mix={cardStyle}>
            <label mix={[fieldLabelStyle, css({ maxWidth: '320px' })]}>
              <span>Display name</span>
              <input
                type="text"
                name="name"
                value={name}
                placeholder="e.g. SEO metadata"
                mix={inputStyle}
              />
            </label>
          </div>

          <div mix={cardStyle}>
            <h2 mix={css({ margin: '0 0 4px', fontSize: '15px' })}>Fields</h2>
            <p mix={css({ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-tertiary)' })}>
              Leave a row's name blank to skip it. Save and re-open to add more rows.
              Components can only contain scalar field types.
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
              <ComponentFieldRow field={field} />
            ))}
          </div>

          <div mix={css({ display: 'flex', gap: '10px' })}>
            <button type="submit" mix={primaryButtonStyle}>
              {mode === 'edit' ? 'Save changes' : 'Create component'}
            </button>
            <a href={routes.admin.components.index.href()} mix={secondaryButtonStyle}>
              Cancel
            </a>
          </div>
        </form>
      </AdminShell>
    )
  }
}

function ComponentFieldRow(handle: Handle<{ field: FieldDef | null }>) {
  return () => {
    let field = handle.props.field
    let type: FieldType = field?.type ?? 'text'
    // Unique is meaningless for booleans; options only apply to enumerations.
    // Inactive cells keep a hidden input so every row still submits an aligned
    // value for both parallel-array names.
    let uniqueApplies = type !== 'boolean'
    let optionsApply = type === 'enumeration'

    return (
      <div mix={rowStyle}>
        <input
          type="text"
          name="field_name"
          value={field?.name ?? ''}
          placeholder="title"
          mix={cellInputStyle}
        />
        <input
          type="text"
          name="field_label"
          value={field?.label ?? ''}
          placeholder="Title"
          mix={cellInputStyle}
        />
        <select name="field_type" mix={cellInputStyle}>
          {SCALAR_FIELD_TYPES.map((fieldType) => (
            <option value={fieldType} selected={field?.type === fieldType}>
              {FIELD_TYPE_LABELS[fieldType]}
            </option>
          ))}
        </select>
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

// Keeps a builder row's parallel-array inputs aligned when a control does not
// apply to the row's field type: the hidden input carries the fixed submitted
// value (a disabled control would submit nothing).
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
