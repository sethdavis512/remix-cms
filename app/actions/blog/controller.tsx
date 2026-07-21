import { createController } from 'remix/router'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { ApiEntry } from '../../data/cms-client.server.ts'
import { CmsClientKey } from '../../middleware/cms-client.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/document.tsx'
import { FONT_STACK, secondaryCta, themeVars } from '../../ui/site-theme.ts'

// Public, CMS-driven blog. Both actions consume the same public JSON API an
// external client would, dispatched in-process through the CMS client. The
// blog is built on the seeded Article/Author model; ?populate=1 expands the
// author relation so a name can be shown.
export default createController(routes.blog, {
  actions: {
    async index(context) {
      let cms = context.get(CmsClientKey)!
      let result = await cms.listEntries('articles', { sort: '-publishedAt', populate: true })
      return context.render(<BlogIndexPage articles={result.data} available={result.ok} />)
    },

    async show(context) {
      let cms = context.get(CmsClientKey)!
      let id = Number(context.params.entryId)
      // Non-numeric ids, drafts, and missing entries all resolve to null, which
      // is a 404. Only published articles are ever exposed by the API.
      let entry = Number.isInteger(id) ? await cms.getEntry('articles', id, { populate: true }) : null
      if (!entry) return new Response('Not Found', { status: 404 })
      return context.render(<BlogShowPage entry={entry} />)
    },
  },
})

// ----- Helpers -----

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatDate(ms: number | null): string {
  if (ms == null) return ''
  let date = new Date(ms)
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function articleTitle(entry: ApiEntry): string {
  return asString(entry.attributes.title) || `Entry #${entry.id}`
}

// The populated author relation serializes as { id, attributes: { name } } or
// null; pull the name out defensively.
function authorName(entry: ApiEntry): string {
  let author = entry.attributes.author
  if (author && typeof author === 'object') {
    let attrs = (author as { attributes?: Record<string, unknown> }).attributes
    if (attrs) return asString(attrs.name)
  }
  return ''
}

// Split a richtext body into display paragraphs on blank lines, falling back to
// the whole string as one paragraph.
function paragraphs(body: string): string[] {
  let parts = body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [body.trim()].filter(Boolean)
}

function excerpt(body: string, max = 180): string {
  let text = body.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

// ----- Pages -----

function BlogHead() {
  return () => (
    <>
      <meta name="color-scheme" content="light dark" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap"
      />
    </>
  )
}

const pageMain = css({
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
  justifyContent: 'center',
})

const eyebrow = css({
  margin: 0,
  fontWeight: 700,
  fontSize: '12px',
  lineHeight: 1.4,
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  color: 'var(--text-tertiary)',
})

function BlogIndexPage(handle: Handle<{ articles: ApiEntry[]; available: boolean }>) {
  return () => {
    let { articles, available } = handle.props

    return (
      <Document title="Blog · RemixCMS" head={<BlogHead />}>
        <main mix={pageMain}>
          <div
            mix={css({
              width: '100%',
              maxWidth: '720px',
              display: 'flex',
              flexDirection: 'column',
              gap: '40px',
            })}
          >
            <header
              mix={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}
            >
              <p mix={eyebrow}>Blog</p>
              <h1
                mix={css({
                  margin: 0,
                  fontSize: '40px',
                  fontWeight: 700,
                  lineHeight: 1.1,
                  letterSpacing: '-0.02em',
                })}
              >
                Latest articles
              </h1>
              <div>
                <a href={routes.home.href()} mix={secondaryCta}>
                  ← Back home
                </a>
              </div>
            </header>

            {articles.length === 0 ? (
              <EmptyState available={available} />
            ) : (
              <ul
                mix={css({
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                })}
              >
                {articles.map((article) => (
                  <ArticleCard article={article} />
                ))}
              </ul>
            )}
          </div>
        </main>
      </Document>
    )
  }
}

function EmptyState(handle: Handle<{ available: boolean }>) {
  return () => (
    <div
      mix={css({
        background: 'var(--surface-3)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '28px',
        color: 'var(--text-secondary)',
        lineHeight: 1.7,
      })}
    >
      {handle.props.available
        ? 'No articles yet. Publish an Article in the admin and it will appear here.'
        : 'The content API is unavailable right now. Once it is reachable, published Articles will appear here.'}
    </div>
  )
}

function ArticleCard(handle: Handle<{ article: ApiEntry }>) {
  return () => {
    let { article } = handle.props
    let date = formatDate(article.publishedAt)
    let author = authorName(article)
    let body = asString(article.attributes.body)
    let meta = [date, author && `by ${author}`].filter(Boolean).join(' · ')

    return (
      <li
        mix={css({
          background: 'var(--surface-3)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        })}
      >
        <a
          href={routes.blog.show.href({ entryId: String(article.id) })}
          mix={css({
            margin: 0,
            fontSize: '20px',
            fontWeight: 700,
            lineHeight: 1.3,
            color: 'var(--text-primary)',
            textDecoration: 'none',
            '&:hover, &:focus-visible': { color: 'var(--brand-blue)', outline: 'none' },
          })}
        >
          {articleTitle(article)}
        </a>
        {meta && <p mix={eyebrow}>{meta}</p>}
        {body && (
          <p
            mix={css({
              margin: 0,
              fontSize: '14px',
              lineHeight: 1.7,
              color: 'var(--text-secondary)',
            })}
          >
            {excerpt(body)}
          </p>
        )}
      </li>
    )
  }
}

function BlogShowPage(handle: Handle<{ entry: ApiEntry }>) {
  return () => {
    let { entry } = handle.props
    let date = formatDate(entry.publishedAt)
    let author = authorName(entry)
    let meta = [date, author && `by ${author}`].filter(Boolean).join(' · ')
    let body = asString(entry.attributes.body)

    return (
      <Document title={`${articleTitle(entry)} · RemixCMS`} head={<BlogHead />}>
        <main mix={pageMain}>
          <article
            mix={css({
              width: '100%',
              maxWidth: '680px',
              display: 'flex',
              flexDirection: 'column',
              gap: '24px',
            })}
          >
            <div>
              <a href={routes.blog.index.href()} mix={secondaryCta}>
                ← All articles
              </a>
            </div>

            <header mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}>
              <h1
                mix={css({
                  margin: 0,
                  fontSize: '36px',
                  fontWeight: 700,
                  lineHeight: 1.15,
                  letterSpacing: '-0.02em',
                })}
              >
                {articleTitle(entry)}
              </h1>
              {meta && <p mix={eyebrow}>{meta}</p>}
            </header>

            <div
              mix={css({
                display: 'flex',
                flexDirection: 'column',
                gap: '18px',
                fontSize: '15px',
                lineHeight: 1.8,
                color: 'var(--text-secondary)',
              })}
            >
              {paragraphs(body).map((para) => (
                <p mix={css({ margin: 0 })}>{para}</p>
              ))}
            </div>
          </article>
        </main>
      </Document>
    )
  }
}
