import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'
import { ImportMap } from 'remix/component/server'

import { scriptEntry } from '../assets.ts'

export interface DocumentProps {
  children?: RemixNode
  head?: RemixNode
  title?: string
  // Whether to load the browser entry module. The admin needs it for its
  // clientEntry components; the public pages are zero-hydration and skip the
  // script entirely.
  hydrate?: boolean
}

const DEFAULT_TITLE = 'Remix CMS'

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    let { children, head, title = DEFAULT_TITLE, hydrate = true } = handle.props
    let { href, importMap, preloads } = scriptEntry

    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <title>{title}</title>
          {head}
          {hydrate ? (
            <>
              <ImportMap value={importMap} />
              {preloads.map((preloadHref) => (
                <link key={preloadHref} rel="modulepreload" href={preloadHref} />
              ))}
              <script type="module" src={href}></script>
            </>
          ) : null}
        </head>
        <body mix={css({ margin: 0 })}>{children}</body>
      </html>
    )
  }
}
