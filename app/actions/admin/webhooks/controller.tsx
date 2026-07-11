import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '../../../middleware/auth.ts'
import { listContentTypes, type ContentType } from '../../../data/content-types.server.ts'
import {
  ENTRY_EVENTS,
  createWebhook,
  deleteWebhook,
  findWebhook,
  isEntryEvent,
  listWebhooks,
  setWebhookEnabled,
  type EntryEvent,
  type Webhook,
} from '../../../data/webhooks.server.ts'
import { logAudit } from '../../../data/audit.server.ts'
import { routes } from '../../../routes.ts'
import {
  AdminShell,
  cardStyle,
  dangerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../../ui/admin-shell.tsx'
import { Pagination } from '../../../ui/pagination.tsx'
import { paginateList, pageHref } from '../../../utils/pagination.ts'

// Webhooks fire a JSON POST at each subscribed URL when an entry is created,
// updated, deleted, published, or unpublished. Delivery is best-effort: a dead
// endpoint never blocks the admin or the API.

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

function isHttpUrl(value: string): boolean {
  try {
    let url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export default createController(routes.admin.webhooks, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let flash = session.get('message')
      let { pagination, items } = paginateList(
        await listWebhooks(db),
        context.url.searchParams.get('page'),
      )
      return context.render(
        <WebhooksPage
          webhooks={items}
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
      let url = String(formData.get('url') ?? '').trim()
      let events = formData
        .getAll('events')
        .map((value) => String(value))
        .filter(isEntryEvent)

      let error: string | null = null
      if (name === '') {
        error = 'A webhook needs a name.'
      } else if (!isHttpUrl(url)) {
        error = 'The URL must start with http:// or https://.'
      } else if (events.length === 0) {
        error = 'Pick at least one event.'
      }

      if (error) {
        let { pagination, items } = paginateList(
          await listWebhooks(db),
          context.url.searchParams.get('page'),
        )
        return context.render(
          <WebhooksPage
            webhooks={items}
            contentTypes={await listContentTypes(db)}
            user={currentUser(context)}
            error={error}
            nameValue={name}
            urlValue={url}
            eventsValue={events}
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
          />,
          { status: 400 },
        )
      }

      let created = await createWebhook(db, { name, url, events })
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'webhook.created',
        'webhook',
        created.id,
        `Created webhook "${created.name}" (${created.url})`,
      )
      context.get(Session)!.flash('message', `Webhook "${name}" added.`)
      return redirect(routes.admin.webhooks.index.href(), 303)
    },

    async toggle(context) {
      let db = context.get(Database)!
      let id = Number(context.params.webhookId)
      let webhook = Number.isInteger(id) ? await findWebhook(db, id) : null

      if (webhook) {
        await setWebhookEnabled(db, webhook.id, !webhook.enabled)
        await logAudit(
          db,
          currentUser(context)?.email ?? 'system',
          webhook.enabled ? 'webhook.disabled' : 'webhook.enabled',
          'webhook',
          webhook.id,
          `${webhook.enabled ? 'Disabled' : 'Enabled'} webhook "${webhook.name}"`,
        )
        context
          .get(Session)!
          .flash('message', `Webhook "${webhook.name}" ${webhook.enabled ? 'disabled' : 'enabled'}.`)
      }

      return redirect(routes.admin.webhooks.index.href(), 303)
    },

    async destroy(context) {
      let db = context.get(Database)!
      let id = Number(context.params.webhookId)
      let webhook = Number.isInteger(id) ? await findWebhook(db, id) : null

      if (webhook) {
        await deleteWebhook(db, webhook.id)
        await logAudit(
          db,
          currentUser(context)?.email ?? 'system',
          'webhook.deleted',
          'webhook',
          webhook.id,
          `Deleted webhook "${webhook.name}"`,
        )
        context.get(Session)!.flash('message', `Webhook "${webhook.name}" deleted.`)
      }

      return redirect(routes.admin.webhooks.index.href(), 303)
    },
  },
})

// ----- Pages -----

interface WebhooksPageProps {
  webhooks: Webhook[]
  contentTypes: ContentType[]
  user?: AuthUser
  flash?: string | null
  error?: string
  nameValue?: string
  urlValue?: string
  eventsValue?: EntryEvent[]
  page: number
  totalPages: number
  total: number
}

