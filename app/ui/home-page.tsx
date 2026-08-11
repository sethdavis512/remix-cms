import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { routes } from '../routes.ts'
import { Document } from './document.tsx'
import { SiteFooter, SiteHead, SiteHeader } from './site-chrome.tsx'
import {
  MONO_STACK,
  SERIF_STACK,
  eyebrow,
  pageShell,
  primaryCta,
  secondaryCta,
  textLink,
} from './site-theme.ts'

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
      <Document
        title="RemixCMS · Headless CMS on Remix v3"
        head={
          <SiteHead description="A headless, Strapi-style CMS built on Remix v3. Define content types in the browser and serve them over a read-only JSON API. No migrations." />
        }
      >
        <main mix={pageShell}>
          <div
            mix={css({
              width: '100%',
              maxWidth: '960px',
              minHeight: '100vh',
              display: 'flex',
              flexDirection: 'column',
            })}
          >
            <SiteHeader showBlogLink={showBlogLink} />
            <Hero content={content} showBlogLink={showBlogLink} />
            <FeatureIndex features={content.features} />
            <ApiExample />
            <SiteFooter />
          </div>
        </main>
      </Document>
    )
  }
}

function Hero(handle: Handle<{ content: HomeContent; showBlogLink: boolean }>) {
  return () => {
    let { content, showBlogLink } = handle.props

    return (
      <section
        aria-label="RemixCMS"
        mix={css({
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '28px',
          padding: 'clamp(56px, 10vh, 112px) 0 clamp(48px, 8vh, 88px)',
        })}
      >
        <p mix={eyebrow}>{content.eyebrow}</p>

        <h1
          mix={css({
            margin: 0,
            fontFamily: SERIF_STACK,
            fontSize: 'clamp(48px, 8.5vw, 84px)',
            fontWeight: 500,
            lineHeight: 1.02,
            letterSpacing: '-0.015em',
          })}
        >
          {content.heading}
          <span mix={css({ color: 'var(--accent)', fontStyle: 'italic' })}>
            {content.headingAccent}
          </span>
        </h1>

        <p
          mix={css({
            margin: 0,
            maxWidth: '36em',
            fontSize: '17px',
            lineHeight: 1.65,
            color: 'var(--ink-soft)',
          })}
        >
          {content.subheading}
        </p>

        <div
          mix={css({
            display: 'flex',
            alignItems: 'center',
            gap: '18px',
            flexWrap: 'wrap',
            marginTop: '6px',
          })}
        >
          <a href={routes.admin.index.href()} mix={primaryCta}>
            {content.ctaLabel}
          </a>
          <a href={routes.auth.loginForm.href()} mix={secondaryCta}>
            Sign in
          </a>
          {showBlogLink && (
            <a href={routes.blog.index.href()} mix={[textLink, css({ fontSize: '14px', fontWeight: 500 })]}>
              Read the blog →
            </a>
          )}
        </div>
      </section>
    )
  }
}

function FeatureIndex(handle: Handle<{ features: Array<{ title: string; body: string }> }>) {
  return () => {
    let features = handle.props.features

    return (
      <section
        aria-label="Features"
        mix={css({
          borderTop: '1px solid var(--rule)',
          padding: '28px 0 clamp(40px, 7vh, 72px)',
        })}
      >
        <div
          mix={css({
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '16px',
            marginBottom: '8px',
          })}
        >
          <p mix={eyebrow}>What's inside</p>
          <p
            mix={css({
              margin: 0,
              fontFamily: MONO_STACK,
              fontSize: '12px',
              color: 'var(--ink-faint)',
            })}
          >
            {String(features.length).padStart(2, '0')} modules
          </p>
        </div>

        <ol mix={css({ listStyle: 'none', margin: 0, padding: 0 })}>
          {features.map((feature, index) => (
            <FeatureRow index={index} title={feature.title} body={feature.body} />
          ))}
        </ol>
      </section>
    )
  }
}

function FeatureRow(handle: Handle<{ index: number; title: string; body: string }>) {
  return () => {
    let { index, title, body } = handle.props

    return (
      <li
        mix={css({
          display: 'grid',
          gridTemplateColumns: '56px 1fr 1.4fr',
          gap: '8px 24px',
          alignItems: 'baseline',
          padding: '20px 0',
          borderTop: '1px solid var(--rule)',
          '&:first-child': { borderTop: 'none' },
          '@media (max-width: 640px)': { gridTemplateColumns: '56px 1fr' },
        })}
      >
        <span
          mix={css({
            fontFamily: MONO_STACK,
            fontSize: '12px',
            color: 'var(--ink-faint)',
          })}
        >
          {String(index + 1).padStart(2, '0')}
        </span>
        <h2
          mix={css({
            margin: 0,
            fontFamily: SERIF_STACK,
            fontSize: '22px',
            fontWeight: 500,
            lineHeight: 1.3,
            letterSpacing: '-0.01em',
          })}
        >
          {title}
        </h2>
        <p
          mix={css({
            margin: 0,
            fontSize: '14px',
            lineHeight: 1.65,
            color: 'var(--ink-soft)',
            '@media (max-width: 640px)': { gridColumn: '2' },
          })}
        >
          {body}
        </p>
      </li>
    )
  }
}

function ApiExample() {
  return () => (
    <section
      aria-label="API example"
      mix={css({
        borderTop: '1px solid var(--rule)',
        padding: '28px 0 clamp(40px, 7vh, 72px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      })}
    >
      <p mix={eyebrow}>Read published content</p>
      <pre
        mix={css({
          margin: 0,
          overflowX: 'auto',
          background: 'var(--paper-raised)',
          border: '1px solid var(--rule)',
          borderRadius: '4px',
          padding: '18px 22px',
          fontFamily: MONO_STACK,
          fontSize: '13px',
          lineHeight: 1.7,
          color: 'var(--ink)',
        })}
      >
        <code>
          <span mix={css({ color: 'var(--ink-faint)' })}># List published entries of a type</span>
          {'\n'}GET {routes.api.list.href({ type: 'articles' })}
          {'\n\n'}
          <span mix={css({ color: 'var(--ink-faint)' })}># Fetch a single entry by id</span>
          {'\n'}GET {routes.api.show.href({ type: 'articles', id: '1' })}
        </code>
      </pre>
    </section>
  )
}
