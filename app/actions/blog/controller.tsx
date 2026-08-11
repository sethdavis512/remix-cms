import { createController } from 'remix/router'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { ApiEntry, ListPagination } from '../../data/cms-client.server.ts'
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
      let rawPage = Number(context.url.searchParams.get('page') ?? '1')
      let page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1
      let result = await cms.listEntries('articles', {
        sort: '-publishedAt',
        populate: true,
        page,
      })
      return context.render(
        <BlogIndexPage
          articles={result.data}
          available={result.ok}
          pagination={result.pagination}
          origin={context.url.origin}
        />,
      )
    },

    async show(context) {
      let cms = context.get(CmsClientKey)!
      let id = Number(context.params.entryId)
      // Non-numeric ids, drafts, and missing entries all resolve to null, which
      // is a 404. Only published articles are ever exposed by the API.
      let entry = Number.isInteger(id) ? await cms.getEntry('articles', id, { populate: true }) : null
      if (!entry) return context.render(<ArticleNotFoundPage />, { status: 404 })
      return context.render(<BlogShowPage entry={entry} origin={context.url.origin} />)
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

function isoDate(ms: number | null): string {
  return ms == null ? '' : new Date(ms).toISOString()
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

function blogIndexHref(page: number): string {
  let base = routes.blog.index.href()
  return page > 1 ? `${base}?page=${page}` : base
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

// Byline with a machine-readable date.
function Byline(handle: Handle<{ publishedAt: number | null; author: string }>) {
  return () => {
    let { publishedAt, author } = handle.props
    let date = formatDate(publishedAt)
    if (!date && !author) return null
    return (
      <p mix={eyebrow}>
        {date ? <time dateTime={isoDate(publishedAt)}>{date}</time> : null}
        {date && author ? ' · ' : ''}
        {author ? `by ${author}` : ''}
      </p>
    )
  }
}

// ----- Pages -----

function BlogIndexPage(
  handle: Handle<{
    articles: ApiEntry[]
    available: boolean
    pagination: ListPagination | null
    origin: string
  }>,
) {
  return () => {
    let { articles, available, pagination, origin } = handle.props
    let page = pagination?.page ?? 1
    let pageCount = pagination?.pageCount ?? 1

    return (
      <Document
        title="Blog · RemixCMS"
        hydrate={false}
        head={
          <SiteHead
            description="Latest articles published with RemixCMS, a headless CMS built on Remix v3."
            canonical={`${origin}${blogIndexHref(page)}`}
            ogTitle="Blog · RemixCMS"
          />
        }
      >
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
                <EmptyState available={available} page={page} />
              ) : (
                <ol mix={css({ listStyle: 'none', margin: 0, padding: 0 })}>
                  {articles.map((article) => (
                    <ArticleRow article={article} />
                  ))}
                </ol>
              )}

              {pageCount > 1 ? (
                <nav
                  aria-label="Pagination"
                  mix={css({
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: '16px',
                    borderTop: '1px solid var(--rule)',
                    paddingTop: '22px',
                  })}
                >
                  {page > 1 ? (
                    <a href={blogIndexHref(page - 1)} mix={[textLink, pagerLink]}>
                      ← Newer
                    </a>
                  ) : (
                    <span />
                  )}
                  <span mix={css({ fontSize: '13px', color: 'var(--ink-faint)' })}>
                    Page {page} of {pageCount}
                  </span>
                  {page < pageCount ? (
                    <a href={blogIndexHref(page + 1)} mix={[textLink, pagerLink]}>
                      Older →
                    </a>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
            </div>

            <SiteFooter />
          </div>
        </main>
      </Document>
    )
  }
}

const pagerLink = css({ fontSize: '14px', fontWeight: 500 })

function EmptyState(handle: Handle<{ available: boolean; page: number }>) {
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
      {!handle.props.available
        ? 'The content API is unavailable right now. Once it is reachable, published Articles will appear here.'
        : handle.props.page > 1
          ? 'Nothing on this page.'
          : 'Nothing in print yet. Publish an Article in the admin and it will appear here.'}
    </div>
  )
}

function ArticleRow(handle: Handle<{ article: ApiEntry }>) {
  return () => {
    let { article } = handle.props
    let body = asString(article.attributes.body)

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
        <Byline publishedAt={article.publishedAt} author={authorName(article)} />
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

function BlogShowPage(handle: Handle<{ entry: ApiEntry; origin: string }>) {
  return () => {
    let { entry, origin } = handle.props
    let body = asString(entry.attributes.body)
    let title = articleTitle(entry)

    return (
      <Document
        title={`${title} · RemixCMS`}
        hydrate={false}
        head={
          <SiteHead
            description={body ? excerpt(body, 160) : undefined}
            canonical={`${origin}${routes.blog.show.href({ entryId: String(entry.id) })}`}
            ogTitle={title}
            ogType="article"
          />
        }
      >
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
                  {title}
                </h1>
                <Byline publishedAt={entry.publishedAt} author={authorName(entry)} />
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

// Themed 404 for missing or unpublished articles: keeps the site's look and
// offers a way back instead of a bare-text response.
function ArticleNotFoundPage(_handle: Handle) {
  return () => (
    <Document
      title="Article not found · RemixCMS"
      hydrate={false}
      head={<SiteHead />}
    >
      <main mix={pageShell}>
        <div mix={pageColumn}>
          <SiteHeader active="blog" />

          <div
            mix={css({
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '18px',
              padding: 'clamp(44px, 8vh, 80px) 0 clamp(48px, 8vh, 88px)',
            })}
          >
            <p mix={eyebrow}>404</p>
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
              Article not found
            </h1>
            <p mix={css({ margin: 0, maxWidth: '38em', fontSize: '15px', lineHeight: 1.7, color: 'var(--ink-soft)' })}>
              This article does not exist or is no longer published.
            </p>
            <a href={routes.blog.index.href()} mix={[textLink, css({ fontSize: '14px', fontWeight: 500 })]}>
              ← All articles
            </a>
          </div>

          <SiteFooter />
        </div>
      </main>
    </Document>
  )
}
