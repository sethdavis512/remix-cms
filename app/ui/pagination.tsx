import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

// Prev/next pager shown under admin list tables. Given already-computed page
// numbers and prev/next hrefs (see pageHref in app/utils/pagination.ts), it
// renders "Page X of Y (N nouns)" with links that disable at the ends. A blank
// or null href disables its control. When a list fits on a single page it
// renders nothing. Pass `nounPlural` for irregular plurals (entry -> entries).
export function Pagination(
  handle: Handle<{
    page: number
    totalPages: number
    total: number
    noun: string
    nounPlural?: string
    prevHref: string | null
    nextHref: string | null
  }>,
) {
  return () => {
    let { page, totalPages, total, noun, nounPlural, prevHref, nextHref } = handle.props
    if (totalPages <= 1) return null

    let label = total === 1 ? noun : nounPlural ?? `${noun}s`

    return (
      <nav mix={wrapStyle} aria-label="Pagination">
        <span mix={summaryStyle}>
          Page {page} of {totalPages} ({total} {label})
        </span>
        <span mix={controlsStyle}>
          {prevHref ? (
            <a href={prevHref} mix={linkStyle}>
              ← Previous
            </a>
          ) : (
            <span mix={disabledStyle}>← Previous</span>
          )}
          {nextHref ? (
            <a href={nextHref} mix={linkStyle}>
              Next →
            </a>
          ) : (
            <span mix={disabledStyle}>Next →</span>
          )}
        </span>
      </nav>
    )
  }
}

const wrapStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  flexWrap: 'wrap',
})

const summaryStyle = css({
  fontSize: '13px',
  color: 'var(--text-tertiary)',
})

const controlsStyle = css({
  display: 'inline-flex',
  gap: '8px',
})

const linkStyle = css({
  font: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
  padding: '7px 12px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  textDecoration: 'none',
  '&:hover': { background: 'var(--surface-2)' },
})

const disabledStyle = css({
  fontSize: '13px',
  fontWeight: 600,
  padding: '7px 12px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  opacity: 0.5,
})
