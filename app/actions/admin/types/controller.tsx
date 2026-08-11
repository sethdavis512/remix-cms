import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '#app/middleware/auth.ts'
import {
  createContentType,
  deleteContentType,
  findContentType,
  findContentTypeByApiId,
  listContentTypes,
  updateContentType,
  type ContentType,
} from '#app/data/content-types.server.ts'
import { listComponents, type Component } from '#app/data/components.server.ts'
import { countEntriesForType } from '#app/data/entries.server.ts'
import { logAudit } from '#app/data/audit.server.ts'
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  parseFieldDefs,
  pluralize,
  slugify,
  type FieldDef,
} from '#app/utils/fields.ts'
import { sampleListPayload } from '#app/utils/sample-payload.ts'
import { FieldRowsEditor } from '#app/assets/field-rows.tsx'
import { routes } from '#app/routes.ts'
import {
  AdminShell,
  cardStyle,
  dangerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '#app/ui/admin-shell.tsx'
import {
  ConfirmDeleteCard,
  DataTable,
  EmptyState,
  fieldLabelStyle,
  formErrorStyle,
  inputStyle,
  tdActionsStyle,
  tdMonoStyle,
  tdStyle,
  thStyle,
} from '#app/ui/primitives.tsx'
import { Pagination } from '#app/ui/pagination.tsx'
import { paginateList, pageHref } from '#app/utils/pagination.ts'
import { flashMessage, readFlash, type FlashType } from '#app/utils/flash.ts'

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

export default createController(routes.admin.types, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let allTypes = await listContentTypes(db)
      let { pagination, items } = paginateList(allTypes, context.url.searchParams.get('page'))
      let flash = readFlash(context.get(Session)!)
      return context.render(
        <TypesIndexPage
          contentTypes={allTypes}
          types={items}
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          user={currentUser(context)}
          flash={flash.message}
          flashType={flash.type}
        />,
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
      let fields = parseFieldDefs(formData, { allowComponent: true, allowRelation: true, allowMedia: true })
      let apiId = slugify(name)

      let contentTypes = await listContentTypes(db)
      let components = await listComponents(db)

      let error =
        (await validateType(db, { name, apiId })) ??
        validateFields(fields, components, contentTypes)
      if (error) {
        return context.render(
          <BuilderPage
            mode="new"
            contentTypes={contentTypes}
            components={components}
            user={currentUser(context)}
            name={name}
            kind={kind}
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

      flashMessage(context.get(Session)!, `Content type "${created.name}" created.`)
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
      let fields = parseFieldDefs(formData, { allowComponent: true, allowRelation: true, allowMedia: true })
      let apiId = slugify(name)

      let contentTypes = await listContentTypes(db)
      let components = await listComponents(db)

      let error =
        (await validateType(db, { name, apiId, ignoreId: id })) ??
        validateFields(fields, components, contentTypes)
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
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'content_type.updated',
        'content_type',
        id,
        `Updated content type "${name}"`,
      )

      flashMessage(context.get(Session)!, `Content type "${name}" saved.`)
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
        flashMessage(context.get(Session)!, `Content type "${contentType.name}" deleted.`, 'danger')
      }
      return redirect(routes.admin.types.index.href(), 303)
    },
  },
})

