import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../routes.ts'
import { Document } from './document.tsx'
import { FONT_STACK, primaryCta, secondaryCta, themeVars } from './site-theme.ts'

// The copy the home page renders. When no CMS content is supplied the page falls
// back to DEFAULT_CONTENT below, which is the original static copy verbatim, so a
// fresh database (or a token-gated API) renders exactly as it always did.
export interface HomeContent {
  eyebrow: string
  heading: string
  headingAccent: string
  subheading: string
  ctaLabel: string
  features: Array<{ title: string; body: string }>
}

export const DEFAULT_CONTENT: HomeContent = {
  eyebrow: 'Headless CMS · Built on Remix v3',
  heading: 'Remix',
  headingAccent: 'CMS',
  subheading:
    'Define content types in the browser and serve published entries over a read-only JSON API. Fields are stored generically as JSON, so adding a type never needs a migration or a redeploy.',
  ctaLabel: 'Open the admin →',
  features: [
    {
      title: 'Content-Type Builder',
      body: 'Model content with a visual field builder. Types and their fields are defined at runtime and stored as JSON.',
    },
    {
      title: 'Components',
      body: 'Reusable field groups you define once and embed across any content type.',
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
  ],
}

export interface HomePageProps {
  content?: HomeContent
  showBlogLink?: boolean
}

export function HomePage(handle: Handle<HomePageProps>) {
  return () => {
    let content = handle.props.content ?? DEFAULT_CONTENT
    let showBlogLink = handle.props.showBlogLink ?? false

    return (
      <Document title="RemixCMS · Headless CMS on Remix v3" head={<HomeHead />}>
        <main
          mix={css({
            ...themeVars,
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
            <Masthead content={content} showBlogLink={showBlogLink} />
            <FeatureGrid features={content.features} />
            <ApiExample />
            <Footer />
          </div>
        </main>
      </Document>
    )
  }
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

function Masthead(handle: Handle<{ content: HomeContent; showBlogLink: boolean }>) {
  return () => {
    let { content, showBlogLink } = handle.props

    return (
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
          {content.eyebrow}
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
          {content.heading}
          <span mix={css({ color: 'var(--brand-blue)' })}>{content.headingAccent}</span>
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
          {content.subheading}
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
            {content.ctaLabel}
          </a>
          <a href={routes.auth.loginForm.href()} mix={secondaryCta}>
            Sign in
          </a>
          {showBlogLink && (
            <a href={routes.blog.index.href()} mix={secondaryCta}>
              Read the blog →
            </a>
          )}
        </div>
      </section>
    )
  }
}

function FeatureGrid(handle: Handle<{ features: Array<{ title: string; body: string }> }>) {
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
      {handle.props.features.map((feature) => (
        <FeatureCard title={feature.title} body={feature.body} />
      ))}
    </section>
  )
}

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
