import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '../../middleware/auth.ts'
import { listContentTypes, type ContentType } from '../../data/content-types.server.ts'
import { routes } from '../../routes.ts'
import { AdminShell, cardStyle, primaryButtonStyle } from '../../ui/admin-shell.tsx'

export default createController(routes.admin, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let contentTypes = await listContentTypes(db)
      let auth = context.get(Auth)
      let user = auth?.ok ? auth.identity : undefined
      return context.render(<DashboardPage contentTypes={contentTypes} user={user} />)
    },
  },
})

function DashboardPage(handle: Handle<{ contentTypes: ContentType[]; user?: AuthUser }>) {
  return () => {
    let { contentTypes, user } = handle.props

    return (
      <AdminShell
        heading="Dashboard"
        activeNav="dashboard"
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
            <h2 mix={css({ margin: '0 0 8px', fontSize: '17px', fontWeight: 650, letterSpacing: '-0.01em' })}>
              Welcome to Remix CMS
            </h2>
            <p mix={css({ margin: '0 0 18px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6, maxWidth: '52ch' })}>
              Start by defining a content type. Give it a name and some fields, then create and
              publish entries that are served over the headless API.
            </p>
            <a href={routes.admin.types.newForm.href()} mix={primaryButtonStyle}>
              Create your first content type
            </a>
          </div>
        ) : (
          <div mix={gridStyle}>
            {contentTypes.map((type) => (
              <a href={routes.admin.content.index.href({ type: type.apiId })} mix={typeCardStyle}>
                <span mix={css({ fontSize: '15px', fontWeight: 650, letterSpacing: '-0.01em' })}>
                  {type.name}
                </span>
                <span
                  mix={css({
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: '12.5px',
                    color: 'var(--brand)',
                  })}
                >
                  /api/{type.apiIdPlural}
                </span>
                <span mix={css({ fontSize: '12.5px', color: 'var(--text-tertiary)' })}>
                  {type.fields.length} field{type.fields.length === 1 ? '' : 's'} · {type.kind}
                </span>
              </a>
            ))}
          </div>
        )}
      </AdminShell>
    )
  }
}

const gridStyle = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: '16px',
})

const typeCardStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '7px',
  padding: '18px',
  borderRadius: '12px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  textDecoration: 'none',
  boxShadow: 'var(--shadow-sm)',
  transition: 'border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease',
  '&:hover': {
    borderColor: 'var(--brand)',
    boxShadow: 'var(--shadow-md)',
    transform: 'translateY(-2px)',
  },
  '&:focus-visible': { outline: '2px solid var(--brand)', outlineOffset: '2px' },
})
