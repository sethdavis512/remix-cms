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
  setEntrySchedule,
  unpublishEntry,
  updateEntryData,
  type Entry,
} from '../../../data/entries.server.ts'
import { listLocales, type Locale } from '../../../data/locales.server.ts'
import { componentFieldsByApiId, listComponents } from '../../../data/components.server.ts'
import {
  listOpenReleases,
  listOpenReleasesForEntry,
  type Release,
} from '../../../data/releases.server.ts'
import { dispatchEntryEvent, entryEventPayload } from '../../../data/webhooks.server.ts'
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
import { ComponentFieldGroup, FieldInput } from '../../../ui/form-fields.tsx'
import { ApiSnippets } from '../../../ui/api-snippets.tsx'

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

function defaultLocaleCode(locales: Locale[]): string {
  return locales.find((locale) => locale.isDefault)?.code ?? 'en'
}

// The active locale for admin screens. Non-localized types always work in the
// default locale; localized types read ?locale= and fall back to the default.
function resolveLocale(url: URL, contentType: ContentType, locales: Locale[]): string {
  let fallback = defaultLocaleCode(locales)
  if (!contentType.localized) return fallback
  let requested = url.searchParams.get('locale')
  return requested && locales.some((locale) => locale.code === requested) ? requested : fallback
}

