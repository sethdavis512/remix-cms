import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { ContentType } from '../data/content-types.server.ts'
import { routes } from '../routes.ts'
import { Document } from './document.tsx'
import { Icon, type IconName } from './icon.tsx'

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
    | 'media'
    | 'releases'
    | 'flags'
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
              <a href={routes.admin.index.href()} mix={brandStyle} aria-label="Remix CMS">
                <RemixWordmark />
              </a>

              <nav mix={navStyle}>
                <NavLink
                  href={routes.admin.index.href()}
                  label="Dashboard"
                  icon="Dashboard"
                  active={activeNav === 'dashboard'}
                />
                <NavLink
                  href={routes.admin.types.index.href()}
                  label="Content-Type Builder"
                  icon="Blocks"
                  active={activeNav === 'types'}
                />
                <NavLink
                  href={routes.admin.components.index.href()}
                  label="Components"
                  icon="Box"
                  active={activeNav === 'components'}
                />
                <NavLink
                  href={routes.admin.locales.index.href()}
                  label="Locales"
                  icon="Globe"
                  active={activeNav === 'locales'}
                />
                <NavLink
                  href={routes.admin.media.index.href()}
                  label="Media Library"
                  icon="Image"
                  active={activeNav === 'media'}
                />
                <NavLink
                  href={routes.admin.releases.index.href()}
                  label="Releases"
                  icon="Rocket"
                  active={activeNav === 'releases'}
                />
                <NavLink
                  href={routes.admin.flags.index.href()}
                  label="Feature Flags"
                  icon="Flag"
                  active={activeNav === 'flags'}
                />
                <NavLink
                  href={routes.admin.webhooks.index.href()}
                  label="Webhooks"
                  icon="Webhook"
                  active={activeNav === 'webhooks'}
                />
                <NavLink
                  href={routes.admin.tokens.index.href()}
                  label="API Tokens"
                  icon="KeyRound"
                  active={activeNav === 'tokens'}
                />
                <NavLink
                  href={routes.admin.users.index.href()}
                  label="Users"
                  icon="Users"
                  active={activeNav === 'users'}
                />
                <NavLink
                  href={routes.admin.audit.index.href()}
                  label="Audit log"
                  icon="ScrollText"
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
                      icon="Folder"
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
                    <Icon name="LogOut" size={16} />
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

function NavLink(
  handle: Handle<{ href: string; label: string; icon?: IconName; active?: boolean }>,
) {
  return () => {
    let { href, label, icon, active } = handle.props
    return (
      <a href={href} mix={active ? navLinkActiveStyle : navLinkStyle}>
        {icon ? <Icon name={icon} size={16} /> : null}
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
  display: 'block',
  color: 'var(--text-primary)',
  textDecoration: 'none',
  padding: '6px 12px 14px',
})

// The Remix wordmark from api.remix.run/remix-wordmark-dark-mode.svg, inlined
// with fill="currentColor" (the dark/light official variants differ only in
// fill), so it follows the sidebar text color in both themes.
function RemixWordmark(_handle: Handle) {
  return () => (
    <svg
      width="132"
      height="13"
      viewBox="0 0 1280 126"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-hidden="true"
    >
      <g clip-path="url(#brand-clip)">
        <path
          d="M237.117 0.1427L237.114 0.14563V0.14856C270.246 0.14856 293.134 15.0178 288.241 33.3605L284.926 45.7804C280.032 64.1231 249.21 78.9923 216.078 78.9923H212.688L282.282 124.627H170.547L114.289 81.2013C112.037 79.7572 109.423 78.9904 106.751 78.9904H12.7041L21.5664 45.7765H186.293C192.486 45.7765 198.251 42.9956 199.167 39.5656H199.17C200.085 36.1355 195.804 33.3546 189.608 33.3546H24.8799L33.7402 0.1427H237.117ZM90.877 90.4552C93.9979 90.4552 96.2711 93.4279 95.4629 96.4562L87.9492 124.623H0.53125L9.64648 90.4552H90.877Z"
          fill="currentColor"
        />
      </g>
      <path d="M895.661 125.247L928.962 0.976562H1016.89L983.381 125.247H895.661Z" fill="currentColor" />
      <path
        d="M564.053 0.976929H848.738C886.912 0.976929 913.31 18.0336 907.624 39.1515L884.476 125.247H796.756L808.736 80.7779L815.64 55.3959L818.279 45.6492C819.904 39.3545 811.985 34.0751 800.41 34.0751H775.435C775.232 35.6995 775.232 37.3239 774.622 39.1515L751.677 125.247H663.754L675.734 80.7779L682.638 55.3959L685.278 45.6492C686.902 39.3545 678.983 34.0751 667.409 34.0751H643.042L618.472 125.247H530.752L564.053 0.976929Z"
        fill="currentColor"
      />
      <path
        d="M1147.53 21.5391L1177.72 1.72852H1279.7L1187.2 62.4297L1247.28 124.354H1145.3L1124.89 103.32L1092.84 124.354H990.856L1085.22 62.4297L1026.33 1.72852H1128.31L1147.53 21.5391Z"
        fill="currentColor"
      />
      <path
        d="M391.163 0.977295H553.832L545.1 34.075H403.165C403.076 34.075 402.987 34.0763 402.898 34.0769H382.405L379.167 46.4353H379.211L379.204 46.4617H541.649L532.918 79.7625H370.269L370.066 80.7781C368.239 87.0726 376.158 92.1491 387.732 92.1492H529.466L520.531 125.247H339.405C301.23 125.247 274.834 108.19 280.519 87.2751L293.311 39.1511C293.598 38.085 293.962 37.0298 294.398 35.9861L303.571 0.976318H391.163V0.977295Z"
        fill="currentColor"
      />
      <defs>
        <clipPath id="brand-clip">
          <rect width="289.012" height="125.197" fill="white" transform="translate(0 0.0499268)" />
        </clipPath>
      </defs>
    </svg>
  )
}

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
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '8px 12px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--text-primary)',
  textDecoration: 'none',
  '&:hover': { background: 'var(--surface-2)' },
})

const navLinkActiveStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
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
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
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
