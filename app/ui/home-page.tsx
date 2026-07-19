import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../routes.ts'
import { Document } from './document.tsx'

const FONT_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"

export function HomePage() {
  return () => (
    <Document title="RemixCMS · Headless CMS on Remix v3" head={<HomeHead />}>
      <main
        mix={css({
          // Light-mode design tokens (default).
          '--surface-0': '#dee2e6',
          '--surface-3': '#f0f4f7',
          '--surface-4': '#f7fbff',
          '--border': '#d4dade',
          '--text-primary': '#313539',
          '--text-secondary': '#5c6672',
          '--text-tertiary': '#94989c',
          '--brand-blue': '#2dacf9',
          '--brand-strong': '#1892e0',
          // Dark-mode overrides.
          '@media (prefers-color-scheme: dark)': {
            '--surface-0': '#1e2226',
            '--surface-3': '#313539',
            '--surface-4': '#363a3e',
            '--border': '#3d4348',
            '--text-primary': '#dee2e6',
            '--text-secondary': '#aeb3b8',
            '--text-tertiary': '#94989c',
          },
          '& *, & *::before, & *::after': { boxSizing: 'border-box' },
          margin: 0,
          padding: '64px 24px',
          minHeight: '100vh',
          background: 'var(--surface-0)',
          color: 'var(--text-primary)',
          fontFamily: FONT_STACK,
          fontSize: '14px',
          lineHeight: 1.5,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        })}
      >
        <div
          mix={css({
            width: '100%',
            maxWidth: '900px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '64px',
          })}
        >
          <Masthead />
          <FeatureGrid />
          <ApiExample />
          <Footer />
        </div>
      </main>
    </Document>
  )
}

function HomeHead() {
  return () => (
    <>
      <meta name="color-scheme" content="light dark" />
      <meta
        name="description"
        content="A headless, Strapi-style CMS built on Remix v3. Define content types in the browser and serve them over a read-only JSON API. No migrations."
      />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap"
      />
    </>
  )
}

function Masthead() {
  return () => (
    <section
      aria-label="RemixCMS"
      mix={css({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
        width: '100%',
        textAlign: 'center',
      })}
    >
      <p
        mix={css({
          margin: 0,
          fontWeight: 700,
          fontSize: '12px',
          lineHeight: 1.4,
          textTransform: 'uppercase',
          letterSpacing: '0.18em',
          color: 'var(--text-tertiary)',
        })}
      >
        Headless CMS · Built on Remix v3
      </p>

      <h1
        mix={css({
          margin: 0,
          fontSize: '56px',
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          '@media (max-width: 560px)': { fontSize: '40px' },
        })}
      >
        Remix<span mix={css({ color: 'var(--brand-blue)' })}>CMS</span>
      </h1>

      <p
        mix={css({
          margin: 0,
          maxWidth: '560px',
          fontSize: '15px',
          lineHeight: 1.7,
          color: 'var(--text-secondary)',
        })}
      >
        Define content types in the browser and serve published entries over a read-only JSON
        API. Fields are stored generically as JSON, so adding a type never needs a migration or a
        redeploy.
      </p>

      <div
        mix={css({
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          justifyContent: 'center',
          marginTop: '8px',
        })}
      >
        <a href={routes.admin.index.href()} mix={primaryCta}>
          Open the admin →
        </a>
        <a href={routes.auth.loginForm.href()} mix={secondaryCta}>
          Sign in
        </a>
      </div>
    </section>
  )
}