// href with the ?locale= search param appended for localized types.
function localeHref(href: string, contentType: ContentType, locale: string): string {
  return contentType.localized ? `${href}?locale=${encodeURIComponent(locale)}` : href
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
// the same content type and locale (a value may repeat across locales). Returns
// a { fieldName: message } map for the inline-error re-render, empty when there
// are no conflicts. Empty/null values are skipped; booleans and components are
// never unique-checked. `excludeEntryId` omits the row being updated.
async function findUniqueConflicts(
  db: import('../../../data/db.ts').AppDatabase,
  contentType: ContentType,
  value: Record<string, unknown>,
  locale: string,
  excludeEntryId?: number,
): Promise<Record<string, string>> {
  let uniqueFields = contentType.fields.filter(
    (field) => field.unique && field.type !== 'boolean' && field.type !== 'component',
  )
  if (uniqueFields.length === 0) return {}

  let existing = await listEntries(db, contentType.id, locale)
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

export default createController(routes.admin.content, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByApiId(db, context.params.type)
      if (!contentType) return notFound()

      let locales = await listLocales(db)
      let activeLocale = resolveLocale(context.url, contentType, locales)

      // Single types skip the list and go straight to their one entry (one per
      // locale when the type is localized).
      if (contentType.kind === 'single') {
        let entries = await listEntries(db, contentType.id, activeLocale)
        if (entries[0]) {
          return redirect(
            routes.admin.content.editForm.href({
              type: contentType.apiId,
              entryId: String(entries[0].id),
            }),
            303,
          )
        }
        return redirect(
          localeHref(
            routes.admin.content.newForm.href({ type: contentType.apiId }),
            contentType,
            activeLocale,
          ),
          303,
        )
      }

      let allEntries = await listEntries(
        db,
        contentType.id,
        contentType.localized ? activeLocale : undefined,
      )

      // Search filters by the entry's display label (case-insensitive).
      let query = (context.url.searchParams.get('q') ?? '').trim()
      let filtered = query
        ? allEntries.filter((entry) =>
            entryLabel(entry.id, entry.data, contentType.fields)
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
        : allEntries

      // Paginate the filtered set, clamping the requested page into range.
      let total = filtered.length
      let totalPages = Math.max(1, Math.ceil(total / ENTRIES_PER_PAGE))
      let requestedPage = Number(context.url.searchParams.get('page') ?? '1')
      let page = Number.isInteger(requestedPage)
        ? Math.min(Math.max(requestedPage, 1), totalPages)
        : 1
      let entries = filtered.slice((page - 1) * ENTRIES_PER_PAGE, page * ENTRIES_PER_PAGE)

      let session = context.get(Session)!
      let flash = readFlash(session)

      // A concrete id for the "get a single entry" snippet: prefer a published
      // entry so the snippet returns data immediately, else any entry, else 1.
      // Computed from the full set so search/paging never empties the snippet.
      let sampleId =
        allEntries.find((entry) => entry.status === 'published')?.id ?? allEntries[0]?.id ?? 1

      let allTypes = await listContentTypes(db)
      // For the localized snippet hint: prefer a real non-default locale.
      let localeHint =
        locales.find((locale) => !locale.isDefault)?.code ?? defaultLocaleCode(locales)
      return context.render(
        <EntriesIndexPage
          contentType={contentType}
          entries={entries}
          contentTypes={allTypes}
          locales={locales}
          activeLocale={activeLocale}
          user={currentUser(context)}
          flash={flash.message}
          flashType={flash.type}
          origin={context.url.origin}
          sampleId={sampleId}
          requireToken={await isApiTokenRequired(db)}
          localeHint={localeHint}
          query={query}
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

      let locales = await listLocales(db)
      let activeLocale = resolveLocale(context.url, contentType, locales)

      let allTypes = await listContentTypes(db)
      return context.render(
        <EntryFormPage
          mode="new"
          contentType={contentType}
          contentTypes={allTypes}
          components={await loadComponentFields(db)}
          locale={activeLocale}
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

      // Field names are slugified, so "_locale" can never collide with a
      // content field. Unknown or missing locales fall back to the default.
      let locales = await listLocales(db)
      let submitted = String(context.get(FormData)!.get('_locale') ?? '')
      let locale =
        contentType.localized && locales.some((l) => l.code === submitted)
          ? submitted
          : defaultLocaleCode(locales)

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
            locale={locale}
            user={currentUser(context)}
            values={input}
            errors={issuesToErrors(parsed.issues)}
          />,
          { status: 400 },
        )
      }

      let uniqueErrors = await findUniqueConflicts(
        db,
        contentType,
        parsed.value as Record<string, unknown>,
        locale,
      )
      if (Object.keys(uniqueErrors).length > 0) {
        let allTypes = await listContentTypes(db)
        return context.render(
          <EntryFormPage
            mode="new"
            contentType={contentType}
            contentTypes={allTypes}
            components={components}
            locale={locale}
            user={currentUser(context)}
            values={input}
            errors={uniqueErrors}
          />,
          { status: 400 },
        )
      }

      let entry = await createEntry(
        db,
        contentType.id,
        parsed.value as Record<string, unknown>,
        locale,
      )
      await dispatchEntryEvent(db, 'entry.created', entryEventPayload(entry, contentType.apiId))
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
          locale={entry.locale}
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
            locale={entry.locale}
            user={currentUser(context)}
            values={input}
            errors={issuesToErrors(parsed.issues)}
          />,
          { status: 400 },
        )
      }

      let uniqueErrors = await findUniqueConflicts(
        db,
        contentType,
        parsed.value as Record<string, unknown>,
        entry.locale,
        entry.id,
      )
      if (Object.keys(uniqueErrors).length > 0) {
        let allTypes = await listContentTypes(db)
        return context.render(
          <EntryFormPage
            mode="edit"
            contentType={contentType}
            entry={entry}
            contentTypes={allTypes}
            components={components}
            locale={entry.locale}
            user={currentUser(context)}
            values={input}
            errors={uniqueErrors}
          />,
          { status: 400 },
        )
      }

      let updated = await updateEntryData(db, entry.id, parsed.value as Record<string, unknown>)
      await dispatchEntryEvent(db, 'entry.updated', entryEventPayload(updated, contentType.apiId))
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
        await dispatchEntryEvent(
          db,
          'entry.unpublished',
          entryEventPayload(updated, contentType.apiId),
        )
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
        await dispatchEntryEvent(
          db,
          'entry.published',
          entryEventPayload(updated, contentType.apiId),
        )
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

    // Confirmation page for deleting an entry: deletion is permanent and fires
    // an entry.deleted webhook, so we gate it behind an explicit confirm.
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
        // Payload carries the entry's last known state before deletion.
        await dispatchEntryEvent(db, 'entry.deleted', entryEventPayload(entry, contentType.apiId))
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
  locales: Locale[]
  activeLocale: string
  user?: AuthUser
  flash?: string | null
  flashType?: FlashType
  origin: string
  sampleId: number
  requireToken: boolean
  localeHint: string
  // Search + pagination state for the current view.
  query: string
  page: number
  totalPages: number
  total: number
}

// Build an index URL that preserves locale, search query, and page. Locale is
// only appended for localized types; page is omitted for page 1.
function entriesIndexHref(
  contentType: ContentType,
  activeLocale: string,
  params: { q?: string; page?: number },
): string {
  let base = routes.admin.content.index.href({ type: contentType.apiId })
  let search = new URLSearchParams()
  if (contentType.localized) search.set('locale', activeLocale)
  if (params.q) search.set('q', params.q)
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
      locales,
      activeLocale,
      user,
      flash,
      flashType,
      origin,
      sampleId,
      requireToken,
      localeHint,
      query,
      page,
      totalPages,
      total,
    } = handle.props

    // Show search once the type has content (or a search is active); an
    // untouched empty collection just shows its empty state.
    let showSearch = total > 0 || query !== ''

    return (
      <AdminShell
        heading={contentType.name}
        activeNav="content"
        activeTypeApiId={contentType.apiId}
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        flashType={flashType}
        actions={
          <a
            href={localeHref(
              routes.admin.content.newForm.href({ type: contentType.apiId }),
              contentType,
              activeLocale,
            )}
            mix={primaryButtonStyle}
          >
            New entry
          </a>
        }
      >
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          {contentType.localized ? (
            <div mix={localeTabsStyle}>
              {locales.map((locale) => (
                <a
                  href={localeHref(
                    routes.admin.content.index.href({ type: contentType.apiId }),
                    contentType,
                    locale.code,
                  )}
                  mix={locale.code === activeLocale ? localeTabActiveStyle : localeTabStyle}
                >
                  {locale.name}
                </a>
              ))}
            </div>
          ) : null}

          {showSearch ? (
            <form
              method="GET"
              action={routes.admin.content.index.href({ type: contentType.apiId })}
              mix={searchFormStyle}
            >
              {contentType.localized ? (
                <input type="hidden" name="locale" value={activeLocale} />
              ) : null}
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
                  href={entriesIndexHref(contentType, activeLocale, {})}
                  mix={secondaryButtonStyle}
                >
                  Clear
                </a>
              ) : null}
            </form>
          ) : null}

          {entries.length === 0 ? (
            <div mix={cardStyle}>
              <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
                {query
                  ? `No entries match “${query}”.`
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
                  <th mix={thStyle}>Updated</th>
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

          {totalPages > 1 ? (
            <div mix={paginationStyle}>
              {page > 1 ? (
                <a
                  href={entriesIndexHref(contentType, activeLocale, { q: query, page: page - 1 })}
                  mix={secondaryButtonStyle}
                >
                  Previous
                </a>
              ) : (
                <span mix={paginationDisabledStyle}>Previous</span>
              )}
              <span mix={css({ fontSize: '13px', color: 'var(--text-tertiary)' })}>
                Page {page} of {totalPages} · {total} {total === 1 ? 'entry' : 'entries'}
              </span>
              {page < totalPages ? (
                <a
                  href={entriesIndexHref(contentType, activeLocale, { q: query, page: page + 1 })}
                  mix={secondaryButtonStyle}
                >
                  Next
                </a>
              ) : (
                <span mix={paginationDisabledStyle}>Next</span>
              )}
            </div>
          ) : null}

          <ApiSnippets
            origin={origin}
            apiIdPlural={contentType.apiIdPlural}
            sampleId={sampleId}
            requireToken={requireToken}
            localized={contentType.localized}
            localeHint={localeHint}
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
  locale: string
  user?: AuthUser
  values: Record<string, unknown>
  errors: Record<string, string>
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
      locale,
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

    return (
      <AdminShell
        heading={mode === 'edit' ? `Edit ${contentType.name}` : `New ${contentType.name}`}
        activeNav="content"
        activeTypeApiId={contentType.apiId}
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        flashType={flashType}
        actions={
          entry ? (
            <span mix={css({ display: 'flex', gap: '10px', alignItems: 'center' })}>
              {contentType.localized ? <LocaleBadge code={locale} /> : null}
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
          ) : contentType.localized ? (
            <LocaleBadge code={locale} />
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
          <>
            {/* The delete form must live OUTSIDE this form: a nested <form> is
                invalid HTML and browsers drop it, which made "Delete entry"
                submit a Save. The Save button reaches back into this form via
                its form="entry-form" association, so the button row can sit
                after the form as a sibling of the delete form. */}
            <form
              id="entry-form"
              method="POST"
              action={actionHref}
              mix={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}
            >
              {mode === 'new' && contentType.localized ? (
                <input type="hidden" name="_locale" value={locale} />
              ) : null}
              <div mix={[cardStyle, css({ display: 'flex', flexDirection: 'column', gap: '18px' })]}>
                {contentType.fields.map((field) =>
                  field.type === 'component' ? (
                    <ComponentFieldGroup
                      field={field}
                      subFields={components[field.component ?? ''] ?? []}
                      value={values[field.name]}
                      errors={errors}
                    />
                  ) : (
                    <FieldInput field={field} value={values[field.name]} error={errors[field.name]} />
                  ),
                )}
              </div>
            </form>

            <div mix={css({ display: 'flex', gap: '10px', marginTop: '16px' })}>
              <button type="submit" form="entry-form" mix={primaryButtonStyle}>
                {mode === 'edit' ? 'Save entry' : 'Create entry'}
              </button>
              <a href={routes.admin.content.index.href({ type: contentType.apiId })} mix={secondaryButtonStyle}>
                Cancel
              </a>
              {entry ? (
                <a
                  href={routes.admin.content.confirmDestroy.href({
                    type: contentType.apiId,
                    entryId: String(entry.id),
                  })}
                  mix={[
                    dangerButtonStyle,
                    css({
                      marginLeft: 'auto',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }),
                  ]}
                >
                  Delete entry
                </a>
              ) : null}
            </div>
          </>
        )}

        {mode === 'edit' && entry ? (
          <div mix={[cardStyle, css({ marginTop: '20px' })]}>
            <h2 mix={css({ margin: '0 0 6px', fontSize: '15px' })}>Releases</h2>
            {entryReleases.length > 0 ? (
              <p mix={css({ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-tertiary)' })}>
                In: {entryReleases.map((release) => release.name).join(', ')}
              </p>
            ) : (
              <p mix={css({ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-tertiary)' })}>
                Stage this entry to publish or unpublish as part of a release.
              </p>
            )}
            {openReleases.length === 0 ? (
              <p mix={css({ margin: 0, fontSize: '13px', color: 'var(--text-tertiary)' })}>
                No open releases.{' '}
                <a href={routes.admin.releases.index.href()}>Create one</a> to schedule this
                entry.
              </p>
            ) : (
              <form
                method="POST"
                action={routes.admin.releases.addItem.href()}
                mix={css({ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' })}
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
                <button type="submit" mix={secondaryButtonStyle}>
                  Add to release
                </button>
              </form>
            )}
          </div>
        ) : null}

        {mode === 'edit' && entry ? (
          <div mix={[cardStyle, css({ marginTop: '20px' })]}>
            <h2 mix={css({ margin: '0 0 6px', fontSize: '15px' })}>Scheduling</h2>
            <p mix={css({ margin: '0 0 12px', fontSize: '13px', color: 'var(--text-tertiary)' })}>
              Set timers for this entry alone (server time). Leave a field blank to clear
              that timer.
            </p>
            <form
              method="POST"
              action={routes.admin.content.schedule.href({
                type: contentType.apiId,
                entryId: String(entry.id),
              })}
              mix={css({ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' })}
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
              <button type="submit" mix={secondaryButtonStyle}>
                Save schedule
              </button>
            </form>
            {entry.publishAt || entry.unpublishAt ? (
              <p mix={css({ margin: '10px 0 0', fontSize: '13px', color: 'var(--brand)' })}>
                Scheduled:{' '}
                {[
                  entry.publishAt ? `publishes ${formatWhen(entry.publishAt)}` : null,
                  entry.unpublishAt ? `unpublishes ${formatWhen(entry.unpublishAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(', ')}
                .
              </p>
            ) : null}
          </div>
        ) : null}
      </AdminShell>
    )
  }
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

function LocaleBadge(handle: Handle<{ code: string }>) {
  return () => (
    <span
      mix={css({
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 600,
        fontFamily: 'ui-monospace, monospace',
        color: 'var(--brand)',
        background: 'var(--surface-2)',
      })}
    >
      {handle.props.code}
    </span>
  )
}

const scheduleLabelStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 600,
})

const scheduleInputStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '14px',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
})

const releaseSelectStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '13px',
  padding: '8px 10px',
  borderRadius: '7px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
})

const localeTabsStyle = css({ display: 'flex', gap: '6px', flexWrap: 'wrap' })

const localeTabStyle = css({
  padding: '7px 14px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-primary)',
  textDecoration: 'none',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  '&:hover': { background: 'var(--surface-2)' },
})

const localeTabActiveStyle = css({
  padding: '7px 14px',
  borderRadius: '8px',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--brand)',
  textDecoration: 'none',
  border: '1px solid var(--brand)',
  background: 'var(--surface-2)',
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

const searchFormStyle = css({ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' })

const searchInputStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '14px',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  flex: '1 1 220px',
  minWidth: '180px',
})

const paginationStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  flexWrap: 'wrap',
})

const paginationDisabledStyle = css({
  padding: '9px 16px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border)',
  opacity: 0.5,
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
