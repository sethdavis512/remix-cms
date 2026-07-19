import { createController } from 'remix/router'
import { Database } from 'remix/data-table'

import {
  findContentTypeByPluralApiId,
  type ContentType,
} from '#app/data/content-types.server.ts'
import {
  findPublishedEntry,
  listPublishedEntries,
  type Entry,
  type EntryFieldFilter,
  type EntrySort,
  type EntrySortColumn,
} from '#app/data/entries.server.ts'
import type { AppDatabase } from '#app/data/db.ts'
import { findAsset, assetUrlPath } from '#app/data/assets.server.ts'
import { authorizeApiRequest } from '#app/data/api-tokens.server.ts'
import { runScheduledWork } from '#app/data/scheduler.server.ts'
import { paginate } from '#app/utils/pagination.ts'
import { routes } from '#app/routes.ts'

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

// ?sort= accepts real entry columns only (never JSON data fields), with a `-`
// prefix for descending, e.g. ?sort=-publishedAt. Omitted -> the default list
// order (newest created first).
const SORT_FIELDS: Record<string, EntrySortColumn> = {
  id: 'id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  publishedAt: 'published_at',
}

function parseSort(raw: string | null): EntrySort | Response | undefined {
  if (raw === null) return undefined
  let descending = raw.startsWith('-')
  let key = descending ? raw.slice(1) : raw
  let column = SORT_FIELDS[key]
  if (!column) {
    return Response.json(
      { error: `Unknown sort field "${key}". Sortable fields: ${Object.keys(SORT_FIELDS).join(', ')}` },
      { status: 400 },
    )
  }
  return { column, direction: descending ? 'desc' : 'asc' }
}

// ?filter[fieldName]=value equality filters against the content type's own
// fields. Field names are validated against the schema and values are coerced
// to the field's type; anything that doesn't line up is a 400 rather than a
// silent empty result. Component and repeatable fields hold objects/arrays,
// where scalar equality is meaningless, so they are rejected.
function parseFilters(
  searchParams: URLSearchParams,
  contentType: ContentType,
): EntryFieldFilter[] | Response {
  let filters: EntryFieldFilter[] = []
  for (let [key, raw] of searchParams) {
    let match = /^filter\[(.*)\]$/.exec(key)
    if (!match) continue
    let name = match[1]!
    let field = contentType.fields.find((f) => f.name === name)
    if (!field) {
      return Response.json({ error: `Unknown filter field "${name}"` }, { status: 400 })
    }
    if (field.type === 'component' || field.repeatable) {
      return Response.json(
        { error: `Field "${name}" cannot be filtered on` },
        { status: 400 },
      )
    }

    if (field.type === 'number' || field.type === 'media' || field.type === 'relation') {
      let value = Number(raw)
      if (raw.trim() === '' || !Number.isFinite(value)) {
        return Response.json(
          { error: `Filter value for "${name}" must be a number` },
          { status: 400 },
        )
      }
      filters.push({ name, value })
    } else if (field.type === 'boolean') {
      if (raw !== 'true' && raw !== 'false' && raw !== '1' && raw !== '0') {
        return Response.json(
          { error: `Filter value for "${name}" must be true or false` },
          { status: 400 },
        )
      }
      filters.push({ name, value: raw === 'true' || raw === '1' })
    } else {
      filters.push({ name, value: raw })
    }
  }
  return filters
}

// Public, read-only headless API. Only published entries are ever exposed;
// drafts and the admin surface stay private. Content types are addressed by
// their plural api id, e.g. GET /api/articles and GET /api/articles/1.
//
// Access: gated by the 'require_api_token' setting (toggled at /admin/tokens).
// While it is off the API is fully public; while it is on every request needs a
// valid "Authorization: Bearer <token>" header (see authorizeApiRequest).

function serialize(entry: Entry, attributes: Record<string, unknown> = entry.data) {
  return {
    id: entry.id,
    attributes,
    publishedAt: entry.publishedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

function wantsPopulate(raw: string | null): boolean {
  return raw === '1' || raw === 'true' || raw === 'yes'
}

// Expand a media field's asset id into a descriptor object built from the
// serving route. Missing or deleted assets resolve to null. `origin` is the
// request origin, so `url` comes back as an absolute URL.
async function expandMedia(db: AppDatabase, id: unknown, origin: string) {
  if (typeof id !== 'number') return null
  let asset = await findAsset(db, id)
  if (!asset) return null
  return {
    url: `${origin}${assetUrlPath(asset)}`,
    filename: asset.filename,
    mimeType: asset.mimeType,
    size: asset.size,
  }
}

// Serialize an entry for the public API. Media fields are always expanded to a
// { url, filename, mimeType, size } object (or null when the asset is gone).
// Relation fields stay as raw ids unless ?populate=1, which expands each id one
// level into the serialized published target (no recursion; unpublished or
// missing targets resolve to null / are dropped).
async function serializeEntry(
  db: AppDatabase,
  entry: Entry,
  contentType: ContentType,
  populate: boolean,
  origin: string,
) {
  let mediaFields = contentType.fields.filter((field) => field.type === 'media')
  if (mediaFields.length === 0 && !populate) return serialize(entry)

  let attributes: Record<string, unknown> = { ...entry.data }

  for (let field of mediaFields) {
    attributes[field.name] = await expandMedia(db, attributes[field.name], origin)
  }

  if (populate) {
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

      let sort = parseSort(context.url.searchParams.get('sort'))
      if (sort instanceof Response) return sort
      let filters = parseFilters(context.url.searchParams, contentType)
      if (filters instanceof Response) return filters

      let entries = await listPublishedEntries(db, contentType.id, { sort, filters })
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
        data.push(await serializeEntry(db, entry, contentType, populate, context.url.origin))
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
      return Response.json({ data: await serializeEntry(db, entry, contentType, populate, context.url.origin) })
    },
  },
})
