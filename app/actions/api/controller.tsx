import { createController } from 'remix/router'
import { Database } from 'remix/data-table'

import {
  findContentTypeByPluralApiId,
  type ContentType,
} from '../../data/content-types.server.ts'
import {
  findPublishedEntry,
  listPublishedEntries,
  type Entry,
} from '../../data/entries.server.ts'
import type { AppDatabase } from '../../data/db.ts'
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

function serialize(entry: Entry, attributes: Record<string, unknown> = entry.data) {
  return {
    id: entry.id,
    attributes,
    locale: entry.locale,
    publishedAt: entry.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

function wantsPopulate(raw: string | null): boolean {
  return raw === '1' || raw === 'true' || raw === 'yes'
}

// Expand an entry's relation fields one level: each referenced id is replaced
// with the serialized target entry (published only). No recursion — nested
// relations on the target stay as raw ids. Unpublished or missing targets
// resolve to null (single) or are dropped (many).
async function serializeEntry(
  db: AppDatabase,
  entry: Entry,
  contentType: ContentType,
  populate: boolean,
) {
  if (!populate) return serialize(entry)

  let attributes: Record<string, unknown> = { ...entry.data }
  for (let field of contentType.fields) {
    if (field.type !== 'relation') continue
    let value = attributes[field.name]
    if (field.repeatable) {
      let ids = Array.isArray(value) ? value : []
      let expanded = []
      for (let id of ids) {
        let target = typeof id === 'number' ? await findPublishedEntry(db, id) : null
        if (target) expanded.push(serialize(target))
      }
      attributes[field.name] = expanded
    } else {
      let target = typeof value === 'number' ? await findPublishedEntry(db, value) : null
      attributes[field.name] = target ? serialize(target) : null
    }
  }
  return serialize(entry, attributes)
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
      let populate = wantsPopulate(context.url.searchParams.get('populate'))
      let data = []
      for (let entry of pageEntries) {
        data.push(await serializeEntry(db, entry, contentType, populate))
      }
      return Response.json({
        data,
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

      let populate = wantsPopulate(context.url.searchParams.get('populate'))
      return Response.json({ data: await serializeEntry(db, entry, contentType, populate) })
    },
  },
})
