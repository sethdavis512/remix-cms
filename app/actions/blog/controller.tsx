import { createController } from 'remix/router'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { ApiEntry } from '../../data/cms-client.server.ts'
import { CmsClientKey } from '../../middleware/cms-client.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/document.tsx'
import { SiteFooter, SiteHead, SiteHeader } from '../../ui/site-chrome.tsx'
import { SERIF_STACK, eyebrow, pageShell, textLink } from '../../ui/site-theme.ts'

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

function excerpt(body: string, max = 200): string {
  let text = body.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

// ----- Shared layout -----

// Blog pages use the same shell as home but a narrower reading measure.
const pageColumn = css({
  width: '100%',
  maxWidth: '760px',
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
})

// ----- Pages -----

function BlogIndexPage(handle: Handle<{ articles: ApiEntry[]; available: boolean }>) {
  return () => {
    let { articles, available } = handle.props

    return (
      <Document title="Blog · RemixCMS" head={<SiteHead />}>
        <main mix={pageShell}>
          <div mix={pageColumn}>
            <SiteHeader active="blog" />

            <header
              mix={css({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '18px',
                padding: 'clamp(44px, 8vh, 80px) 0 clamp(32px, 5vh, 56px)',
              })}
            >
              <p mix={eyebrow}>The blog</p>
              <h1
                mix={css({
                  margin: 0,
                  fontFamily: SERIF_STACK,
                  fontSize: 'clamp(38px, 6vw, 56px)',
                  fontWeight: 500,
                  lineHeight: 1.05,
                  letterSpacing: '-0.015em',
                })}
              >
                Latest <span mix={css({ fontStyle: 'italic', color: 'var(--accent)' })}>articles</span>
              </h1>
            </header>

            <div mix={css({ paddingBottom: 'clamp(40px, 7vh, 72px)' })}>
              {articles.length === 0 ? (
                <EmptyState available={available} />
              ) : (
                <ol mix={css({ listStyle: 'none', margin: 0, padding: 0 })}>
                  {articles.map((article) => (
                    <ArticleRow article={article} />
                  ))}
                </ol>
              )}
            </div>

            <SiteFooter />
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
        borderTop: '1px solid var(--rule)',
        padding: '28px 0',
        maxWidth: '38em',
        fontFamily: SERIF_STACK,
        fontSize: '19px',
        fontStyle: 'italic',
        lineHeight: 1.6,
        color: 'var(--ink-soft)',
      })}
    >
      {handle.props.available
        ? 'Nothing in print yet. Publish an Article in the admin and it will appear here.'
        : 'The content API is unavailable right now. Once it is reachable, published Articles will appear here.'}
    </div>
  )
}

function ArticleRow(handle: Handle<{ article: ApiEntry }>) {
  return () => {
    let { article } = handle.props
    let date = formatDate(article.publishedAt)
    let author = authorName(article)
    let body = asString(article.attributes.body)
    let meta = [date, author && `by ${author}`].filter(Boolean).join(' · ')

    return (
      <li
        mix={css({
          borderTop: '1px solid var(--rule)',
          padding: '26px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: '10px',
        })}
      >
        {meta && <p mix={eyebrow}>{meta}</p>}
        <a
          href={routes.blog.show.href({ entryId: String(article.id) })}
          mix={css({
            margin: 0,
            fontFamily: SERIF_STACK,
            fontSize: '26px',
            fontWeight: 500,
            lineHeight: 1.25,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            textDecoration: 'none',
            '&:hover, &:focus-visible': { color: 'var(--accent)', outline: 'none' },
          })}
        >
          {articleTitle(article)}
        </a>
        {body && (
          <p
            mix={css({
              margin: 0,
              maxWidth: '42em',
              fontSize: '14px',
              lineHeight: 1.7,
              color: 'var(--ink-soft)',
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
      <Document title={`${articleTitle(entry)} · RemixCMS`} head={<SiteHead />}>
        <main mix={pageShell}>
          <div mix={pageColumn}>
            <SiteHeader active="blog" />

            <article
              mix={css({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '28px',
                padding: 'clamp(44px, 8vh, 80px) 0 clamp(48px, 8vh, 88px)',
              })}
            >
              <a href={routes.blog.index.href()} mix={[textLink, css({ fontSize: '13px', fontWeight: 500 })]}>
                ← All articles
              </a>

              <header mix={css({ display: 'flex', flexDirection: 'column', gap: '14px' })}>
                <h1
                  mix={css({
                    margin: 0,
                    fontFamily: SERIF_STACK,
                    fontSize: 'clamp(34px, 5.5vw, 52px)',
                    fontWeight: 500,
                    lineHeight: 1.1,
                    letterSpacing: '-0.015em',
                  })}
                >
                  {articleTitle(entry)}
                </h1>
                {meta && <p mix={eyebrow}>{meta}</p>}
              </header>

              <Prose body={body} />
            </article>

            <SiteFooter />
          </div>
        </main>
      </Document>
    )
  }
}

const proseParagraph = css({
  margin: 0,
  fontFamily: SERIF_STACK,
  fontSize: '18px',
  lineHeight: 1.75,
  color: 'var(--ink)',
})

// The opening paragraph gets an editorial drop cap.
const proseLead = css({
  '&::first-letter': {
    float: 'left',
    fontSize: '3.1em',
    lineHeight: 0.82,
    padding: '6px 10px 0 0',
    fontStyle: 'italic',
    color: 'var(--accent)',
  },
})

function Prose(handle: Handle<{ body: string }>) {
  return () => (
    <div
      mix={css({
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        maxWidth: '38em',
        borderTop: '1px solid var(--rule)',
        paddingTop: '28px',
      })}
    >
      {paragraphs(handle.props.body).map((para, index) => (
        <p mix={index === 0 ? [proseParagraph, proseLead] : proseParagraph}>{para}</p>
      ))}
    </div>
  )
}