function FeatureGrid() {
  return () => (
    <section
      aria-label="Features"
      mix={css({
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '16px',
        width: '100%',
        '@media (max-width: 760px)': { gridTemplateColumns: '1fr 1fr' },
        '@media (max-width: 520px)': { gridTemplateColumns: '1fr' },
      })}
    >
      {FEATURES.map((feature) => (
        <FeatureCard title={feature.title} body={feature.body} />
      ))}
    </section>
  )
}

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: 'Content-Type Builder',
    body: 'Model content with a visual field builder. Types and their fields are defined at runtime and stored as JSON.',
  },
  {
    title: 'Components',
    body: 'Reusable field groups you define once and embed across any content type.',
  },
  {
    title: 'Localization',
    body: 'Per-locale entries with a default fallback, served from the API via a ?locale= param.',
  },
  {
    title: 'Releases & Scheduling',
    body: 'Stage publish and unpublish actions, then fire them together or on a per-entry timer.',
  },
  {
    title: 'Headless JSON API',
    body: 'Published entries over a public, read-only API — optionally gated behind bearer API tokens.',
  },
  {
    title: 'Audit log',
    body: 'Every admin mutation is recorded in a read-only, searchable log.',
  },
]

function FeatureCard(handle: Handle<{ title: string; body: string }>) {
  return () => {
    let { title, body } = handle.props

    return (
      <div
        mix={css({
          background: 'var(--surface-3)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        })}
      >
        <h2
          mix={css({
            margin: 0,
            fontSize: '13px',
            fontWeight: 700,
            lineHeight: 1.4,
            color: 'var(--text-primary)',
          })}
        >
          {title}
        </h2>
        <p
          mix={css({
            margin: 0,
            fontSize: '13px',
            lineHeight: 1.65,
            color: 'var(--text-secondary)',
          })}
        >
          {body}
        </p>
      </div>
    )
  }
}

function ApiExample() {
  return () => (
    <section
      aria-label="API example"
      mix={css({
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      })}
    >
      <p
        mix={css({
          margin: 0,
          fontSize: '12px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          color: 'var(--text-tertiary)',
        })}
      >
        Read published content
      </p>
      <pre
        mix={css({
          margin: 0,
          overflowX: 'auto',
          background: 'var(--surface-4)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '16px 20px',
          fontFamily: FONT_STACK,
          fontSize: '13px',
          lineHeight: 1.7,
          color: 'var(--text-primary)',
        })}
      >
        <code>
          <span mix={css({ color: 'var(--text-tertiary)' })}># List published entries of a type</span>
          {'\n'}GET {routes.api.list.href({ type: 'articles' })}
          {'\n\n'}
          <span mix={css({ color: 'var(--text-tertiary)' })}># Fetch a single entry by id</span>
          {'\n'}GET {routes.api.show.href({ type: 'articles', id: '1' })}
          {'\n\n'}
          <span mix={css({ color: 'var(--text-tertiary)' })}># Localized to a specific locale</span>
          {'\n'}GET {routes.api.list.href({ type: 'articles' })}?locale=fr
        </code>
      </pre>
    </section>
  )
}

function Footer() {
  return () => (
    <footer
      mix={css({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '10px',
        fontSize: '11px',
        lineHeight: 1.6,
        letterSpacing: '0.06em',
        color: 'var(--text-tertiary)',
        textAlign: 'center',
      })}
    >
      <p mix={css({ margin: 0 })}>
        Remix<span mix={css({ color: 'var(--brand-blue)' })}>CMS</span>
      </p>
      <p mix={css({ margin: 0, textTransform: 'uppercase' })}>
        Remix v3 · node:sqlite · zero-hydration SSR
      </p>
    </footer>
  )
}

const ctaBase = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  padding: '11px 20px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 700,
  textDecoration: 'none',
  transition: 'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
}

const primaryCta = css({
  ...ctaBase,
  background: 'var(--brand-blue)',
  color: '#fff',
  border: '1px solid transparent',
  '&:hover, &:focus-visible': { background: 'var(--brand-strong)', outline: 'none' },
})

const secondaryCta = css({
  ...ctaBase,
  background: 'transparent',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
  '&:hover, &:focus-visible': {
    background: 'var(--surface-4)',
    color: 'var(--brand-blue)',
    outline: 'none',
  },
})
