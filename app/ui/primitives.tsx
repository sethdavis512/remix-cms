import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { cardStyle, primaryDangerButtonStyle, secondaryButtonStyle } from './admin-shell.tsx'

// Shared admin primitives: the table/form/badge markup and styles that every
// list page repeats. Route-local styles stay in their controllers; anything
// used by two or more route areas belongs here.

// ----- Tables -----

export const tableStyle = css({ width: '100%', borderCollapse: 'collapse', fontSize: '14px' })

export const thStyle = css({
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-tertiary)',
  borderBottom: '1px solid var(--border)',
})

export const tdStyle = css({ padding: '12px', borderBottom: '1px solid var(--border)' })

export const tdActionsStyle = css({
  padding: '12px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'right',
})

export const tdMonoStyle = css({
  padding: '12px',
  borderBottom: '1px solid var(--border)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: '13px',
})

// A card-wrapped table that scrolls horizontally on narrow screens instead of
// overflowing the page.
export function DataTable(handle: Handle<{ children?: RemixNode }>) {
  return () => (
    <div mix={[cardStyle, css({ overflowX: 'auto' })]}>
      <table mix={tableStyle}>{handle.props.children}</table>
    </div>
  )
}

// ----- Cards and empty states -----

export const cardHeadingStyle = css({ margin: '0 0 12px', fontSize: '15px' })

export function EmptyState(handle: Handle<{ children?: RemixNode }>) {
  return () => (
    <div mix={cardStyle}>
      <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>{handle.props.children}</p>
    </div>
  )
}

// ----- Badges -----

const badgeBase = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '3px 10px 3px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 600,
} as const

const badgeDotStyle = (color: string) =>
  css({ width: '6px', height: '6px', borderRadius: '999px', background: color })

export function StatusBadge(handle: Handle<{ status: 'draft' | 'published' }>) {
  return () => {
    let published = handle.props.status === 'published'
    return (
      <span
        mix={css({
          ...badgeBase,
          color: published ? 'var(--success)' : 'var(--text-secondary)',
          background: published ? 'var(--success-soft)' : 'var(--surface-2)',
          border: `1px solid ${published ? 'color-mix(in srgb, var(--success) 26%, transparent)' : 'var(--border)'}`,
        })}
      >
        <span mix={badgeDotStyle(published ? 'var(--success)' : 'var(--text-tertiary)')} />
        {published ? 'Published' : 'Draft'}
      </span>
    )
  }
}

export function DraftBadge(_handle: Handle) {
  return () => (
    <span
      mix={css({
        ...badgeBase,
        color: 'var(--text-secondary)',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
      })}
    >
      <span mix={badgeDotStyle('var(--text-tertiary)')} />
      Draft
    </span>
  )
}

// ----- Form controls -----

export const inputFocusRing = {
  outline: 'none',
  borderColor: 'var(--brand)',
  boxShadow: '0 0 0 3px var(--brand-soft)',
} as const

export const inputStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '14px',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
  '&:focus': inputFocusRing,
})

export const fieldLabelStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 600,
})

export const formErrorStyle = css({
  margin: '0 0 12px',
  padding: '12px 16px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--danger)',
  background: 'var(--danger-soft)',
  border: '1px solid var(--danger)',
})

export const confirmWarningStyle = css({
  margin: 0,
  padding: '12px 16px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--danger)',
  background: 'var(--danger-soft)',
  border: '1px solid var(--danger)',
})

// ----- Delete confirmation -----

// The interstitial confirm card used by every destructive delete: a plain GET
// page whose only POST is the actual destroy, so deletes are never one click.
export function ConfirmDeleteCard(
  handle: Handle<{
    title: string
    // Optional extra red warning below the message (e.g. "currently published").
    warning?: string | null
    confirmLabel: string
    actionHref: string
    cancelHref: string
    children?: RemixNode
  }>,
) {
  return () => {
    let { title, warning, confirmLabel, actionHref, cancelHref, children } = handle.props
    return (
      <div mix={cardStyle}>
        <h2 mix={css({ margin: '0 0 12px', fontSize: '16px' })}>{title}</h2>
        <p mix={css({ margin: '0 0 12px', fontSize: '14px' })}>{children}</p>
        {warning ? <p mix={confirmWarningStyle}>{warning}</p> : null}
        <div mix={css({ display: 'flex', gap: '10px', marginTop: '16px' })}>
          <form method="POST" action={actionHref}>
            <button type="submit" mix={primaryDangerButtonStyle}>
              {confirmLabel}
            </button>
          </form>
          <a href={cancelHref} mix={secondaryButtonStyle}>
            Cancel
          </a>
        </div>
      </div>
    )
  }
}
