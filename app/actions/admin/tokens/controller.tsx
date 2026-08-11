import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '#app/middleware/auth.ts'
import { listContentTypes, type ContentType } from '#app/data/content-types.server.ts'
import {
  createApiToken,
  deleteApiToken,
  findApiToken,
  listApiTokens,
  type ApiToken,
} from '#app/data/api-tokens.server.ts'
import { logAudit } from '#app/data/audit.server.ts'
import {
  REQUIRE_API_TOKEN_KEY,
  isApiTokenRequired,
  setSetting,
} from '#app/data/settings.server.ts'
import { routes } from '#app/routes.ts'
import { AdminShell, cardStyle, dangerButtonStyle, primaryButtonStyle, secondaryButtonStyle } from '#app/ui/admin-shell.tsx'
import {
  ConfirmDeleteCard,
  DataTable,
  EmptyState,
  cardHeadingStyle,
  fieldLabelStyle,
  formErrorStyle,
  inputStyle,
  tdActionsStyle,
  tdStyle,
  thStyle,
} from '#app/ui/primitives.tsx'
import { Pagination } from '#app/ui/pagination.tsx'
import { paginateList, pageHref } from '#app/utils/pagination.ts'
import { flashMessage, readFlash, type FlashType } from '#app/utils/flash.ts'

// API tokens gate the public read API. Gating is controlled by the
// 'require_api_token' setting, toggled on this page: while it is off the API is
// fully public, and while it is on every /api/* request needs a valid
// "Authorization: Bearer <token>" header. Only a hash is stored, so the
// plaintext token is flashed through the session and shown exactly once on the
// page after creation.

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

export default createController(routes.admin.tokens, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let flash = readFlash(session)
      let newToken = session.get('newToken')
      let { pagination, items } = paginateList(
        await listApiTokens(db),
        context.url.searchParams.get('page'),
      )
      return context.render(
        <TokensPage
          tokens={items}
          total={pagination.total}
          page={pagination.page}
          totalPages={pagination.totalPages}
          contentTypes={await listContentTypes(db)}
          requireToken={await isApiTokenRequired(db)}
          user={currentUser(context)}
          flash={flash.message}
          flashType={flash.type}
          newToken={typeof newToken === 'string' ? newToken : null}
        />,
      )
    },

    async create(context) {
      let db = context.get(Database)!
      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim()

      if (name === '') {
        let { pagination, items } = paginateList(
          await listApiTokens(db),
          context.url.searchParams.get('page'),
        )
        return context.render(
          <TokensPage
            tokens={items}
            total={pagination.total}
            page={pagination.page}
            totalPages={pagination.totalPages}
            contentTypes={await listContentTypes(db)}
            requireToken={await isApiTokenRequired(db)}
            user={currentUser(context)}
            error="A token needs a name."
          />,
          { status: 400 },
        )
      }

      let { token, plaintext } = await createApiToken(db, name)
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'api_token.created',
        'api_token',
        token.id,
        `Created API token "${token.name}"`,
      )
      let session = context.get(Session)!
      flashMessage(session, `Token "${token.name}" created.`)
      // Shown exactly once: the flash is consumed by the next index render.
      session.flash('newToken', plaintext)
      return redirect(routes.admin.tokens.index.href(), 303)
    },

    // Toggle whether the public API requires a bearer token. The desired state
    // arrives in a hidden "value" field ('true' or 'false').
    async setRequire(context) {
      let db = context.get(Database)!
      let formData = context.get(FormData)!
      let requireToken = String(formData.get('value') ?? '') === 'true'
      await setSetting(db, REQUIRE_API_TOKEN_KEY, requireToken ? 'true' : 'false')
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'settings.updated',
        'setting',
        null,
        requireToken
          ? 'Turned on required API tokens for the public API'
          : 'Turned off required API tokens (public API)',
      )
      flashMessage(
        context.get(Session)!,
        requireToken ? 'API now requires a bearer token.' : 'API is now public.',
        'info',
      )
      return redirect(routes.admin.tokens.index.href(), 303)
    },

    // Interstitial confirm page: clients using the token stop working the
    // moment it is deleted, so it is never one click.
    async confirmDestroy(context) {
      let db = context.get(Database)!
      let id = Number(context.params.tokenId)
      let token = Number.isInteger(id) ? await findApiToken(db, id) : null
      if (!token) return redirect(routes.admin.tokens.index.href(), 303)

      return context.render(
        <ConfirmDeleteTokenPage
          token={token}
          requireToken={await isApiTokenRequired(db)}
          contentTypes={await listContentTypes(db)}
          user={currentUser(context)}
        />,
      )
    },

    async destroy(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let id = Number(context.params.tokenId)
      let token = Number.isInteger(id) ? await findApiToken(db, id) : null

      if (token) {
        await deleteApiToken(db, token.id)
        await logAudit(
          db,
          currentUser(context)?.email ?? 'system',
          'api_token.deleted',
          'api_token',
          token.id,
          `Deleted API token "${token.name}"`,
        )
        flashMessage(session, `Token "${token.name}" deleted.`, 'danger')
      }

      return redirect(routes.admin.tokens.index.href(), 303)
    },
  },
})

// ----- Pages -----

interface TokensPageProps {
  tokens: ApiToken[]
  total: number
  page: number
  totalPages: number
  contentTypes: ContentType[]
  requireToken: boolean
  user?: AuthUser
  flash?: string | null
  flashType?: FlashType
  newToken?: string | null
  error?: string
}

