import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '../../../middleware/auth.ts'
import { listContentTypes, type ContentType } from '../../../data/content-types.server.ts'
import {
  createLocale,
  deleteLocale,
  findLocale,
  findLocaleByCode,
  listLocales,
  type Locale,
} from '../../../data/locales.server.ts'
import { countEntriesInLocale } from '../../../data/entries.server.ts'
import { logAudit } from '../../../data/audit.server.ts'
import { routes } from '../../../routes.ts'
import {
  AdminShell,
  cardStyle,
  dangerButtonStyle,
  primaryButtonStyle,
} from '../../../ui/admin-shell.tsx'
import { Pagination } from '../../../ui/pagination.tsx'
import { paginateList, pageHref } from '../../../utils/pagination.ts'

// Locale settings for i18n. The default locale is seeded by the migration and
// cannot be deleted; locales still referenced by entries cannot be deleted
// either, so entries never point at a locale that no longer exists.

// BCP-47-ish: "en", "fr-ca", "pt-br". Kept deliberately loose.
const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

export default createController(routes.admin.locales, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let flash = session.get('message')
      let { pagination, items } = paginateList(
        await listLocales(db),
        context.url.searchParams.get('page'),
      )
      return context.render(
        <LocalesPage
          locales={items}
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
      let code = String(formData.get('code') ?? '').trim().toLowerCase()
      let name = String(formData.get('name') ?? '').trim()

      let error: string | null = null
      if (!LOCALE_CODE_PATTERN.test(code)) {
        error = 'Locale code must look like "fr" or "fr-ca".'
      } else if (await findLocaleByCode(db, code)) {
        error = `The locale "${code}" already exists.`
      }

      if (error) {
        let { pagination, items } = paginateList(
          await listLocales(db),
          context.url.searchParams.get('page'),
        )
        return context.render(
          <LocalesPage
            locales={items}
            contentTypes={await listContentTypes(db)}
            user={currentUser(context)}
            error={error}
            codeValue={code}
            nameValue={name}
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
          />,
          { status: 400 },
        )
      }

      let created = await createLocale(db, code, name || code)
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'locale.created',
        'locale',
        created.id,
        `Created locale "${created.code}"`,
      )
      context.get(Session)!.flash('message', `Locale "${code}" added.`)
      return redirect(routes.admin.locales.index.href(), 303)
    },

    async destroy(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let id = Number(context.params.localeId)
      let locale = Number.isInteger(id) ? await findLocale(db, id) : null

      if (locale) {
        if (locale.isDefault) {
          session.flash('message', 'The default locale cannot be deleted.')
        } else if ((await countEntriesInLocale(db, locale.code)) > 0) {
          session.flash('message', `Cannot delete "${locale.code}": entries still use it.`)
        } else {
          await deleteLocale(db, locale.id)
          await logAudit(
            db,
            currentUser(context)?.email ?? 'system',
            'locale.deleted',
            'locale',
            locale.id,
            `Deleted locale "${locale.code}"`,
          )
          session.flash('message', `Locale "${locale.code}" deleted.`)
        }
      }

      return redirect(routes.admin.locales.index.href(), 303)
    },
  },
})

// ----- Pages -----

interface LocalesPageProps {
  locales: Locale[]
  contentTypes: ContentType[]
  user?: AuthUser
  flash?: string | null
  error?: string
  codeValue?: string
  nameValue?: string
  page: number
  totalPages: number
  total: number
}

function LocalesPage(handle: Handle<LocalesPageProps>) {
  return () => {
    let {
      locales,
      contentTypes,
      user,
      flash,
      error,
      codeValue = '',
      nameValue = '',
      page,
      totalPages,
      total,
    } = handle.props

    return (
      <AdminShell
        heading="Locales"
        activeNav="locales"
        contentTypes={contentTypes}
        user={user}
        flash={flash}
      >
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          <div mix={cardStyle}>
            <table mix={tableStyle}>
              <thead>
                <tr>
                  <th mix={thStyle}>Code</th>
                  <th mix={thStyle}>Name</th>
                  <th mix={thStyle}>Default</th>
                  <th mix={thStyle} />
                </tr>
              </thead>
              <tbody>
                {locales.map((locale) => (
                  <tr>
                    <td mix={tdMonoStyle}>{locale.code}</td>
                    <td mix={tdStyle}>{locale.name}</td>
                    <td mix={tdStyle}>{locale.isDefault ? 'Yes' : ''}</td>
                    <td mix={tdActionsStyle}>
                      {locale.isDefault ? null : (
                        <form
                          method="POST"
                          action={routes.admin.locales.destroy.href({
                            localeId: String(locale.id),
                          })}
                        >
                          <button type="submit" mix={dangerButtonStyle}>
                            Delete
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            noun="locale"
            prevHref={pageHref(routes.admin.locales.index.href(), page - 1, totalPages)}
            nextHref={pageHref(routes.admin.locales.index.href(), page + 1, totalPages)}
          />

          <div mix={cardStyle}>
            <h2 mix={css({ margin: '0 0 12px', fontSize: '15px' })}>Add a locale</h2>
            {error ? <p mix={formErrorStyle}>{error}</p> : null}
            <form
              method="POST"
              action={routes.admin.locales.create.href()}
              mix={css({ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' })}
            >
              <label mix={fieldLabelStyle}>
                <span>Code</span>
                <input type="text" name="code" value={codeValue} placeholder="fr" mix={inputStyle} />
              </label>
              <label mix={fieldLabelStyle}>
                <span>Name</span>
                <input type="text" name="name" value={nameValue} placeholder="French" mix={inputStyle} />
              </label>
              <button type="submit" mix={primaryButtonStyle}>
                Add locale
              </button>
            </form>
          </div>
        </div>
      </AdminShell>
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
