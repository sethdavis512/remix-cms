import { createController } from 'remix/router'
import { Database } from 'remix/data-table'

import { findContentTypeByPluralApiId } from '../../data/content-types.server.ts'
import {
  findPublishedEntry,
  listPublishedEntries,
  type Entry,
} from '../../data/entries.server.ts'
import { authorizeApiRequest } from '../../data/api-tokens.server.ts'
import { listLocales } from '../../data/locales.server.ts'
import { runScheduledWork } from '../../data/scheduler.server.ts'
import { paginate } from '../../utils/pagination.ts'
import { routes } from '../../routes.ts'

// List pagination follows the common headless-API convention: ?page= and
// ?pageSize=, with a capped page size, and a meta.pagination block alongside
// the data array. Defaults to the first page when the params are omitted.
const API_DEFAULT_PAGE_SIZE = 25
const API_MAX_PAGE_SIZE = 100

function parsePageSize(raw: string | null): number {
  let n = Number(raw ?? String(API_DEFAULT_PAGE_SIZE))
  if (!Number.isInteger(n) || n < 1) return API_DEFAULT_PAGE_SIZE
  return Math.min(n, API_MAX_PAGE_SIZE)
}

// Public, read-only headless API. Only published entries are ever exposed;
// drafts and the admin surface stay private. Content types are addressed by
// their plural api id, e.g. GET /api/articles and GET /api/articles/1.
// Localized types accept ?locale=fr on the list endpoint and serve the
// default locale when the param is omitted.
//
// Access: gated by the 'require_api_token' setting (toggled at /admin/tokens).
// While it is off the API is fully public; while it is on every request needs a
// valid "Authorization: Bearer <token>" header (see authorizeApiRequest).

function serialize(entry: Entry) {
  return {
    id: entry.id,
    attributes: entry.data,
    locale: entry.locale,
    publishedAt: entry.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

export default createController(routes.api, {
  actions: {
    async list(context) {
      let db = context.get(Database)!
      let denied = await authorizeApiRequest(db, context.request)
      if (denied) return denied
      // Lazy schedule check: due releases and per-entry timers flip on the
      // first read after their time, even if the server timer hasn't ticked.
      await runScheduledWork(db)
      let contentType = await findContentTypeByPluralApiId(db, context.params.type)
      if (!contentType) {
        return Response.json({ error: 'Not Found' }, { status: 404 })
      }

      let locale: string | undefined
      if (contentType.localized) {
        let locales = await listLocales(db)
        let requested = context.url.searchParams.get('locale')
        if (requested === null) {
          locale = locales.find((l) => l.isDefault)?.code ?? 'en'
        } else if (locales.some((l) => l.code === requested)) {
          locale = requested
        } else {
          return Response.json({ error: `Unknown locale "${requested}"` }, { status: 400 })
        }
      }

      let entries = await listPublishedEntries(db, contentType.id, locale)
      let pageSize = parsePageSize(context.url.searchParams.get('pageSize'))
      let { page, totalPages, total, offset } = paginate(
        entries.length,
        context.url.searchParams.get('page'),
        pageSize,
      )
      let pageEntries = entries.slice(offset, offset + pageSize)
      return Response.json({
        data: pageEntries.map(serialize),
        meta: { pagination: { page, pageSize, pageCount: totalPages, total } },
      })
    },

    async show(context) {
      let db = context.get(Database)!
      let denied = await authorizeApiRequest(db, context.request)
      if (denied) return denied
      await runScheduledWork(db)
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
