import { createController } from 'remix/router'
import { Database } from 'remix/data-table'

import { assetServer } from '../assets.ts'
import { findAsset, readAssetObject } from '../data/assets.server.ts'
import { routes } from '../routes.ts'
import { HomePage } from '../ui/home-page.tsx'

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

    home(context) {
      return context.render(<HomePage />)
    },
  },
})
