import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '#app/middleware/auth.ts'
import { listContentTypes, type ContentType } from '#app/data/content-types.server.ts'
import { findEntry, type Entry } from '#app/data/entries.server.ts'
import {
  addReleaseItem,
  countReleaseItems,
  createRelease,
  deleteRelease,
  entriesForReleaseItems,
  findRelease,
  listReleaseItems,
  listReleases,
  publishRelease,
  removeReleaseItem,
  runDueReleases,
  updateRelease,
  type Release,
  type ReleaseAction,
  type ReleaseItem,
} from '#app/data/releases.server.ts'
import { logAudit } from '#app/data/audit.server.ts'
import { entryLabel } from '#app/utils/fields.ts'
import { formatWhen, parseScheduledAt, toDatetimeLocal } from '#app/utils/schedule.ts'
import { routes } from '#app/routes.ts'
import {
  AdminShell,
  cardStyle,
  dangerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '#app/ui/admin-shell.tsx'
import { Pagination } from '#app/ui/pagination.tsx'
import { paginateList, pageHref } from '#app/utils/pagination.ts'

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

function notFound() {
  return new Response('Not Found', { status: 404 })
}

export default createController(routes.admin.releases, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      // Fire anything due so the admin always sees the true current state.
      await runDueReleases(db)

      let { pagination, items: releases } = paginateList(
        await listReleases(db),
        context.url.searchParams.get('page'),
      )
      let itemCounts = new Map<number, number>()
      for (let release of releases) {
        itemCounts.set(release.id, await countReleaseItems(db, release.id))
      }

      let session = context.get(Session)!
      let flash = session.get('message')
      return context.render(
        <ReleasesIndexPage
          releases={releases}
          itemCounts={itemCounts}
          contentTypes={await listContentTypes(db)}
          user={currentUser(context)}
          flash={typeof flash === 'string' ? flash : null}
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
        />,
      )
    },

    async create(context) {
      let db = context.get(Database)!
      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim()
      let scheduledAt = parseScheduledAt(String(formData.get('scheduled_at') ?? ''))

      if (name === '') {
        context.get(Session)!.flash('message', 'A release needs a name.')
        return redirect(routes.admin.releases.index.href(), 303)
      }

      let release = await createRelease(db, name, scheduledAt)
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'release.created',
        'release',
        release.id,
        `Created release "${release.name}"`,
      )
      context.get(Session)!.flash('message', `Release "${release.name}" created.`)
      return redirect(routes.admin.releases.show.href({ releaseId: String(release.id) }), 303)
    },

    async show(context) {
      let db = context.get(Database)!
      await runDueReleases(db)

      let id = Number(context.params.releaseId)
      let release = Number.isInteger(id) ? await findRelease(db, id) : null
      if (!release) return notFound()

      let items = await listReleaseItems(db, release.id)
      let entriesById = await entriesForReleaseItems(db, items)
      let contentTypes = await listContentTypes(db)

      let session = context.get(Session)!
      let flash = session.get('message')
      return context.render(
        <ReleaseShowPage
          release={release}
          items={items}
          entriesById={entriesById}
          contentTypes={contentTypes}
          user={currentUser(context)}
          flash={typeof flash === 'string' ? flash : null}
        />,
      )
    },

    async update(context) {
      let db = context.get(Database)!
      let id = Number(context.params.releaseId)
      let release = Number.isInteger(id) ? await findRelease(db, id) : null
      if (!release) return notFound()

      let session = context.get(Session)!
      if (release.status === 'published') {
        session.flash('message', 'A published release cannot be edited.')
        return redirect(routes.admin.releases.show.href({ releaseId: String(release.id) }), 303)
      }

      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim() || release.name
      let scheduledAt = parseScheduledAt(String(formData.get('scheduled_at') ?? ''))

      await updateRelease(db, release.id, { name, scheduledAt })
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'release.updated',
        'release',
        release.id,
        `Updated release "${name}"`,
      )
      session.flash('message', 'Release saved.')
      return redirect(routes.admin.releases.show.href({ releaseId: String(release.id) }), 303)
    },

    async destroy(context) {
      let db = context.get(Database)!
      let id = Number(context.params.releaseId)
      let release = Number.isInteger(id) ? await findRelease(db, id) : null
      if (release) {
        await deleteRelease(db, release.id)
        await logAudit(
          db,
          currentUser(context)?.email ?? 'system',
          'release.deleted',
          'release',
          release.id,
          `Deleted release "${release.name}"`,
        )
        context.get(Session)!.flash('message', `Release "${release.name}" deleted.`)
      }
      return redirect(routes.admin.releases.index.href(), 303)
    },

    async publish(context) {
      let db = context.get(Database)!
      let id = Number(context.params.releaseId)
      let release = Number.isInteger(id) ? await findRelease(db, id) : null
      if (!release) return notFound()

      let session = context.get(Session)!
      if (release.status === 'published') {
        session.flash('message', 'This release was already published.')
      } else {
        await publishRelease(db, release.id)
        await logAudit(
          db,
          currentUser(context)?.email ?? 'system',
          'release.published',
          'release',
          release.id,
          `Published release "${release.name}"`,
        )
        session.flash('message', `Release "${release.name}" published.`)
      }
      return redirect(routes.admin.releases.show.href({ releaseId: String(release.id) }), 303)
    },

    // Posted from an entry's edit page ("Add to release"). Redirects back to
    // the entry so authors stay in their editing flow.
    async addItem(context) {
      let db = context.get(Database)!
      let formData = context.get(FormData)!
      let id = Number(formData.get('release_id'))
      let release = Number.isInteger(id) ? await findRelease(db, id) : null
      if (!release || release.status === 'published') return notFound()

      let entryId = Number(formData.get('entry_id'))
      let action: ReleaseAction =
        String(formData.get('action') ?? 'publish') === 'unpublish' ? 'unpublish' : 'publish'

      let entry = Number.isInteger(entryId) ? await findEntry(db, entryId) : null
      if (!entry) return notFound()

      let contentTypes = await listContentTypes(db)
      let contentType = contentTypes.find((type) => type.id === entry.contentTypeId)
      if (!contentType) return notFound()

      let session = context.get(Session)!
      let added = await addReleaseItem(db, release.id, entry.id, action)
      if (added) {
        await logAudit(
          db,
          currentUser(context)?.email ?? 'system',
          'release.item_added',
          'release',
          release.id,
          `Staged "${entryLabel(entry.id, entry.data, contentType.fields)}" (${contentType.name}) to ${action} in release "${release.name}"`,
        )
      }
      session.flash(
        'message',
        added
          ? `Added to release "${release.name}".`
          : `Already in release "${release.name}".`,
      )
      return redirect(
        routes.admin.content.editForm.href({
          type: contentType.apiId,
          entryId: String(entry.id),
        }),
        303,
      )
    },

    async removeItem(context) {
      let db = context.get(Database)!
      let id = Number(context.params.releaseId)
      let release = Number.isInteger(id) ? await findRelease(db, id) : null
      if (!release) return notFound()

      let itemId = Number(context.params.itemId)
      if (Number.isInteger(itemId)) {
        await removeReleaseItem(db, itemId)
        await logAudit(
          db,
          currentUser(context)?.email ?? 'system',
          'release.item_removed',
          'release',
          release.id,
          `Removed an entry from release "${release.name}"`,
        )
      }
      context.get(Session)!.flash('message', 'Removed from release.')
      return redirect(routes.admin.releases.show.href({ releaseId: String(release.id) }), 303)
    },
  },
})