async function validateType(
  db: import('#app/data/db.ts').AppDatabase,
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

// Component fields must point at an existing component; relation fields must
// point at an existing content type.
function validateFields(
  fields: FieldDef[],
  components: Component[],
  contentTypes: ContentType[],
): string | null {
  for (let field of fields) {
    if (field.type === 'component') {
      if (!field.component) {
        return `Field "${field.label}" must select a component.`
      }
      if (!components.some((component) => component.apiId === field.component)) {
        return `Field "${field.label}" references an unknown component.`
      }
    }

    if (field.type === 'relation') {
      if (!field.target) {
        return `Field "${field.label}" must select a target content type.`
      }
      if (!contentTypes.some((type) => type.apiId === field.target)) {
        return `Field "${field.label}" references an unknown content type.`
      }
    }
  }
  return null
}

// ----- Pages -----

function TypesIndexPage(
  handle: Handle<{
    contentTypes: ContentType[]
    types: ContentType[]
    page: number
    totalPages: number
    total: number
    user?: AuthUser
    flash?: string | null
    flashType?: FlashType
  }>,
) {
  return () => {
    let { contentTypes, types, page, totalPages, total, user, flash, flashType } = handle.props

    return (
      <AdminShell
        heading="Content-Type Builder"
        activeNav="types"
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        flashType={flashType}
        actions={
          <a href={routes.admin.types.newForm.href()} mix={primaryButtonStyle}>
            New content type
          </a>
        }
      >
        {total === 0 ? (
          <EmptyState>No content types yet. Create one to get started.</EmptyState>
        ) : (
          <DataTable>
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
              {types.map((type) => (
                <tr>
                  <td mix={tdStyle}>{type.name}</td>
                  <td mix={[tdMonoStyle, css({ color: 'var(--text-tertiary)' })]}>
                    {type.apiId}
                  </td>
                  <td mix={tdStyle}>{type.fields.length}</td>
                  <td mix={tdStyle}>{type.kind}</td>
                  <td mix={tdActionsStyle}>
                    <div
                      mix={css({
                        display: 'flex',
                        gap: '8px',
                        justifyContent: 'flex-end',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      })}
                    >
                      <a
                        href={routes.admin.content.index.href({ type: type.apiId })}
                        mix={secondaryButtonStyle}
                      >
                        Entries
                      </a>
                      <a
                        href={routes.admin.types.editForm.href({ typeId: String(type.id) })}
                        mix={secondaryButtonStyle}
                      >
                        Edit
                      </a>
                      <a
                        href={routes.admin.types.confirmDestroy.href({ typeId: String(type.id) })}
                        mix={dangerButtonStyle}
                      >
                        Delete
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          noun="content type"
          prevHref={pageHref(routes.admin.types.index.href(), page - 1, totalPages)}
          nextHref={pageHref(routes.admin.types.index.href(), page + 1, totalPages)}
        />
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
        <ConfirmDeleteCard
          title={`Delete "${contentType.name}"?`}
          warning={
            entryCount === 0
              ? 'This content type has no entries.'
              : entryCount === 1
                ? '1 entry will be permanently deleted along with it.'
                : `${entryCount} entries will be permanently deleted along with it.`
          }
          confirmLabel="Delete content type"
          actionHref={routes.admin.types.destroy.href({ typeId: String(contentType.id) })}
          cancelHref={routes.admin.types.index.href()}
        >
          This permanently deletes the content type and cascades to all of its content. This
          cannot be undone.
        </ConfirmDeleteCard>
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
      fields = [],
      error,
    } = handle.props

    let actionHref =
      mode === 'edit' && contentType
        ? routes.admin.types.update.href({ typeId: String(contentType.id) })
        : routes.admin.types.create.href()

    return (
      <AdminShell
        heading={mode === 'edit' ? `Edit ${contentType?.name ?? 'content type'}` : 'New content type'}
        activeNav="types"
        contentTypes={contentTypes}
        user={user}
      >
        <form method="POST" action={actionHref} mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          {error ? (
            <p role="alert" mix={[formErrorStyle, css({ margin: 0 })]}>
              {error}
            </p>
          ) : null}

          <div mix={cardStyle}>
            <div mix={css({ display: 'flex', gap: '16px', flexWrap: 'wrap' })}>
              <label mix={[fieldLabelStyle, css({ flex: '2 1 220px' })]}>
                <span>Display name</span>
                <input
                  type="text"
                  name="name"
                  value={name}
                  required
                  placeholder="e.g. Article"
                  mix={[inputStyle, css({ width: '100%' })]}
                />
              </label>
              <label mix={[fieldLabelStyle, css({ flex: '1 1 160px' })]}>
                <span>Kind</span>
                <select name="kind" mix={[inputStyle, css({ width: '100%' })]}>
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
            <h2 mix={sectionHeadingStyle}>Fields</h2>
            <p mix={css({ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' })}>
              Rows without a name are ignored.
            </p>

            <FieldRowsEditor
              fields={fields.map((field) => ({
                name: field.name,
                label: field.label,
                type: field.type,
                required: field.required,
                unique: field.unique,
                options: field.options,
                component: field.component,
                target: field.target,
                repeatable: field.repeatable,
              }))}
              fieldTypes={FIELD_TYPES.map((fieldType) => ({
                value: fieldType,
                label: FIELD_TYPE_LABELS[fieldType],
              }))}
              components={components.map((component) => ({
                apiId: component.apiId,
                name: component.name,
              }))}
              contentTypes={contentTypes.map((contentType) => ({
                apiId: contentType.apiId,
                name: contentType.name,
              }))}
            />
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

        {mode === 'edit' && contentType ? (
          <SamplePayloadCard
            contentType={contentType}
            components={components}
            fields={fields}
          />
        ) : null}
      </AdminShell>
    )
  }
}

// Read-only "here's what the API returns" card, shown once a content type
// exists and has a stable plural api id (à la Contentful's sample payload).
function SamplePayloadCard(
  handle: Handle<{ contentType: ContentType; components: Component[]; fields: FieldDef[] }>,
) {
  return () => {
    let { contentType, components, fields } = handle.props
    let componentMap = Object.fromEntries(components.map((c) => [c.apiId, c.fields]))
    let payload = sampleListPayload(fields, componentMap)
    let listPath = routes.api.list.href({ type: contentType.apiIdPlural })
    let showPath = routes.api.show.href({ type: contentType.apiIdPlural, id: '1' })

    return (
      <div mix={[cardStyle, css({ marginTop: '20px' })]}>
        <h2 mix={sectionHeadingStyle}>Sample API response</h2>
        <p mix={css({ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-secondary)' })}>
          Example payload the public read API serves for this content type. Field values are
          placeholders shaped to their type.
        </p>

        <div mix={endpointRowStyle}>
          <span mix={verbStyle}>GET</span>
          <code mix={endpointStyle}>{listPath}</code>
        </div>
        <div mix={endpointRowStyle}>
          <span mix={verbStyle}>GET</span>
          <code mix={endpointStyle}>{showPath}</code>
          <span mix={css({ fontSize: '12px', color: 'var(--text-tertiary)' })}>
            single entry, wrapped in <code mix={inlineCodeStyle}>{'{ "data": … }'}</code>
          </span>
        </div>

        <pre mix={codeBlockStyle}>{payload}</pre>
      </div>
    )
  }
}

// ----- Styles -----

const sectionHeadingStyle = css({
  margin: '0 0 4px',
  fontSize: '15px',
  fontWeight: 650,
  letterSpacing: '-0.005em',
  color: 'var(--text-primary)',
})

const endpointRowStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  flexWrap: 'wrap',
  marginBottom: '8px',
})

const verbStyle = css({
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.05em',
  padding: '2px 7px',
  borderRadius: '5px',
  color: 'var(--text-tertiary)',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
})

const endpointStyle = css({
  fontFamily: 'ui-monospace, monospace',
  fontSize: '13px',
  color: 'var(--text-primary)',
})

const inlineCodeStyle = css({
  fontFamily: 'ui-monospace, monospace',
  fontSize: '12px',
  color: 'var(--text-tertiary)',
})

const codeBlockStyle = css({
  margin: '12px 0 0',
  padding: '14px 16px',
  borderRadius: '10px',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: '12.5px',
  lineHeight: 1.55,
  overflowX: 'auto',
  whiteSpace: 'pre',
})

