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
  nullifyRelationsToEntry,
  publishEntry,
  setEntrySchedule,
  unpublishEntry,
  updateEntryData,
  type Entry,
} from '../../../data/entries.server.ts'
import { componentFieldsByApiId, listComponents } from '../../../data/components.server.ts'
import { findAsset, listAssets } from '../../../data/assets.server.ts'
import {
  listOpenReleases,
  listOpenReleasesForEntry,
  type Release,
} from '../../../data/releases.server.ts'
import { logAudit } from '../../../data/audit.server.ts'
import { isApiTokenRequired } from '../../../data/settings.server.ts'
import { buildEntrySchema, extractEntryInput } from '../../../utils/field-schema.ts'
import { entryLabel, type FieldDef } from '../../../utils/fields.ts'
import { formatWhen, parseScheduledAt, toDatetimeLocal } from '../../../utils/schedule.ts'
import { routes } from '../../../routes.ts'
import {
  AdminShell,
  cardStyle,
  dangerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../../ui/admin-shell.tsx'
import {
  ComponentFieldGroup,
  FieldInput,
  MediaFieldInput,
  RelationFieldInput,
  type AssetOption,
  type RelationOption,
} from '../../../ui/form-fields.tsx'
import { ApiSnippets } from '../../../ui/api-snippets.tsx'
import { Pagination } from '../../../ui/pagination.tsx'
import { paginate } from '../../../utils/pagination.ts'

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

function notFound() {
  return new Response('Not Found', { status: 404 })
}

// Entries per page in the Content Manager list.
const ENTRIES_PER_PAGE = 20

type FlashType = 'success' | 'info' | 'danger'

// Minimal structural view of the session object for flash read/write, so these
// helpers don't need the concrete Session type.
interface FlashSession {
  get(key: string): unknown
  flash(key: string, value: string): void
}

// Flash a message plus an outcome type so the banner can signal success vs a
// neutral or destructive result. Read back with readFlash.
function flashMessage(session: FlashSession, text: string, type: FlashType = 'success') {
  session.flash('message', text)
  session.flash('messageType', type)
}

function readFlash(session: FlashSession): { message: string | null; type: FlashType } {
  let message = session.get('message')
  let rawType = session.get('messageType')
  return {
    message: typeof message === 'string' ? message : null,
    type: rawType === 'info' || rawType === 'danger' ? rawType : 'success',
  }
}

// Map validation issues to a { key: message } record for inline display. Keys
// are dotted paths matching the form input names: 'title' for scalars,
// 'hero.title' for single components, 'cards.0.title' for repeatable items.
function issuesToErrors(issues: ReadonlyArray<{ path?: ReadonlyArray<unknown>; message: string }>) {
  let errors: Record<string, string> = {}
  for (let issue of issues) {
    let key = (issue.path ?? [])
      .map((segment) =>
        segment && typeof segment === 'object' && 'key' in segment
          ? String((segment as { key: unknown }).key)
          : String(segment),
      )
      .join('.')
    if (key && !errors[key]) errors[key] = issue.message
  }
  return errors
}

// api_id -> sub-fields for every component, loaded once per request that
// builds an entry schema or renders an entry form.
async function loadComponentFields(db: import('../../../data/db.ts').AppDatabase) {
  return componentFieldsByApiId(await listComponents(db))
}

// Enforce field-level uniqueness for scalar fields flagged `unique`, scoped to
// the same content type. Returns a { fieldName: message } map for the
// inline-error re-render, empty when there are no conflicts. Empty/null values
// are skipped; booleans and components are never unique-checked.
// `excludeEntryId` omits the row being updated.
async function findUniqueConflicts(
  db: import('../../../data/db.ts').AppDatabase,
  contentType: ContentType,
  value: Record<string, unknown>,
  excludeEntryId?: number,
): Promise<Record<string, string>> {
  let uniqueFields = contentType.fields.filter(
    (field) => field.unique && field.type !== 'boolean' && field.type !== 'component',
  )
  if (uniqueFields.length === 0) return {}

  let existing = await listEntries(db, contentType.id)
  let errors: Record<string, string> = {}
  for (let field of uniqueFields) {
    let candidate = value[field.name]
    if (candidate === null || candidate === undefined || candidate === '') continue
    let clash = existing.some(
      (entry) => entry.id !== excludeEntryId && entry.data[field.name] === candidate,
    )
    if (clash) errors[field.name] = 'Must be unique. Another entry already uses this value.'
  }
  return errors
}

// For each relation field on a content type, the pickable target entries
// ({ id, label }) drawn from the target type — used to render the relation
// selects on the entry form.
async function loadRelationOptions(
  db: import('../../../data/db.ts').AppDatabase,
  contentType: ContentType,
): Promise<Record<string, RelationOption[]>> {
  let options: Record<string, RelationOption[]> = {}
  for (let field of contentType.fields) {
    if (field.type !== 'relation' || !field.target) continue
    let target = await findContentTypeByApiId(db, field.target)
    if (!target) {
      options[field.name] = []
      continue
    }
    let targetEntries = await listEntries(db, target.id)
    options[field.name] = targetEntries.map((entry) => ({
      id: entry.id,
      label: entryLabel(entry.id, entry.data, target.fields),
    }))
  }
  return options
}

// Referential integrity for relation fields: every referenced id must be an
// existing entry of the field's configured target type. Shape validation has
// already run, so values are number | number[] | null here. Returns inline
// errors keyed by field name, empty when every reference is valid.
async function findRelationConflicts(
  db: import('../../../data/db.ts').AppDatabase,
  contentType: ContentType,
  value: Record<string, unknown>,
): Promise<Record<string, string>> {
  let errors: Record<string, string> = {}
  for (let field of contentType.fields) {
    if (field.type !== 'relation' || !field.target) continue
    let raw = value[field.name]
    let ids = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
    if (ids.length === 0) continue

    let target = await findContentTypeByApiId(db, field.target)
    if (!target) {
      errors[field.name] = 'The target content type no longer exists.'
      continue
    }
    for (let id of ids) {
      let ref = typeof id === 'number' ? await findEntry(db, id) : null
      if (!ref || ref.contentTypeId !== target.id) {
        errors[field.name] = 'References an entry that is not in the target type.'
        break
      }
    }
  }
  return errors
}

// The pickable assets ({ id, filename }) for every media field on a content
// type, drawn from the whole media library. Empty when the type has no media
// fields, so the load is skipped for types that don't need it.
async function loadAssetOptions(
  db: import('../../../data/db.ts').AppDatabase,
  contentType: ContentType,
): Promise<Record<string, AssetOption[]>> {
  let options: Record<string, AssetOption[]> = {}
  let mediaFields = contentType.fields.filter((field) => field.type === 'media')
  if (mediaFields.length === 0) return options
  let assets = await listAssets(db)
  let list = assets.map((asset) => ({ id: asset.id, filename: asset.filename }))
  for (let field of mediaFields) options[field.name] = list
  return options
}

// Referential integrity for media fields: every referenced id must be an
// existing asset. Shape validation has already run, so values are number | null
// here. Returns inline errors keyed by field name, empty when every reference
// is valid.
async function findMediaConflicts(
  db: import('../../../data/db.ts').AppDatabase,
  contentType: ContentType,
  value: Record<string, unknown>,
): Promise<Record<string, string>> {
  let errors: Record<string, string> = {}
  for (let field of contentType.fields) {
    if (field.type !== 'media') continue
    let id = value[field.name]
    if (typeof id !== 'number') continue
    let asset = await findAsset(db, id)
    if (!asset) errors[field.name] = 'References an asset that no longer exists.'
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

      let allEntries = await listEntries(db, contentType.id)

      // Search filters by the entry's display label (case-insensitive).
      let query = (context.url.searchParams.get('q') ?? '').trim()
      let searched = query
        ? allEntries.filter((entry) =>
            entryLabel(entry.id, entry.data, contentType.fields)
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
        : allEntries

      // Status filter (All / Published / Draft), mirroring Contentful's status
      // facet. Any value other than the two known statuses means "all".
      let rawStatus = context.url.searchParams.get('status')
      let statusFilter: 'published' | 'draft' | null =
        rawStatus === 'published' || rawStatus === 'draft' ? rawStatus : null
      let byStatus = statusFilter
        ? searched.filter((entry) => entry.status === statusFilter)
        : searched

      // Sort by the Updated column; default newest-first, toggled to oldest-first
      // via ?sort=updated_asc from the column header.
      let sortDir: 'asc' | 'desc' =
        context.url.searchParams.get('sort') === 'updated_asc' ? 'asc' : 'desc'
      let filtered = [...byStatus].sort((a, b) =>
        sortDir === 'asc' ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt,
      )

      // Paginate the filtered set, clamping the requested page into range.
      let { page, totalPages, total, offset } = paginate(
        filtered.length,
        context.url.searchParams.get('page'),
        ENTRIES_PER_PAGE,
      )
      let entries = filtered.slice(offset, offset + ENTRIES_PER_PAGE)

      let session = context.get(Session)!
      let flash = readFlash(session)

      // A concrete id for the "get a single entry" snippet: prefer a published
      // entry so the snippet returns data immediately, else any entry, else 1.
      // Computed from the full set so search/paging never empties the snippet.
      let sampleId =
        allEntries.find((entry) => entry.status === 'published')?.id ?? allEntries[0]?.id ?? 1

      let allTypes = await listContentTypes(db)
      return context.render(
        <EntriesIndexPage
          contentType={contentType}
          entries={entries}
          contentTypes={allTypes}
          user={currentUser(context)}
          flash={flash.message}
          flashType={flash.type}
          origin={context.url.origin}
          sampleId={sampleId}
          requireToken={await isApiTokenRequired(db)}
          query={query}
          statusFilter={statusFilter}
          sortDir={sortDir}
          page={page}
          totalPages={totalPages}
          total={total}
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
          components={await loadComponentFields(db)}
          relationOptions={await loadRelationOptions(db, contentType)}
          assetOptions={await loadAssetOptions(db, contentType)}
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
      let components = await loadComponentFields(db)
      let input = extractEntryInput(formData, contentType.fields, components)
      let parsed = s.parseSafe(buildEntrySchema(contentType.fields, components), input)

      if (!parsed.success) {
        let allTypes = await listContentTypes(db)
        return context.render(
          <EntryFormPage
            mode="new"
            contentType={contentType}
            contentTypes={allTypes}
            components={components}
            relationOptions={await loadRelationOptions(db, contentType)}
            assetOptions={await loadAssetOptions(db, contentType)}
            user={currentUser(context)}
            values={input}
            errors={issuesToErrors(parsed.issues)}
          />,
          { status: 400 },
        )
      }

      let writeErrors = {
        ...(await findUniqueConflicts(
          db,
          contentType,
          parsed.value as Record<string, unknown>,
        )),
        ...(await findRelationConflicts(db, contentType, parsed.value as Record<string, unknown>)),
        ...(await findMediaConflicts(db, contentType, parsed.value as Record<string, unknown>)),
      }
      if (Object.keys(writeErrors).length > 0) {
        let allTypes = await listContentTypes(db)
        return context.render(
          <EntryFormPage
            mode="new"
            contentType={contentType}
            contentTypes={allTypes}
            components={components}
            relationOptions={await loadRelationOptions(db, contentType)}
            assetOptions={await loadAssetOptions(db, contentType)}
            user={currentUser(context)}
            values={input}
            errors={writeErrors}
          />,
          { status: 400 },
        )
      }

      let entry = await createEntry(db, contentType.id, parsed.value as Record<string, unknown>)
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'entry.created',
        'entry',
        entry.id,
        `Created "${entryLabel(entry.id, entry.data, contentType.fields)}" (${contentType.name})`,
      )
      flashMessage(context.get(Session)!, 'Entry created.')
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
      let flash = readFlash(session)
      let allTypes = await listContentTypes(db)
      return context.render(
        <EntryFormPage
          mode="edit"
          contentType={contentType}
          entry={entry}
          contentTypes={allTypes}
          components={await loadComponentFields(db)}
          relationOptions={await loadRelationOptions(db, contentType)}
          assetOptions={await loadAssetOptions(db, contentType)}
          user={currentUser(context)}
          values={entry.data}
          errors={{}}
          flash={flash.message}
          flashType={flash.type}
          openReleases={await listOpenReleases(db)}
          entryReleases={await listOpenReleasesForEntry(db, entry.id)}
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
      let components = await loadComponentFields(db)
      let input = extractEntryInput(formData, contentType.fields, components)
      let parsed = s.parseSafe(buildEntrySchema(contentType.fields, components), input)

      if (!parsed.success) {
        let allTypes = await listContentTypes(db)
        return context.render(
          <EntryFormPage
            mode="edit"
            contentType={contentType}
            entry={entry}
            contentTypes={allTypes}
            components={components}
            relationOptions={await loadRelationOptions(db, contentType)}
            assetOptions={await loadAssetOptions(db, contentType)}
            user={currentUser(context)}
            values={input}
            errors={issuesToErrors(parsed.issues)}
          />,
          { status: 400 },
        )
      }

      let writeErrors = {
        ...(await findUniqueConflicts(
          db,
          contentType,
          parsed.value as Record<string, unknown>,
          entry.id,
        )),
        ...(await findRelationConflicts(db, contentType, parsed.value as Record<string, unknown>)),
        ...(await findMediaConflicts(db, contentType, parsed.value as Record<string, unknown>)),
      }
      if (Object.keys(writeErrors).length > 0) {
        let allTypes = await listContentTypes(db)
        return context.render(
          <EntryFormPage
            mode="edit"
            contentType={contentType}
            entry={entry}
            contentTypes={allTypes}
            components={components}
            relationOptions={await loadRelationOptions(db, contentType)}
            assetOptions={await loadAssetOptions(db, contentType)}
            user={currentUser(context)}
            values={input}
            errors={writeErrors}
          />,
          { status: 400 },
        )
      }

      let updated = await updateEntryData(db, entry.id, parsed.value as Record<string, unknown>)
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'entry.updated',
        'entry',
        updated.id,
        `Updated "${entryLabel(updated.id, updated.data, contentType.fields)}" (${contentType.name})`,
      )
      flashMessage(context.get(Session)!, 'Entry saved.')
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

      let email = currentUser(context)?.email ?? 'system'
      if (entry.status === 'published') {
        let updated = await unpublishEntry(db, entry.id)
        await logAudit(
          db,
          email,
          'entry.unpublished',
          'entry',
          updated.id,
          `Unpublished "${entryLabel(updated.id, updated.data, contentType.fields)}" (${contentType.name})`,
        )
        flashMessage(context.get(Session)!, 'Entry unpublished.', 'info')
      } else {
        let updated = await publishEntry(db, entry.id)
        await logAudit(
          db,
          email,
          'entry.published',
          'entry',
          updated.id,
          `Published "${entryLabel(updated.id, updated.data, contentType.fields)}" (${contentType.name})`,
        )
        flashMessage(context.get(Session)!, 'Entry published.')
      }

      return redirect(
        routes.admin.content.editForm.href({ type: contentType.apiId, entryId: String(entry.id) }),
        303,
      )
    },

    // Save the per-entry publish/unpublish timers from the Scheduling card.
    // Blank inputs clear the corresponding timer.
    async schedule(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByApiId(db, context.params.type)
      if (!contentType) return notFound()

      let entry = await findEntry(db, Number(context.params.entryId))
      if (!entry || entry.contentTypeId !== contentType.id) return notFound()

      let formData = context.get(FormData)!
      let updated = await setEntrySchedule(db, entry.id, {
        publishAt: parseScheduledAt(String(formData.get('publish_at') ?? '')),
        unpublishAt: parseScheduledAt(String(formData.get('unpublish_at') ?? '')),
      })
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'entry.scheduled',
        'entry',
        updated.id,
        `Updated schedule for "${entryLabel(updated.id, updated.data, contentType.fields)}" (${contentType.name})`,
      )

      flashMessage(context.get(Session)!, 'Schedule saved.')
      return redirect(
        routes.admin.content.editForm.href({ type: contentType.apiId, entryId: String(entry.id) }),
        303,
      )
    },

    // Confirmation page for deleting an entry: deletion is permanent, so we
    // gate it behind an explicit confirm.
    async confirmDestroy(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByApiId(db, context.params.type)
      if (!contentType) return notFound()

      let entry = await findEntry(db, Number(context.params.entryId))
      if (!entry || entry.contentTypeId !== contentType.id) return notFound()

      let allTypes = await listContentTypes(db)
      return context.render(
        <ConfirmDeleteEntryPage
          contentType={contentType}
          entry={entry}
          contentTypes={allTypes}
          user={currentUser(context)}
        />,
      )
    },

    async destroy(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByApiId(db, context.params.type)
      if (!contentType) return notFound()

      let entry = await findEntry(db, Number(context.params.entryId))
      if (entry && entry.contentTypeId === contentType.id) {
        await deleteEntry(db, entry.id)
        // Null out any relation fields (across all types) that referenced this
        // entry, so referrers don't point at a now-deleted id.
        await nullifyRelationsToEntry(db, entry.id)
        await logAudit(
          db,
          currentUser(context)?.email ?? 'system',
          'entry.deleted',
          'entry',
          entry.id,
          `Deleted "${entryLabel(entry.id, entry.data, contentType.fields)}" (${contentType.name})`,
        )
        flashMessage(context.get(Session)!, 'Entry deleted.', 'danger')
      }

      return redirect(routes.admin.content.index.href({ type: contentType.apiId }), 303)
    },
  },
})

