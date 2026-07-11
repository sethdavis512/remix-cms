import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { CopyButton } from '../assets/copy-button.tsx'
import { cardStyle } from './admin-shell.tsx'

// A panel of copy-paste curl snippets for a content type's public API endpoints,
// so users can quickly test and see responses. Reflects the current access mode:
// when the API requires a token, each snippet carries an Authorization header;
// when the type is localized, a locale-filtered snippet is included.
export function ApiSnippets(
  handle: Handle<{
    origin: string
    apiIdPlural: string
    sampleId: number
    requireToken: boolean
    localized: boolean
    localeHint: string
  }>,
) {
  return () => {
    let { origin, apiIdPlural, sampleId, requireToken, localized, localeHint } = handle.props
    let base = `${origin}/api/${apiIdPlural}`
    let auth = requireToken ? ' -H "Authorization: Bearer <your-token>"' : ''

    let snippets = [
      { label: 'List published entries', command: `curl -s${auth} ${base}` },
      { label: 'Get a single entry', command: `curl -s${auth} ${base}/${sampleId}` },
    ]
    if (localized) {
      snippets.push({
        label: 'List entries for a locale',
        command: `curl -s${auth} "${base}?locale=${localeHint}"`,
      })
    }

    return (
      <div mix={[cardStyle, css({ display: 'flex', flexDirection: 'column', gap: '14px' })]}>
        <div>
          <h2 mix={css({ margin: '0 0 4px', fontSize: '15px' })}>API</h2>
          <p mix={css({ margin: 0, fontSize: '13px', color: 'var(--text-tertiary)' })}>
            {requireToken
              ? 'Authenticated, read-only endpoints. Send your token as a Bearer header. Only published entries are returned.'
              : 'Public, read-only endpoints. Only published entries are returned.'}
          </p>
        </div>

        {snippets.map((snippet) => (
          <div mix={rowStyle}>
            <div mix={css({ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 })}>
              <span mix={css({ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)' })}>
                {snippet.label}
              </span>
              <code mix={codeStyle}>{snippet.command}</code>
            </div>
            <CopyButton text={snippet.command} />
          </div>
        ))}
      </div>
    )
  }
}

const rowStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '12px 14px',
  borderRadius: '10px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
})

const codeStyle = css({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '13px',
  color: 'var(--text-primary)',
  overflowX: 'auto',
  whiteSpace: 'pre',
})
