import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { ContentType } from '../data/content-types.server.ts'
import { routes } from '../routes.ts'
import { Document } from './document.tsx'
import { Icon, type IconName } from './icon.tsx'

const FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const MONO_STACK =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"

export interface AdminShellProps {
  title?: string
  heading: string
  contentTypes: ContentType[]
  activeNav?:
    | 'dashboard'
    | 'types'
    | 'components'
    | 'media'
    | 'releases'
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
  // Small uppercase label shown above the page heading (Contentful shows the
  // content type / section name here). Optional; pages that omit it are unchanged.
  eyebrow?: string
  actions?: RemixNode
  // Optional right rail. When provided the main area becomes a two-column
  // Contentful-style editor (content left, sticky rail right) and widens.
  aside?: RemixNode
  children?: RemixNode
}

// Contentful groups its left nav into labelled sections. Everything that isn't
// a content collection lives in one of these; the collections list is rendered
// separately below because it is data-driven.
const NAV_SECTIONS: {
  heading?: string
  items: { key: NonNullable<AdminShellProps['activeNav']>; label: string; icon: IconName; href: () => string }[]
}[] = [
  {
    items: [
      { key: 'dashboard', label: 'Home', icon: 'Dashboard', href: () => routes.admin.index.href() },
    ],
  },
  {
    heading: 'Content',
    items: [
      { key: 'types', label: 'Content model', icon: 'Blocks', href: () => routes.admin.types.index.href() },
      { key: 'components', label: 'Components', icon: 'Box', href: () => routes.admin.components.index.href() },
      { key: 'media', label: 'Media', icon: 'Image', href: () => routes.admin.media.index.href() },
      { key: 'releases', label: 'Releases', icon: 'Rocket', href: () => routes.admin.releases.index.href() },
    ],
  },
  {
    heading: 'Settings',
    items: [
      { key: 'tokens', label: 'API tokens', icon: 'KeyRound', href: () => routes.admin.tokens.index.href() },
      { key: 'users', label: 'Users', icon: 'Users', href: () => routes.admin.users.index.href() },
      { key: 'audit', label: 'Audit log', icon: 'ScrollText', href: () => routes.admin.audit.index.href() },
    ],
  },
]

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
      eyebrow,
      actions,
      aside,
      children,
    } = handle.props

    return (
      <Document title={title ?? `${heading} · Remix CMS`}>
        <div mix={themeStyle}>
          <div mix={layoutStyle}>
            <aside mix={sidebarStyle}>
              {/* Space switcher block: Contentful anchors the sidebar with the
                  space name + active environment. Ours shows the Remix brand and
                  a fixed 'master' environment. */}
              <a href={routes.admin.index.href()} mix={spaceCardStyle} aria-label="Remix CMS">
                <RemixWordmark />
                <span mix={envLabelStyle}>
                  <span mix={envDotStyle} />
                  master
                </span>
              </a>

              <div mix={navScrollStyle}>
                {NAV_SECTIONS.map((section) => (
                  <>
                    {section.heading ? <p mix={navHeadingStyle}>{section.heading}</p> : null}
                    <nav mix={navStyle}>
                      {section.items.map((item) => (
                        <NavLink
                          href={item.href()}
                          label={item.label}
                          icon={item.icon}
                          active={activeNav === item.key}
                        />
                      ))}
                    </nav>
                  </>
                ))}

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
              </div>

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
                <div mix={css({ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 })}>
                  {eyebrow ? <span mix={eyebrowStyle}>{eyebrow}</span> : null}
                  <h1 mix={headingStyle}>{heading}</h1>
                </div>
                {actions ? <div mix={css({ display: 'flex', gap: '10px', flexShrink: 0 })}>{actions}</div> : null}
              </header>

              {flash ? <div mix={flashStyles[flashType]}>{flash}</div> : null}

              {aside ? (
                <div mix={editorLayoutStyle}>
                  <div mix={editorMainStyle}>{children}</div>
                  <div mix={editorAsideStyle}>{aside}</div>
                </div>
              ) : (
                <div mix={contentStyle}>{children}</div>
              )}
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

// Shared button styles reused across admin pages. Primary carries the accent;
// secondary and danger stay quiet (ghost) so a row of controls has a clear
// hierarchy instead of several competing solid fills.
const buttonBase = {
  font: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '9px 15px',
  borderRadius: '7px',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  transition: 'background-color 130ms ease, border-color 130ms ease, color 130ms ease',
  '&:focus-visible': { outline: '2px solid var(--brand)', outlineOffset: '2px' },
} as const

export const primaryButtonStyle = css({
  ...buttonBase,
  border: '1px solid transparent',
  background: 'var(--brand)',
  color: '#fff',
  '&:hover': { background: 'var(--brand-strong)' },
})

export const secondaryButtonStyle = css({
  ...buttonBase,
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-1)',
  color: 'var(--text-secondary)',
  '&:hover': { background: 'var(--surface-2)', color: 'var(--text-primary)' },
})