function TokensPage(handle: Handle<TokensPageProps>) {
  return () => {
    let {
      tokens,
      total,
      page,
      totalPages,
      contentTypes,
      requireToken,
      user,
      flash,
      flashType,
      newToken,
      error,
    } = handle.props

    return (
      <AdminShell
        heading="API Tokens"
        activeNav="tokens"
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        flashType={flashType}
      >
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          <div mix={cardStyle}>
            <h2 mix={css({ margin: '0 0 8px', fontSize: '15px' })}>Public API access</h2>
            <p mix={css({ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-tertiary)' })}>
              {requireToken
                ? 'The public read API requires a valid bearer token on every request.'
                : 'The public read API is open to everyone. No token is required.'}
            </p>
            {requireToken && total === 0 ? (
              <p mix={warningStyle}>
                Required tokens are on but no tokens exist, so the public API is unreachable.
                Create a token below or turn the requirement off.
              </p>
            ) : null}
            <form
              method="POST"
              action={routes.admin.tokens.setRequire.href()}
              mix={css({ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' })}
            >
              <input type="hidden" name="value" value={requireToken ? 'false' : 'true'} />
              <button
                type="submit"
                mix={requireToken ? secondaryButtonStyle : primaryButtonStyle}
              >
                {requireToken ? 'Make API public' : 'Require API tokens'}
              </button>
              <span mix={css({ fontSize: '13px', color: 'var(--text-tertiary)' })}>
                Currently: {requireToken ? 'authentication required' : 'public'}
              </span>
            </form>
          </div>

          {newToken ? (
            <div mix={newTokenCardStyle}>
              <p mix={css({ margin: '0 0 8px', fontSize: '14px', fontWeight: 600 })}>
                Copy your new token now. It will not be shown again.
              </p>
              <code mix={newTokenValueStyle}>{newToken}</code>
              <p mix={css({ margin: '10px 0 0', fontSize: '13px', color: 'var(--text-tertiary)' })}>
                Send it on API requests as an "Authorization: Bearer" header.
              </p>
            </div>
          ) : null}

          {total === 0 ? (
            <EmptyState>
              No tokens yet. Create a token, then turn on "Require API tokens" above to gate the
              public API.
            </EmptyState>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th mix={thStyle}>Name</th>
                  <th mix={thStyle}>Created</th>
                  <th mix={thStyle}>Last used</th>
                  <th mix={thStyle} />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => (
                  <tr>
                    <td mix={tdStyle}>{token.name}</td>
                    <td mix={tdStyle}>{formatWhen(token.createdAt)}</td>
                    <td mix={tdStyle}>
                      {token.lastUsedAt ? formatWhen(token.lastUsedAt) : 'Never'}
                    </td>
                    <td mix={tdActionsStyle}>
                      <a
                        href={routes.admin.tokens.confirmDestroy.href({
                          tokenId: String(token.id),
                        })}
                        mix={dangerButtonStyle}
                      >
                        Delete
                      </a>
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
            noun="token"
            prevHref={pageHref(routes.admin.tokens.index.href(), page - 1, totalPages)}
            nextHref={pageHref(routes.admin.tokens.index.href(), page + 1, totalPages)}
          />

          <div mix={cardStyle}>
            <h2 mix={cardHeadingStyle}>Create a token</h2>
            {error ? <p mix={formErrorStyle}>{error}</p> : null}
            <form
              method="POST"
              action={routes.admin.tokens.create.href()}
              mix={css({ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' })}
            >
              <label mix={fieldLabelStyle}>
                <span>Name</span>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="Production website"
                  mix={[inputStyle, css({ minWidth: '260px' })]}
                />
              </label>
              <button type="submit" mix={primaryButtonStyle}>
                Create token
              </button>
            </form>
            <p mix={css({ margin: '10px 0 0', fontSize: '13px', color: 'var(--text-tertiary)' })}>
              Tokens only take effect while "Require API tokens" is on. Toggle it above to gate
              or open the public API.
            </p>
          </div>
        </div>
      </AdminShell>
    )
  }
}

function ConfirmDeleteTokenPage(
  handle: Handle<{
    token: ApiToken
    requireToken: boolean
    contentTypes: ContentType[]
    user?: AuthUser
  }>,
) {
  return () => {
    let { token, requireToken, contentTypes, user } = handle.props
    return (
      <AdminShell heading="Delete token" activeNav="tokens" contentTypes={contentTypes} user={user}>
        <ConfirmDeleteCard
          title={`Delete "${token.name}"?`}
          warning={
            requireToken
              ? 'API tokens are currently required, so clients using this token will immediately lose access.'
              : null
          }
          confirmLabel="Delete token"
          actionHref={routes.admin.tokens.destroy.href({ tokenId: String(token.id) })}
          cancelHref={routes.admin.tokens.index.href()}
        >
          This permanently deletes the token. Any client still sending it will be rejected once
          "Require API tokens" is on. This cannot be undone.
        </ConfirmDeleteCard>
      </AdminShell>
    )
  }
}

// ----- Styles -----

const warningStyle = css({
  margin: '0 0 14px',
  padding: '12px 16px',
  borderRadius: '10px',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--danger)',
  background: 'var(--danger-soft)',
  border: '1px solid var(--danger)',
})

const newTokenCardStyle = css({
  background: 'var(--surface-1)',
  border: '1px solid var(--brand)',
  borderRadius: '14px',
  padding: '20px',
})

const newTokenValueStyle = css({
  display: 'block',
  padding: '10px 12px',
  borderRadius: '8px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: '13px',
  wordBreak: 'break-all',
  userSelect: 'all',
})
