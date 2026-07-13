import * as fsp from 'node:fs/promises'
import { createController } from 'remix/router'
import { Database } from 'remix/data-table'

import { assetServer } from '../assets.ts'
import { assetFilePath, assetFileExists, findAsset } from '../data/assets.server.ts'
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
      if (!asset || !assetFileExists(asset)) {
        return new Response('Not Found', { status: 404 })
      }

      let bytes = await fsp.readFile(assetFilePath(asset))
      return new Response(bytes, {
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
