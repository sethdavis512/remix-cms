import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { ContentType } from '../data/content-types.server.ts'
import { routes } from '../routes.ts'
import { Document } from './document.tsx'

const FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export interface AdminShellProps {
  title?: string
  heading: string
  contentTypes: ContentType[]
  activeNav?:
    | 'dashboard'
    | 'types'
    | 'components'
    | 'locales'
    | 'releases'
    | 'webhooks'
    | 'tokens'
    | 'users'
    | 'audit'
    | 'content'
  activeTypeApiId?: string
  user?: { name: string; email: string }
  flash?: string | null
  // Drives the flash banner color. Defaults to 'success' so existing callers
  // that pass a bare `flash` string keep their green confirmation banner.
  flashType?: 'success' | 'info' | 'danger'
  actions?: RemixNode
  children?: RemixNode
}

export function AdminShell(handle: Handle<AdminShellProps>) {
  return () => {
    let {
      title,
      heading,
      contentTypes,
      activeNav,
      activeTypeApiId,
      user,
      flash,
      flashType = 'success',
      actions,
      children,
    } = handle.props

    return (
      <Document title={title ?? `${heading} · Remix CMS`}>
        <div mix={themeStyle}>
          <div mix={layoutStyle}>
            <aside mix={sidebarStyle}>
              <a href={routes.admin.index.href()} mix={brandStyle}>
                Remix<span mix={css({ color: 'var(--brand)' })}>CMS</span>
              </a>

              <nav mix={navStyle}>
                <NavLink
                  href={routes.admin.index.href()}
                  label="Dashboard"
                  active={activeNav === 'dashboard'}
                />
                <NavLink
                  href={routes.admin.types.index.href()}
                  label="Content-Type Builder"
                  active={activeNav === 'types'}
                />
                <NavLink
                  href={routes.admin.components.index.href()}
                  label="Components"
                  active={activeNav === 'components'}
                />
                <NavLink
                  href={routes.admin.locales.index.href()}
                  label="Locales"
                  active={activeNav === 'locales'}
                />
                <NavLink
                  href={routes.admin.releases.index.href()}
                  label="Releases"
                  active={activeNav === 'releases'}
                />
                <NavLink
                  href={routes.admin.webhooks.index.href()}
                  label="Webhooks"
                  active={activeNav === 'webhooks'}
                />
                <NavLink
                  href={routes.admin.tokens.index.href()}
                  label="API Tokens"
                  active={activeNav === 'tokens'}
                />
                <NavLink
                  href={routes.admin.users.index.href()}
                  label="Users"
                  active={activeNav === 'users'}
                />
                <NavLink
                  href={routes.admin.audit.index.href()}
                  label="Audit log"
                  active={activeNav === 'audit'}
                />
              </nav>

              <p mix={navHeadingStyle}>Collections</p>
              <nav mix={navStyle}>
                {contentTypes.length === 0 ? (
                  <span mix={css({ padding: '8px 12px', fontSize: '13px', color: 'var(--text-tertiary)' })}>
                    No content types yet
                  </span>
                ) : (
                  contentTypes.map((type) => (
                    <NavLink
                      href={routes.admin.content.index.href({ type: type.apiId })}
                      label={type.name}
                      active={activeNav === 'content' && activeTypeApiId === type.apiId}
                    />
                  ))
                )}
              </nav>

              <div mix={sidebarFooterStyle}>
                {user ? (
                  <div mix={css({ display: 'flex', flexDirection: 'column', gap: '2px' })}>
                    <span mix={css({ fontSize: '13px', fontWeight: 600 })}>{user.name}</span>
                    <span mix={css({ fontSize: '12px', color: 'var(--text-tertiary)' })}>
                      {user.email}
                    </span>
                  </div>
                ) : null}
                <form method="POST" action={routes.auth.logout.href()}>
                  <button type="submit" mix={logoutButtonStyle}>
                    Sign out
                  </button>
                </form>
              </div>
            </aside>

            <main mix={mainStyle}>
              <header mix={topbarStyle}>
                <h1 mix={headingStyle}>{heading}</h1>
                {actions ? <div mix={css({ display: 'flex', gap: '10px' })}>{actions}</div> : null}
              </header>

              {flash ? <div mix={flashStyles[flashType]}>{flash}</div> : null}

              <div mix={contentStyle}>{children}</div>
            </main>
          </div>
        </div>
      </Document>
    )
  }
}

function NavLink(handle: Handle<{ href: string; label: string; active?: boolean }>) {
  return () => {
    let { href, label, active } = handle.props
    return (
      <a href={href} mix={active ? navLinkActiveStyle : navLinkStyle}>
        {label}
      </a>
    )
  }
}

