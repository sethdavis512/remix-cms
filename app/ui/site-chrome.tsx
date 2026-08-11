import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../routes.ts'
import { SANS_STACK, SERIF_STACK } from './site-theme.ts'

// Shared chrome for the public site: <head> extras, the masthead-style header,
// and the colophon footer. Every non-admin page composes these so the surfaces
// read as one publication.

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..700;1,6..72,400..700&family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap'

export function SiteHead(
  handle: Handle<{
    description?: string
    canonical?: string
    ogTitle?: string
    ogType?: 'website' | 'article'
  }>,
) {
  return () => {
    let { description, canonical, ogTitle, ogType = 'website' } = handle.props
    return (
      <>
        <meta name="color-scheme" content="light dark" />
        {description && <meta name="description" content={description} />}
        {canonical && <link rel="canonical" href={canonical} />}
        {ogTitle && <meta property="og:title" content={ogTitle} />}
        {ogTitle && description && <meta property="og:description" content={description} />}
        {ogTitle && canonical && <meta property="og:url" content={canonical} />}
        {ogTitle && <meta property="og:type" content={ogType} />}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preload" as="style" href={FONTS_HREF} />
        <link rel="stylesheet" href={FONTS_HREF} />
      </>
    )
  }
}

const wordmark = css({
  fontFamily: SERIF_STACK,
  fontSize: '20px',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
  textDecoration: 'none',
  '&:hover, &:focus-visible': { color: 'var(--accent)', outline: 'none' },
})

export function Wordmark() {
  return () => (
    <a href={routes.home.href()} mix={wordmark}>
      <span mix={css({ fontStyle: 'italic' })}>Remix</span>
      <span mix={css({ color: 'var(--accent)' })}>CMS</span>
    </a>
  )
}

const navLink = css({
  fontFamily: SANS_STACK,
  fontSize: '13px',
  fontWeight: 500,
  letterSpacing: '0.02em',
  color: 'var(--ink-soft)',
  textDecoration: 'none',
  paddingBottom: '2px',
  borderBottom: '1px solid transparent',
  transition: 'color 120ms ease, border-color 120ms ease',
  '&:hover, &:focus-visible': {
    color: 'var(--accent)',
    borderColor: 'var(--accent)',
    outline: 'none',
  },
})

const navLinkActive = css({
  color: 'var(--ink)',
  borderBottom: '1px solid var(--accent)',
})

export interface SiteHeaderProps {
  showBlogLink?: boolean
  active?: 'blog'
}

export function SiteHeader(handle: Handle<SiteHeaderProps>) {
  return () => {
    let { showBlogLink = false, active } = handle.props

    return (
      <header
        mix={css({
          width: '100%',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '24px',
          padding: '26px 0',
          borderBottom: '1px solid var(--rule)',
        })}
      >
        <Wordmark />
        <nav
          aria-label="Site"
          mix={css({ display: 'flex', alignItems: 'baseline', gap: 'clamp(16px, 3vw, 28px)' })}
        >
          {(showBlogLink || active === 'blog') && (
            <a
              href={routes.blog.index.href()}
              mix={active === 'blog' ? [navLink, navLinkActive] : navLink}
            >
              Blog
            </a>
          )}
          <a href={routes.auth.loginForm.href()} mix={navLink}>
            Sign in
          </a>
          <a href={routes.admin.index.href()} mix={navLink}>
            Admin →
          </a>
        </nav>
      </header>
    )
  }
}

export function SiteFooter() {
  return () => (
    <footer
      mix={css({
        width: '100%',
        marginTop: 'auto',
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '28px 0 40px',
        borderTop: '1px solid var(--rule)',
      })}
    >
      <p mix={[wordmark, css({ margin: 0, fontSize: '16px' })]}>
        <span mix={css({ fontStyle: 'italic' })}>Remix</span>
        <span mix={css({ color: 'var(--accent)' })}>CMS</span>
      </p>
      <p
        mix={css({
          margin: 0,
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          color: 'var(--ink-faint)',
        })}
      >
        Remix v3 · node:sqlite · zero-hydration SSR
      </p>
    </footer>
  )
}