// ----- Pages -----

interface IndexProps {
  contentType: ContentType
  entries: Entry[]
  contentTypes: ContentType[]
  user?: AuthUser
  flash?: string | null
  flashType?: FlashType
  origin: string
  sampleId: number
  requireToken: boolean
  // Search + filter + pagination state for the current view.
  query: string
  statusFilter: 'published' | 'draft' | null
  sortDir: 'asc' | 'desc'
  page: number
  totalPages: number
  total: number
}

// Build an index URL that preserves search query, status filter, sort, and
// page. Page 1 and default sort are omitted to keep canonical URLs clean.
function entriesIndexHref(
  contentType: ContentType,
  params: { q?: string; status?: 'published' | 'draft' | null; sort?: 'asc' | 'desc'; page?: number },
): string {
  let base = routes.admin.content.index.href({ type: contentType.apiId })
  let search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.status) search.set('status', params.status)
  if (params.sort === 'asc') search.set('sort', 'updated_asc')
  if (params.page && params.page > 1) search.set('page', String(params.page))
  let qs = search.toString()
  return qs ? `${base}?${qs}` : base
}

function EntriesIndexPage(handle: Handle<IndexProps>) {
  return () => {
    let {
      contentType,
      entries,
      contentTypes,
      user,
      flash,
      flashType,
      origin,
      sampleId,
      requireToken,
      query,
      statusFilter,
      sortDir,
      page,
      totalPages,
      total,
    } = handle.props

    // Show the toolbar once the type has content or any filter is active; an
    // untouched empty collection just shows its empty state.
    let hasFilters = query !== '' || statusFilter !== null
    let showToolbar = total > 0 || hasFilters

    let statusTabs: { label: string; value: 'published' | 'draft' | null }[] = [
      { label: 'All', value: null },
      { label: 'Published', value: 'published' },
      { label: 'Draft', value: 'draft' },
    ]

    return (
      <AdminShell
        heading={contentType.name}
        eyebrow="Collection"
        activeNav="content"
        activeTypeApiId={contentType.apiId}
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        flashType={flashType}
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
          {showToolbar ? (
            <div mix={toolbarStyle}>
              <div mix={statusTabsStyle}>
                {statusTabs.map((tab) => (
                  <a
                    href={entriesIndexHref(contentType, {
                      q: query,
                      status: tab.value,
                      sort: sortDir,
                    })}
                    mix={tab.value === statusFilter ? statusTabActiveStyle : statusTabStyle}
                  >
                    {tab.label}
                  </a>
                ))}
              </div>
              <form
                method="GET"
                action={routes.admin.content.index.href({ type: contentType.apiId })}
                mix={searchFormStyle}
              >
                {statusFilter ? (
                  <input type="hidden" name="status" value={statusFilter} />
                ) : null}
                {sortDir === 'asc' ? <input type="hidden" name="sort" value="updated_asc" /> : null}
                <input
                  type="search"
                  name="q"
                  value={query}
                  placeholder="Search entries…"
                  mix={searchInputStyle}
                />
                <button type="submit" mix={secondaryButtonStyle}>
                  Search
                </button>
                {query ? (
                  <a
                    href={entriesIndexHref(contentType, {
                      status: statusFilter,
                      sort: sortDir,
                    })}
                    mix={secondaryButtonStyle}
                  >
                    Clear
                  </a>
                ) : null}
              </form>
            </div>
          ) : null}

          {entries.length === 0 ? (
            <div mix={cardStyle}>
              <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
                {hasFilters
                  ? 'No entries match the current filters.'
                  : 'No entries yet. Create one to get started.'}
              </p>
            </div>
          ) : (
          <div mix={cardStyle}>
            <table mix={tableStyle}>
              <thead>
                <tr>
                  <th mix={thStyle}>Entry</th>
                  <th mix={thStyle}>Status</th>
                  <th mix={thStyle}>
                    <a
                      href={entriesIndexHref(contentType, {
                        q: query,
                        status: statusFilter,
                        sort: sortDir === 'asc' ? 'desc' : 'asc',
                      })}
                      mix={sortHeaderStyle}
                    >
                      Updated
                      <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
                    </a>
                  </th>
                  <th mix={thStyle} />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr>
                    <td mix={tdStyle}>{entryLabel(entry.id, entry.data, contentType.fields)}</td>
                    <td mix={tdStyle}>
                      <StatusBadge status={entry.status} />
                    </td>
                    <td mix={[tdStyle, css({ color: 'var(--text-tertiary)', fontSize: '13px', whiteSpace: 'nowrap' })]}>
                      {formatWhen(entry.updatedAt)}
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

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            noun="entry"
            nounPlural="entries"
            prevHref={
              page > 1
                ? entriesIndexHref(contentType, {
                    q: query,
                    status: statusFilter,
                    sort: sortDir,
                    page: page - 1,
                  })
                : null
            }
            nextHref={
              page < totalPages
                ? entriesIndexHref(contentType, {
                    q: query,
                    status: statusFilter,
                    sort: sortDir,
                    page: page + 1,
                  })
                : null
            }
          />

          <ApiSnippets
            origin={origin}
            apiIdPlural={contentType.apiIdPlural}
            sampleId={sampleId}
            requireToken={requireToken}
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
  // Component api_id -> sub-field definitions, for component field groups.
  components: Record<string, FieldDef[]>
  user?: AuthUser
  values: Record<string, unknown>
  errors: Record<string, string>
  relationOptions?: Record<string, RelationOption[]>
  assetOptions?: Record<string, AssetOption[]>
  flash?: string | null
  flashType?: FlashType
  openReleases?: Release[]
  entryReleases?: Release[]
}

function EntryFormPage(handle: Handle<FormProps>) {
  return () => {
    let {
      mode,
      contentType,
      entry,
      contentTypes,
      components,
      relationOptions = {},
      assetOptions = {},
      user,
      values,
      errors,
      flash,
      flashType,
      openReleases = [],
      entryReleases = [],
    } = handle.props

    let actionHref =
      mode === 'edit' && entry
        ? routes.admin.content.update.href({ type: contentType.apiId, entryId: String(entry.id) })
        : routes.admin.content.create.href({ type: contentType.apiId })

    let hasFields = contentType.fields.length > 0

    return (
      <AdminShell
        heading={
          mode === 'edit'
            ? entryLabel(entry?.id ?? 0, values, contentType.fields)
            : `New ${contentType.name}`
        }
        eyebrow={contentType.name}
        activeNav="content"
        activeTypeApiId={contentType.apiId}
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        flashType={flashType}
        actions={
          <a
            href={routes.admin.content.index.href({ type: contentType.apiId })}
            mix={secondaryButtonStyle}
          >
            All {contentType.name}
          </a>
        }
        // Only run the two-column editor layout when there are fields to edit;
        // the empty "no fields" state stays a single centered card.
        aside={
          hasFields ? (
            <EntryPublishRail
              mode={mode}
              contentType={contentType}
              entry={entry}
              openReleases={openReleases}
              entryReleases={entryReleases}
            />
          ) : undefined
        }
      >
        {!hasFields ? (
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
          <form
            id="entry-form"
            method="POST"
            action={actionHref}
            mix={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}
          >
            <div mix={[cardStyle, css({ display: 'flex', flexDirection: 'column', gap: '18px' })]}>
              {contentType.fields.map((field) =>
                field.type === 'component' ? (
                  <ComponentFieldGroup
                    field={field}
                    subFields={components[field.component ?? ''] ?? []}
                    value={values[field.name]}
                    errors={errors}
                  />
                ) : field.type === 'relation' ? (
                  <RelationFieldInput
                    field={field}
                    value={values[field.name]}
                    error={errors[field.name]}
                    options={relationOptions[field.name] ?? []}
                  />
                ) : field.type === 'media' ? (
                  <MediaFieldInput
                    field={field}
                    value={values[field.name]}
                    error={errors[field.name]}
                    options={assetOptions[field.name] ?? []}
                  />
                ) : (
                  <FieldInput field={field} value={values[field.name]} error={errors[field.name]} />
                ),
              )}
            </div>
          </form>
        )}
      </AdminShell>
    )
  }
}

// The Contentful-style right rail for the entry editor: status + publish
// actions at the top, then read-only info, scheduling, and releases. The Save
// button reaches back into the fields form via form="entry-form", so it works
// even though it lives in a sibling column.
function EntryPublishRail(
  handle: Handle<{
    mode: 'new' | 'edit'
    contentType: ContentType
    entry?: Entry
    openReleases: Release[]
    entryReleases: Release[]
  }>,
) {
  return () => {
    let { mode, contentType, entry, openReleases, entryReleases } = handle.props
    let isEdit = mode === 'edit' && !!entry
    let published = entry?.status === 'published'

    return (
      <>
        <div mix={railCardStyle}>
          <div mix={railRowBetweenStyle}>
            <span mix={railLabelStyle}>Status</span>
            {entry ? <StatusBadge status={entry.status} /> : <DraftBadge />}
          </div>

          {isEdit && entry ? (
            <form
              method="POST"
              action={routes.admin.content.publish.href({
                type: contentType.apiId,
                entryId: String(entry.id),
              })}
            >
              <button
                type="submit"
                mix={published ? fullSecondaryButtonStyle : publishButtonStyle}
              >
                {published ? 'Unpublish' : 'Publish'}
              </button>
            </form>
          ) : null}

          <button
            type="submit"
            form="entry-form"
            mix={isEdit ? fullSecondaryButtonStyle : publishButtonStyle}
          >
            {isEdit ? 'Save changes' : 'Create entry'}
          </button>

          <a
            href={routes.admin.content.index.href({ type: contentType.apiId })}
            mix={railLinkStyle}
          >
            Cancel
          </a>
        </div>

        {isEdit && entry ? (
          <div mix={railCardStyle}>
            <span mix={railHeadingStyle}>Info</span>
            <InfoRow label="Content type" value={contentType.name} />
            <InfoRow label="Created" value={formatWhen(entry.createdAt)} />
            <InfoRow label="Last saved" value={formatWhen(entry.updatedAt)} />
            <InfoRow
              label="Published"
              value={entry.publishedAt ? formatWhen(entry.publishedAt) : 'Never'}
            />
            <InfoRow label="Entry ID" value={`#${entry.id}`} mono />
          </div>
        ) : null}

        {isEdit && entry ? (
          <div mix={railCardStyle}>
            <span mix={railHeadingStyle}>Scheduling</span>
            <p mix={railHintStyle}>
              Timers for this entry alone (server time). Leave blank to clear.
            </p>
            <form
              method="POST"
              action={routes.admin.content.schedule.href({
                type: contentType.apiId,
                entryId: String(entry.id),
              })}
              mix={css({ display: 'flex', flexDirection: 'column', gap: '10px' })}
            >
              <label mix={scheduleLabelStyle}>
                <span>Publish at</span>
                <input
                  type="datetime-local"
                  name="publish_at"
                  value={entry.publishAt ? toDatetimeLocal(entry.publishAt) : ''}
                  mix={scheduleInputStyle}
                />
              </label>
              <label mix={scheduleLabelStyle}>
                <span>Unpublish at</span>
                <input
                  type="datetime-local"
                  name="unpublish_at"
                  value={entry.unpublishAt ? toDatetimeLocal(entry.unpublishAt) : ''}
                  mix={scheduleInputStyle}
                />
              </label>
              <button type="submit" mix={fullSecondaryButtonStyle}>
                Save schedule
              </button>
            </form>
            {entry.publishAt || entry.unpublishAt ? (
              <p mix={css({ margin: '10px 0 0', fontSize: '12.5px', color: 'var(--brand)' })}>
                {[
                  entry.publishAt ? `Publishes ${formatWhen(entry.publishAt)}` : null,
                  entry.unpublishAt ? `Unpublishes ${formatWhen(entry.unpublishAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : null}
          </div>
        ) : null}

        {isEdit && entry ? (
          <div mix={railCardStyle}>
            <span mix={railHeadingStyle}>Releases</span>
            {entryReleases.length > 0 ? (
              <p mix={railHintStyle}>In: {entryReleases.map((r) => r.name).join(', ')}</p>
            ) : (
              <p mix={railHintStyle}>Stage this entry to publish or unpublish with a release.</p>
            )}
            {openReleases.length === 0 ? (
              <p mix={railHintStyle}>
                No open releases. <a href={routes.admin.releases.index.href()}>Create one</a>.
              </p>
            ) : (
              <form
                method="POST"
                action={routes.admin.releases.addItem.href()}
                mix={css({ display: 'flex', flexDirection: 'column', gap: '10px' })}
              >
                <input type="hidden" name="entry_id" value={String(entry.id)} />
                <select name="release_id" mix={releaseSelectStyle}>
                  {openReleases.map((release) => (
                    <option value={String(release.id)}>{release.name}</option>
                  ))}
                </select>
                <select name="action" mix={releaseSelectStyle}>
                  <option value="publish">Publish on release</option>
                  <option value="unpublish">Unpublish on release</option>
                </select>
                <button type="submit" mix={fullSecondaryButtonStyle}>
                  Add to release
                </button>
              </form>
            )}
          </div>
        ) : null}

        {isEdit && entry ? (
          <a
            href={routes.admin.content.confirmDestroy.href({
              type: contentType.apiId,
              entryId: String(entry.id),
            })}
            mix={[dangerButtonStyle, css({ justifyContent: 'center', textDecoration: 'none' })]}
          >
            Delete entry
          </a>
        ) : null}
      </>
    )
  }
}

function InfoRow(handle: Handle<{ label: string; value: string; mono?: boolean }>) {
  return () => {
    let { label, value, mono } = handle.props
    return (
      <div mix={railRowBetweenStyle}>
        <span mix={infoLabelStyle}>{label}</span>
        <span
          mix={css({
            fontSize: '12.5px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            textAlign: 'right',
            fontFamily: mono ? 'ui-monospace, monospace' : 'inherit',
          })}
        >
          {value}
        </span>
      </div>
    )
  }
}

function DraftBadge(_handle: Handle) {
  return () => (
    <span
      mix={css({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 10px 3px 8px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 600,
        color: 'var(--text-secondary)',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
      })}
    >
      <span
        mix={css({
          width: '6px',
          height: '6px',
          borderRadius: '999px',
          background: 'var(--text-tertiary)',
        })}
      />
      Draft
    </span>
  )
}

function ConfirmDeleteEntryPage(
  handle: Handle<{
    contentType: ContentType
    entry: Entry
    contentTypes: ContentType[]
    user?: AuthUser
  }>,
) {
  return () => {
    let { contentType, entry, contentTypes, user } = handle.props
    let label = entryLabel(entry.id, entry.data, contentType.fields)

    return (
      <AdminShell
        heading={`Delete ${contentType.name}`}
        activeNav="content"
        activeTypeApiId={contentType.apiId}
        contentTypes={contentTypes}
        user={user}
      >
        <div mix={cardStyle}>
          <h2 mix={css({ margin: '0 0 12px', fontSize: '16px' })}>Delete "{label}"?</h2>
          <p mix={css({ margin: '0 0 12px', fontSize: '14px' })}>
            This permanently deletes this entry. This cannot be undone.
          </p>
          {entry.status === 'published' ? (
            <p mix={confirmWarningStyle}>
              This entry is currently published and will disappear from the public API.
            </p>
          ) : null}
          <div mix={css({ display: 'flex', gap: '10px', marginTop: '16px' })}>
            <form
              method="POST"
              action={routes.admin.content.destroy.href({
                type: contentType.apiId,
                entryId: String(entry.id),
              })}
            >
              <button type="submit" mix={primaryDangerButtonStyle}>
                Delete entry
              </button>
            </form>
            <a
              href={routes.admin.content.editForm.href({
                type: contentType.apiId,
                entryId: String(entry.id),
              })}
              mix={secondaryButtonStyle}
            >
              Cancel
            </a>
          </div>
        </div>
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
          gap: '6px',
          padding: '3px 10px 3px 8px',
          borderRadius: '999px',
          fontSize: '12px',
          fontWeight: 600,
          color: published ? 'var(--success)' : 'var(--text-secondary)',
          background: published ? 'var(--success-soft)' : 'var(--surface-2)',
          border: `1px solid ${published ? 'color-mix(in srgb, var(--success) 26%, transparent)' : 'var(--border)'}`,
        })}
      >
        <span
          mix={css({
            width: '6px',
            height: '6px',
            borderRadius: '999px',
            background: published ? 'var(--success)' : 'var(--text-tertiary)',
          })}
        />
        {published ? 'Published' : 'Draft'}
      </span>
    )
  }
}

const scheduleLabelStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 600,
})

const inputFocusRing = {
  outline: 'none',
  borderColor: 'var(--brand)',
  boxShadow: '0 0 0 3px var(--brand-soft)',
} as const

const scheduleInputStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '14px',
  padding: '9px 11px',
  borderRadius: '7px',
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
  '&:focus': inputFocusRing,
})

const releaseSelectStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '13px',
  padding: '8px 10px',
  borderRadius: '7px',
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
  '&:focus': inputFocusRing,
})

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

const toolbarStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  flexWrap: 'wrap',
})

// Segmented status filter (All / Published / Draft), Contentful's status facet.
const statusTabsStyle = css({
  display: 'inline-flex',
  padding: '3px',
  borderRadius: '9px',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  gap: '2px',
})

const statusTabBase = {
  padding: '6px 14px',
  borderRadius: '7px',
  fontSize: '13px',
  fontWeight: 600,
  textDecoration: 'none',
  transition: 'background-color 120ms ease, color 120ms ease',
} as const

const statusTabStyle = css({
  ...statusTabBase,
  color: 'var(--text-secondary)',
  '&:hover': { color: 'var(--text-primary)' },
})

const statusTabActiveStyle = css({
  ...statusTabBase,
  color: 'var(--text-primary)',
  background: 'var(--surface-1)',
  boxShadow: 'var(--shadow-sm)',
})

const sortHeaderStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  color: 'inherit',
  textDecoration: 'none',
  '&:hover': { color: 'var(--text-secondary)' },
})

const searchFormStyle = css({ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' })

const searchInputStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '14px',
  padding: '9px 11px',
  borderRadius: '7px',
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  flex: '1 1 220px',
  minWidth: '180px',
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
  '&:focus': inputFocusRing,
})

const confirmWarningStyle = css({
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

// ----- Entry editor rail -----

const railCardStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '16px 18px',
  boxShadow: 'var(--shadow-sm)',
})

const railRowBetweenStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px',
})

const railLabelStyle = css({ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' })

const railHeadingStyle = css({
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--text-tertiary)',
})

const railHintStyle = css({ margin: 0, fontSize: '12.5px', color: 'var(--text-tertiary)' })

const railLinkStyle = css({
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textAlign: 'center',
  textDecoration: 'none',
  padding: '4px',
  borderRadius: '6px',
  '&:hover': { color: 'var(--text-primary)' },
})

const infoLabelStyle = css({ fontSize: '12.5px', color: 'var(--text-tertiary)' })

// Full-width variants of the shared buttons for the rail's stacked action column.
const railButtonBase = {
  font: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  width: '100%',
  padding: '10px 15px',
  borderRadius: '8px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  textDecoration: 'none',
  transition: 'background-color 130ms ease, border-color 130ms ease, color 130ms ease',
  '&:focus-visible': { outline: '2px solid var(--brand)', outlineOffset: '2px' },
} as const

// The signature Contentful green "Publish" action.
const publishButtonStyle = css({
  ...railButtonBase,
  border: '1px solid transparent',
  background: 'var(--success)',
  color: '#fff',
  '&:hover': { background: 'color-mix(in srgb, var(--success) 88%, #000)' },
})

const fullSecondaryButtonStyle = css({
  ...railButtonBase,
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-1)',
  color: 'var(--text-secondary)',
  '&:hover': { background: 'var(--surface-2)', color: 'var(--text-primary)' },
})