function WebhooksPage(handle: Handle<WebhooksPageProps>) {
  return () => {
    let {
      webhooks,
      contentTypes,
      user,
      flash,
      error,
      nameValue = '',
      urlValue = '',
      eventsValue = [],
      page,
      totalPages,
      total,
    } = handle.props

    return (
      <AdminShell
        heading="Webhooks"
        activeNav="webhooks"
        contentTypes={contentTypes}
        user={user}
        flash={flash}
      >
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          {total === 0 ? (
            <div mix={cardStyle}>
              <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
                No webhooks yet. Add one to get a JSON POST whenever entries are created,
                updated, deleted, published, or unpublished.
              </p>
            </div>
          ) : (
            <div mix={cardStyle}>
              <table mix={tableStyle}>
                <thead>
                  <tr>
                    <th mix={thStyle}>Name</th>
                    <th mix={thStyle}>URL</th>
                    <th mix={thStyle}>Events</th>
                    <th mix={thStyle}>Status</th>
                    <th mix={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map((webhook) => (
                    <tr>
                      <td mix={tdStyle}>{webhook.name}</td>
                      <td mix={tdMonoStyle}>{webhook.url}</td>
                      <td mix={tdMonoStyle}>{webhook.events.join(', ')}</td>
                      <td mix={tdStyle}>
                        <EnabledBadge enabled={webhook.enabled} />
                      </td>
                      <td mix={tdActionsStyle}>
                        <span
                          mix={css({
                            display: 'inline-flex',
                            gap: '8px',
                            justifyContent: 'flex-end',
                          })}
                        >
                          <form
                            method="POST"
                            action={routes.admin.webhooks.toggle.href({
                              webhookId: String(webhook.id),
                            })}
                          >
                            <button type="submit" mix={secondaryButtonStyle}>
                              {webhook.enabled ? 'Disable' : 'Enable'}
                            </button>
                          </form>
                          <form
                            method="POST"
                            action={routes.admin.webhooks.destroy.href({
                              webhookId: String(webhook.id),
                            })}
                          >
                            <button type="submit" mix={dangerButtonStyle}>
                              Delete
                            </button>
                          </form>
                        </span>
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
            noun="webhook"
            prevHref={pageHref(routes.admin.webhooks.index.href(), page - 1, totalPages)}
            nextHref={pageHref(routes.admin.webhooks.index.href(), page + 1, totalPages)}
          />

          <div mix={cardStyle}>
            <h2 mix={css({ margin: '0 0 12px', fontSize: '15px' })}>Add a webhook</h2>
            {error ? <p mix={formErrorStyle}>{error}</p> : null}
            <form
              method="POST"
              action={routes.admin.webhooks.create.href()}
              mix={css({ display: 'flex', flexDirection: 'column', gap: '14px' })}
            >
              <div mix={css({ display: 'flex', gap: '10px', flexWrap: 'wrap' })}>
                <label mix={fieldLabelStyle}>
                  <span>Name</span>
                  <input
                    type="text"
                    name="name"
                    value={nameValue}
                    placeholder="Rebuild site"
                    mix={inputStyle}
                  />
                </label>
                <label mix={[fieldLabelStyle, css({ flex: '1 1 320px' })]}>
                  <span>URL</span>
                  <input
                    type="text"
                    name="url"
                    value={urlValue}
                    placeholder="https://example.com/hooks/cms"
                    mix={inputStyle}
                  />
                </label>
              </div>
              <fieldset mix={fieldsetStyle}>
                <legend mix={legendStyle}>Events</legend>
                <div mix={css({ display: 'flex', gap: '14px', flexWrap: 'wrap' })}>
                  {ENTRY_EVENTS.map((event) => (
                    <label mix={checkboxLabelStyle}>
                      <input
                        type="checkbox"
                        name="events"
                        value={event}
                        checked={eventsValue.includes(event)}
                      />
                      <span mix={css({ fontFamily: 'ui-monospace, monospace', fontSize: '13px' })}>
                        {event}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <button type="submit" mix={primaryButtonStyle}>
                  Add webhook
                </button>
              </div>
            </form>
            <p mix={css({ margin: '12px 0 0', fontSize: '13px', color: 'var(--text-tertiary)' })}>
              Each event sends a JSON POST shaped like {'{'}"event", "occurredAt", "data"{'}'} with
              a 5 second timeout. Delivery is best-effort: failures are logged, never retried.
            </p>
          </div>
        </div>
      </AdminShell>
    )
  }
}

function EnabledBadge(handle: Handle<{ enabled: boolean }>) {
  return () => {
    let enabled = handle.props.enabled
    return (
      <span
        mix={css({
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 10px',
          borderRadius: '999px',
          fontSize: '12px',
          fontWeight: 600,
          color: enabled ? 'var(--success)' : 'var(--text-tertiary)',
          background: enabled ? 'rgba(48, 164, 108, 0.14)' : 'var(--surface-2)',
        })}
      >
        {enabled ? 'Enabled' : 'Disabled'}
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
const tdMonoStyle = css({
  padding: '12px',
  borderBottom: '1px solid var(--border)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: '13px',
  wordBreak: 'break-all',
})
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

const fieldsetStyle = css({
  margin: 0,
  padding: '12px 14px',
  border: '1px solid var(--border)',
  borderRadius: '10px',
})

const legendStyle = css({
  padding: '0 6px',
  fontSize: '13px',
  fontWeight: 600,
})

const checkboxLabelStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '13px',
  cursor: 'pointer',
})

const formErrorStyle = css({
  margin: '0 0 12px',
  padding: '12px 16px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--danger)',
  background: 'var(--danger-soft)',
  border: '1px solid var(--danger)',
})
