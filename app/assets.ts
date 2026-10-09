import { createAssetServer } from 'remix/assets'
import { loadConfig } from 'remix/cli'
import { componentHmr } from 'remix/component-hmr/assets'

const nodeEnv = process.env.NODE_ENV ?? 'development'
const isDevelopment = nodeEnv === 'development'
const isHmr = Boolean(isDevelopment && process.env.REMIX_NODE_HMR)

// The JSON-compatible part of the asset config (basePath, allowFiles,
// allowPackages, denyFiles) lives in remix.json so `remix assets` and
// `remix assets inspect <url-or-file>` see the same rules as the server.
// Browser-reachable source lives in colocated `public/` directories (the
// browser entry in app/actions/public, client entries next to the controller or
// shared UI that owns them). Everything else under app/ stays server-only.
const config = await loadConfig(import.meta.dirname)
if (config.assets === undefined) throw new Error('Missing assets configuration in remix.json')

export const assets = createAssetServer({
  ...config.assets,
  sourceMaps: isDevelopment ? 'external' : undefined,
  minify: !isDevelopment,
  watch: isDevelopment,
  hmr: isHmr
    ? {
        channel: async () => (await import('remix/node-hmr/runtime')).createBrowserHmrChannel(),
        moduleImporter: 'remix/multiple-import-maps-polyfill',
      }
    : undefined,
  scripts: { loaders: isHmr ? [componentHmr()] : undefined },
})

export const BROWSER_ENTRY = 'app/actions/public/entry.ts'

// The browser entry's module URL, import map, and preloads, resolved once at
// startup and rendered into the document head by `Document`.
export const scriptEntry = await assets.getScriptEntry(BROWSER_ENTRY)