// Shared button styles reused across admin pages.
export const primaryButtonStyle = css({
  font: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '9px 16px',
  borderRadius: '8px',
  border: '1px solid transparent',
  background: 'var(--brand)',
  color: '#fff',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  '&:hover': { background: 'var(--brand-strong)' },
})

export const secondaryButtonStyle = css({
  font: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '9px 16px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  '&:hover': { background: 'var(--surface-2)' },
})

export const dangerButtonStyle = css({
  font: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '7px 12px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--danger)',
  '&:hover': { background: 'var(--danger-soft)' },
})

export const cardStyle = css({
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  borderRadius: '14px',
  padding: '20px',
})

const themeStyle = css({
  '--brand': '#2dacf9',
  '--brand-strong': '#1892e0',
  '--danger': '#e5484d',
  '--danger-soft': 'rgba(229, 72, 77, 0.12)',
  '--success': '#30a46c',
  '--surface-0': '#f4f6f8',
  '--surface-1': '#ffffff',
  '--surface-2': '#eef1f4',
  '--surface-input': '#ffffff',
  '--border': '#dde2e7',
  '--text-primary': '#1c2024',
  '--text-tertiary': '#8b9199',
  '@media (prefers-color-scheme: dark)': {
    '--brand': '#2dacf9',
    '--brand-strong': '#5bbdf9',
    '--danger': '#ff6369',
    '--danger-soft': 'rgba(255, 99, 105, 0.15)',
    '--success': '#3dd68c',
    '--surface-0': '#16191d',
    '--surface-1': '#1e2226',
    '--surface-2': '#282d33',
    '--surface-input': '#16191d',
    '--border': '#31363c',
    '--text-primary': '#e6e9ec',
    '--text-tertiary': '#8b9199',
  },
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
  minHeight: '100vh',
  background: 'var(--surface-0)',
  color: 'var(--text-primary)',
  fontFamily: FONT_STACK,
})

const layoutStyle = css({
  display: 'grid',
  gridTemplateColumns: '248px 1fr',
  minHeight: '100vh',
  '@media (max-width: 720px)': { gridTemplateColumns: '1fr' },
})

const sidebarStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '20px 16px',
  borderRight: '1px solid var(--border)',
  background: 'var(--surface-1)',
})

const brandStyle = css({
  fontSize: '19px',
  fontWeight: 800,
  letterSpacing: '-0.02em',
  color: 'var(--text-primary)',
  textDecoration: 'none',
  padding: '4px 12px 12px',
})

const navStyle = css({ display: 'flex', flexDirection: 'column', gap: '2px' })

const navHeadingStyle = css({
  margin: '16px 0 4px',
  padding: '0 12px',
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-tertiary)',
})

const navLinkStyle = css({
  padding: '8px 12px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--text-primary)',
  textDecoration: 'none',
  '&:hover': { background: 'var(--surface-2)' },
})

const navLinkActiveStyle = css({
  padding: '8px 12px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--brand)',
  background: 'var(--surface-2)',
  textDecoration: 'none',
})

const sidebarFooterStyle = css({
  marginTop: 'auto',
  paddingTop: '16px',
  borderTop: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
})

const logoutButtonStyle = css({
  font: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '8px 12px',
  width: '100%',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-primary)',
  '&:hover': { background: 'var(--surface-2)' },
})

const mainStyle = css({ display: 'flex', flexDirection: 'column', minWidth: 0 })

const topbarStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  padding: '20px 32px',
  borderBottom: '1px solid var(--border)',
})

const headingStyle = css({ margin: 0, fontSize: '20px', fontWeight: 700 })

// Flash banners share a shape but signal outcome through color: green for
// success, blue for neutral info (e.g. unpublished), red for destructive
// outcomes (e.g. deleted) and errors.
const flashBaseStyle = {
  margin: '16px 32px 0',
  padding: '12px 16px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 500,
} as const

const flashStyles = {
  success: css({
    ...flashBaseStyle,
    color: 'var(--success)',
    background: 'rgba(48, 164, 108, 0.12)',
    border: '1px solid rgba(48, 164, 108, 0.3)',
  }),
  info: css({
    ...flashBaseStyle,
    color: 'var(--brand-strong)',
    background: 'rgba(45, 172, 249, 0.12)',
    border: '1px solid rgba(45, 172, 249, 0.35)',
  }),
  danger: css({
    ...flashBaseStyle,
    color: 'var(--danger)',
    background: 'var(--danger-soft)',
    border: '1px solid var(--danger)',
  }),
}

const contentStyle = css({ padding: '24px 32px', maxWidth: '960px' })
