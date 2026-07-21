import { createController } from 'remix/router'
import { Database } from 'remix/data-table'

import { assetServer } from '../assets.ts'
import { findAsset, readAssetObject } from '../data/assets.server.ts'
import { CmsClientKey } from '../middleware/cms-client.ts'
import { routes } from '../routes.ts'
import { HomePage, type HomeContent } from '../ui/home-page.tsx'

// Map a published Homepage entry's attributes to the home page props. Field
// names are the slugified builder labels (see the `homepage` preset in
// db/generate.ts); missing values degrade to empty strings / an empty list.
function toHomeContent(attributes: Record<string, unknown>): HomeContent {
  let features = Array.isArray(attributes.features) ? attributes.features : []
  return {
    eyebrow: asString(attributes.eyebrow),
    heading: asString(attributes.heading),
    headingAccent: asString(attributes['heading-accent']),
    subheading: asString(attributes.subheading),
    ctaLabel: asString(attributes['cta-label']),
    features: features.map((item) => {
      let group = (item ?? {}) as Record<string, unknown>
      return { title: asString(group.title), body: asString(group.body) }
    }),
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export default createController(routes, {
  actions: {
    async assets(context) {
      return (
        (await assetServer.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
      )
    },

    // Public serving route for uploaded media. Looks the asset up by id and
    // streams the stored bytes with the recorded content type; the :filename
    // segment is cosmetic and never touches the filesystem, so this route
    // cannot be used for path traversal.
    async uploads(context) {
      let db = context.get(Database)!
      let id = Number(context.params.id)
      let asset = Number.isInteger(id) ? await findAsset(db, id) : null
      let object = asset ? await readAssetObject(asset) : null
      if (!asset || !object) {
        return new Response('Not Found', { status: 404 })
      }

      // Node accepts a Uint8Array body at runtime; the bundled lib types omit
      // typed arrays from BodyInit, so cast at this single boundary.
      return new Response(object.bytes as unknown as BodyInit, {
        headers: {
          'Content-Type': asset.mimeType,
          'Content-Length': String(asset.size),
          'Content-Disposition': `inline; filename="${asset.filename.replace(/"/g, '')}"`,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      })
    },

    // The home page is a consumer of the app's own public API. It reads the
    // newest published Homepage entry and renders it; with no such entry (fresh
    // DB) or a token-gated API it falls back to the static default copy. A
    // "Read the blog" link appears whenever any Article is published.
    async home(context) {
      let cms = context.get(CmsClientKey)!

      let homepages = await cms.listEntries('homepages', {
        populate: true,
        sort: '-publishedAt',
        pageSize: 1,
      })
      let entry = homepages.ok ? homepages.data[0] : undefined
      let content = entry ? toHomeContent(entry.attributes) : undefined

      let articles = await cms.listEntries('articles', { pageSize: 1 })
      let showBlogLink = articles.ok && articles.data.length > 0

      return context.render(<HomePage content={content} showBlogLink={showBlogLink} />)
    },
  },
})