export const dangerButtonStyle = css({
  ...buttonBase,
  fontSize: '13px',
  padding: '8px 12px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--danger)',
  '&:hover': { background: 'var(--danger-soft)' },
})

export const cardStyle = css({
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  padding: '22px 24px',
  boxShadow: 'var(--shadow-sm)',
})

// Refined-neutral palette: cool, indigo-tinted greys carrying a single
// restrained indigo accent. Neutrals lean very slightly toward the accent hue
// so the whole surface reads as one considered system rather than flat grey.
// A three-tier text ramp (primary / secondary / tertiary) does the hierarchy
// work; --brand-soft backs quiet accent fills (active nav, focus rings).
const themeStyle = css({
  '--brand': '#4c57c4',
  '--brand-strong': '#3d47a5',
  '--brand-soft': 'rgba(76, 87, 196, 0.10)',
  '--danger': '#d63d43',
  '--danger-soft': 'rgba(214, 61, 67, 0.11)',
  '--success': '#2e9e63',
  '--success-soft': 'rgba(46, 158, 99, 0.13)',
  '--surface-0': '#eceef4',
  '--surface-1': '#fcfcfe',
  '--surface-2': '#e6e8f1',
  '--surface-input': '#ffffff',
  '--border': '#dadde8',
  '--border-strong': '#c5c9d8',
  '--text-primary': '#1b1e28',
  '--text-secondary': '#525a6b',
  '--text-tertiary': '#888fa0',
  '--shadow-sm': '0 1px 2px rgba(20, 22, 34, 0.05)',
  '--shadow-md': '0 4px 16px -8px rgba(20, 22, 34, 0.14)',
  '@media (prefers-color-scheme: dark)': {
    '--brand': '#8b93f2',
    '--brand-strong': '#a6acf7',
    '--brand-soft': 'rgba(139, 147, 242, 0.14)',
    '--danger': '#ff6369',
    '--danger-soft': 'rgba(255, 99, 105, 0.15)',
    '--success': '#40c97f',
    '--success-soft': 'rgba(64, 201, 127, 0.14)',
    '--surface-0': '#101219',
    '--surface-1': '#181b23',
    '--surface-2': '#232734',
    '--surface-input': '#101219',
    '--border': '#2a2e3a',
    '--border-strong': '#3a3f4d',
    '--text-primary': '#e6e8ef',
    '--text-secondary': '#a2a9b7',
    '--text-tertiary': '#6f7686',
    '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)',
    '--shadow-md': '0 6px 20px -10px rgba(0, 0, 0, 0.5)',
  },
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
  minHeight: '100vh',
  background: 'var(--surface-0)',
  color: 'var(--text-primary)',
  fontFamily: FONT_STACK,
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
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
  gap: '2px',
  padding: '18px 14px',
  borderRight: '1px solid var(--border)',
  background: 'var(--surface-1)',
  '@media (min-width: 721px)': { position: 'sticky', top: 0, height: '100vh' },
})

// Space switcher card: bordered block holding the brand + environment, the way
// Contentful frames the active space at the top of its sidebar.
const spaceCardStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  margin: '0 4px 8px',
  padding: '12px',
  borderRadius: '9px',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary)',
  textDecoration: 'none',
  '&:hover': { borderColor: 'var(--border-strong)' },
  '&:focus-visible': { outline: '2px solid var(--brand)', outlineOffset: '2px' },
})

const envLabelStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11.5px',
  fontWeight: 600,
  color: 'var(--text-tertiary)',
})

const envDotStyle = css({
  width: '7px',
  height: '7px',
  borderRadius: '999px',
  background: 'var(--success)',
})

// The nav region scrolls independently between the pinned space card and the
// pinned user/footer, so long collection lists never push those off-screen.
const navScrollStyle = css({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
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

const navStyle = css({ display: 'flex', flexDirection: 'column', gap: '1px' })

const navHeadingStyle = css({
  margin: '18px 0 6px',
  padding: '0 12px',
  fontSize: '10.5px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--text-tertiary)',
})

const navLinkBase = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '8px 12px',
  borderRadius: '7px',
  fontSize: '13.5px',
  textDecoration: 'none',
  transition: 'background-color 120ms ease, color 120ms ease',
  '&:focus-visible': { outline: '2px solid var(--brand)', outlineOffset: '-2px' },
} as const

const navLinkStyle = css({
  ...navLinkBase,
  fontWeight: 500,
  color: 'var(--text-secondary)',
  '&:hover': { background: 'var(--surface-2)', color: 'var(--text-primary)' },
})

// Active item: a uniformly filled accent pill. No one-sided rule or border —
// the fill plus brand-colored, heavier text carries the active state.
const navLinkActiveStyle = css({
  ...navLinkBase,
  fontWeight: 600,
  color: 'var(--brand)',
  background: 'var(--brand-soft)',
})

const sidebarFooterStyle = css({
  marginTop: 'auto',
  paddingTop: '16px',
  borderTop: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  paddingLeft: '2px',
  paddingRight: '2px',
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
  borderRadius: '7px',
  border: '1px solid var(--border-strong)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  transition: 'background-color 130ms ease, color 130ms ease',
  '&:hover': { background: 'var(--surface-2)', color: 'var(--text-primary)' },
  '&:focus-visible': { outline: '2px solid var(--brand)', outlineOffset: '2px' },
})

const mainStyle = css({ display: 'flex', flexDirection: 'column', minWidth: 0 })

const topbarStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  padding: '18px 32px',
  borderBottom: '1px solid var(--border)',
  background: 'color-mix(in srgb, var(--surface-1) 82%, transparent)',
  backdropFilter: 'saturate(1.4) blur(8px)',
  position: 'sticky',
  top: 0,
  zIndex: 5,
})

const headingStyle = css({
  margin: 0,
  fontSize: '19px',
  fontWeight: 650,
  letterSpacing: '-0.01em',
  color: 'var(--text-primary)',
})

// Flash banners share a shape but signal outcome through color: green for
// success, blue for neutral info (e.g. unpublished), red for destructive
// outcomes (e.g. deleted) and errors.
const flashBaseStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  margin: '20px 32px 0',
  padding: '11px 16px',
  borderRadius: '9px',
  fontSize: '13.5px',
  fontWeight: 500,
} as const

const flashStyles = {
  success: css({
    ...flashBaseStyle,
    color: 'var(--success)',
    background: 'var(--success-soft)',
    border: '1px solid color-mix(in srgb, var(--success) 32%, transparent)',
  }),
  info: css({
    ...flashBaseStyle,
    color: 'var(--brand-strong)',
    background: 'var(--brand-soft)',
    border: '1px solid color-mix(in srgb, var(--brand) 32%, transparent)',
  }),
  danger: css({
    ...flashBaseStyle,
    color: 'var(--danger)',
    background: 'var(--danger-soft)',
    border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
  }),
}

const contentStyle = css({ padding: '28px 32px 48px', maxWidth: '1000px' })

const eyebrowStyle = css({
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-tertiary)',
})

// Two-column editor: a wide content column plus a fixed-width rail that sticks
// below the topbar as the fields scroll. Collapses to a single column on narrow
// viewports so the rail drops beneath the content.
const editorLayoutStyle = css({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  alignItems: 'start',
  gap: '24px',
  padding: '28px 32px 48px',
  '@media (max-width: 980px)': { gridTemplateColumns: '1fr' },
})

const editorMainStyle = css({ minWidth: 0 })

const editorAsideStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  '@media (min-width: 981px)': { position: 'sticky', top: '90px' },
})
