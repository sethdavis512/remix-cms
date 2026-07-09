import { createController } from 'remix/router'
import { Database } from 'remix/data-table'

import { findContentTypeByPluralApiId } from '../../data/content-types.server.ts'
import {
  findPublishedEntry,
  listPublishedEntries,
  type Entry,
} from '../../data/entries.server.ts'
import { routes } from '../../routes.ts'

// Public, read-only headless API. Only published entries are ever exposed;
// drafts and the admin surface stay private. Content types are addressed by
// their plural api id, e.g. GET /api/articles and GET /api/articles/1.

function serialize(entry: Entry) {
  return {
    id: entry.id,
    attributes: entry.data,
    publishedAt: entry.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

export default createController(routes.api, {
  actions: {
    async list(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByPluralApiId(db, context.params.type)
      if (!contentType) {
        return Response.json({ error: 'Not Found' }, { status: 404 })
      }

      let entries = await listPublishedEntries(db, contentType.id)
      return Response.json({ data: entries.map(serialize) })
    },

    async show(context) {
      let db = context.get(Database)!
      let contentType = await findContentTypeByPluralApiId(db, context.params.type)
      if (!contentType) {
        return Response.json({ error: 'Not Found' }, { status: 404 })
      }

      let id = Number(context.params.id)
      let entry = Number.isInteger(id) ? await findPublishedEntry(db, id) : null
      if (!entry || entry.contentTypeId !== contentType.id) {
        return Response.json({ error: 'Not Found' }, { status: 404 })
      }

      return Response.json({ data: serialize(entry) })
    },
  },
})