// ----- Pages -----

interface IndexProps {
  releases: Release[]
  itemCounts: Map<number, number>
  contentTypes: ContentType[]
  user?: AuthUser
  flash?: string | null
  page: number
  totalPages: number
  total: number
}

function ReleasesIndexPage(handle: Handle<IndexProps>) {
  return () => {
    let { releases, itemCounts, contentTypes, user, flash, page, totalPages, total } = handle.props

    return (
      <AdminShell
        heading="Releases"
        activeNav="releases"
        contentTypes={contentTypes}
        user={user}
        flash={flash}
      >
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          {total === 0 ? (
            <div mix={cardStyle}>
              <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
                No releases yet. Create one to group content changes and publish them together,
                on a schedule or on demand.
              </p>
            </div>
          ) : (
            <div mix={cardStyle}>
              <table mix={tableStyle}>
                <thead>
                  <tr>
                    <th mix={thStyle}>Release</th>
                    <th mix={thStyle}>Entries</th>
                    <th mix={thStyle}>Status</th>
                    <th mix={thStyle}>When</th>
                    <th mix={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {releases.map((release) => (
                    <tr>
                      <td mix={tdStyle}>{release.name}</td>
                      <td mix={tdStyle}>{itemCounts.get(release.id) ?? 0}</td>
                      <td mix={tdStyle}>
                        <ReleaseStatusBadge release={release} />
                      </td>
                      <td mix={tdStyle}>
                        {release.status === 'published' && release.publishedAt
                          ? `Published ${formatWhen(release.publishedAt)}`
                          : release.scheduledAt
                            ? `Scheduled for ${formatWhen(release.scheduledAt)}`
                            : 'Not scheduled'}
                      </td>
                      <td mix={tdActionsStyle}>
                        <a
                          href={routes.admin.releases.show.href({
                            releaseId: String(release.id),
                          })}
                          mix={secondaryButtonStyle}
                        >
                          Open
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
            noun="release"
            prevHref={pageHref(routes.admin.releases.index.href(), page - 1, totalPages)}
            nextHref={pageHref(routes.admin.releases.index.href(), page + 1, totalPages)}
          />

          <div mix={cardStyle}>
            <h2 mix={css({ margin: '0 0 12px', fontSize: '15px' })}>New release</h2>
            <form
              method="POST"
              action={routes.admin.releases.create.href()}
              mix={css({ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' })}
            >
              <label mix={fieldLabelStyle}>
                <span>Name</span>
                <input
                  type="text"
                  name="name"
                  placeholder="Summer blowout sale"
                  mix={[inputStyle, css({ minWidth: '260px' })]}
                />
              </label>
              <label mix={fieldLabelStyle}>
                <span>Publish at (optional)</span>
                <input type="datetime-local" name="scheduled_at" mix={inputStyle} />
              </label>
              <button type="submit" mix={primaryButtonStyle}>
                Create release
              </button>
            </form>
          </div>
        </div>
      </AdminShell>
    )
  }
}

interface ShowProps {
  release: Release
  items: ReleaseItem[]
  entriesById: Map<number, Entry>
  contentTypes: ContentType[]
  user?: AuthUser
  flash?: string | null
}

function ReleaseShowPage(handle: Handle<ShowProps>) {
  return () => {
    let { release, items, entriesById, contentTypes, user, flash } = handle.props
    let open = release.status === 'open'

    return (
      <AdminShell
        heading={release.name}
        activeNav="releases"
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        actions={
          <span mix={css({ display: 'flex', gap: '10px', alignItems: 'center' })}>
            <ReleaseStatusBadge release={release} />
            {open ? (
              <form
                method="POST"
                action={routes.admin.releases.publish.href({ releaseId: String(release.id) })}
              >
                <button type="submit" mix={primaryButtonStyle}>
                  Publish now
                </button>
              </form>
            ) : null}
          </span>
        }
      >
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          {open ? (
            <div mix={cardStyle}>
              <h2 mix={css({ margin: '0 0 12px', fontSize: '15px' })}>Settings</h2>
              <form
                method="POST"
                action={routes.admin.releases.update.href({ releaseId: String(release.id) })}
                mix={css({ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' })}
              >
                <label mix={fieldLabelStyle}>
                  <span>Name</span>
                  <input
                    type="text"
                    name="name"
                    value={release.name}
                    mix={[inputStyle, css({ minWidth: '260px' })]}
                  />
                </label>
                <label mix={fieldLabelStyle}>
                  <span>Publish at (blank = manual)</span>
                  <input
                    type="datetime-local"
                    name="scheduled_at"
                    value={release.scheduledAt ? toDatetimeLocal(release.scheduledAt) : ''}
                    mix={inputStyle}
                  />
                </label>
                <button type="submit" mix={secondaryButtonStyle}>
                  Save
                </button>
              </form>
              {release.scheduledAt ? (
                <p mix={css({ margin: '10px 0 0', fontSize: '13px', color: 'var(--text-tertiary)' })}>
                  This release fires automatically at {formatWhen(release.scheduledAt)} (server
                  time). Entries staged to publish stay drafts until then.
                </p>
              ) : (
                <p mix={css({ margin: '10px 0 0', fontSize: '13px', color: 'var(--text-tertiary)' })}>
                  No schedule set. Publish it manually with "Publish now", or set a time above.
                </p>
              )}
            </div>
          ) : null}

          <div mix={cardStyle}>
            <h2 mix={css({ margin: '0 0 12px', fontSize: '15px' })}>
              Entries in this release
            </h2>
            {items.length === 0 ? (
              <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
                Nothing staged yet. Open an entry in the Content Manager and use "Add to
                release".
              </p>
            ) : (
              <table mix={tableStyle}>
                <thead>
                  <tr>
                    <th mix={thStyle}>Entry</th>
                    <th mix={thStyle}>Type</th>
                    <th mix={thStyle}>Current status</th>
                    <th mix={thStyle}>On release</th>
                    <th mix={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    let entry = entriesById.get(item.entryId)
                    let contentType = entry
                      ? contentTypes.find((type) => type.id === entry.contentTypeId)
                      : undefined
                    return (
                      <tr>
                        <td mix={tdStyle}>
                          {entry && contentType ? (
                            <a
                              href={routes.admin.content.editForm.href({
                                type: contentType.apiId,
                                entryId: String(entry.id),
                              })}
                            >
                              {entryLabel(entry.id, entry.data, contentType.fields)}
                            </a>
                          ) : (
                            `Entry #${item.entryId} (deleted)`
                          )}
                        </td>
                        <td mix={tdStyle}>{contentType?.name ?? ''}</td>
                        <td mix={tdStyle}>{entry?.status ?? ''}</td>
                        <td mix={tdStyle}>
                          <ActionBadge action={item.action} />
                        </td>
                        <td mix={tdActionsStyle}>
                          {open ? (
                            <form
                              method="POST"
                              action={routes.admin.releases.removeItem.href({
                                releaseId: String(release.id),
                                itemId: String(item.id),
                              })}
                            >
                              <button type="submit" mix={dangerButtonStyle}>
                                Remove
                              </button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div mix={css({ display: 'flex', gap: '10px' })}>
            <a href={routes.admin.releases.index.href()} mix={secondaryButtonStyle}>
              Back to releases
            </a>
            <form
              method="POST"
              action={routes.admin.releases.destroy.href({ releaseId: String(release.id) })}
              mix={css({ marginLeft: 'auto' })}
            >
              <button type="submit" mix={dangerButtonStyle}>
                Delete release
              </button>
            </form>
          </div>
        </div>
      </AdminShell>
    )
  }
}

function ReleaseStatusBadge(handle: Handle<{ release: Release }>) {
  return () => {
    let release = handle.props.release
    let published = release.status === 'published'
    let scheduled = !published && release.scheduledAt != null
    return (
      <span
        mix={css({
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 10px',
          borderRadius: '999px',
          fontSize: '12px',
          fontWeight: 600,
          color: published ? 'var(--success)' : scheduled ? 'var(--brand)' : 'var(--text-tertiary)',
          background: published ? 'rgba(48, 164, 108, 0.14)' : 'var(--surface-2)',
        })}
      >
        {published ? 'Published' : scheduled ? 'Scheduled' : 'Open'}
      </span>
    )
  }
}

function ActionBadge(handle: Handle<{ action: 'publish' | 'unpublish' }>) {
  return () => {
    let publish = handle.props.action === 'publish'
    return (
      <span
        mix={css({
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 10px',
          borderRadius: '999px',
          fontSize: '12px',
          fontWeight: 600,
          color: publish ? 'var(--success)' : 'var(--danger)',
          background: 'var(--surface-2)',
        })}
      >
        {publish ? 'Publish' : 'Unpublish'}
      </span>
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
const tdActionsStyle = css({
  padding: '12px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'right',
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
})
