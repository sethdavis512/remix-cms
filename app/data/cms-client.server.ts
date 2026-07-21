import { routes } from '../routes.ts'

// A small typed consumer of the app's own public JSON API. The public pages are
// literally an API consumer: they call the same `/api/:type` endpoints an
// external client would, dispatched in-process through a fetch function (the
// router's own `fetch`). Because the API runs `runScheduledWork` on every read,
// scheduled publishing fires automatically when these pages are viewed.
//
// Any non-200 response (for example a 401 when `require_api_token` is on) is
// treated as "unavailable": lists come back empty with `ok: false` and single
// lookups come back `null`, so callers can fall back to static content.

// Mirrors the API serializer shape (see app/actions/api/controller.tsx).
export interface ApiEntry {
  id: number
  attributes: Record<string, unknown>
  publishedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ListResult {
  ok: boolean
  data: ApiEntry[]
}

export interface ListOptions {
  populate?: boolean
  sort?: string
  filters?: Record<string, string>
  pageSize?: number
}

type FetchFn = (request: Request) => Promise<Response>

export class CmsClient {
  #fetch: FetchFn
  #origin: string

  constructor(fetchFn: FetchFn, origin: string) {
    this.#fetch = fetchFn
    this.#origin = origin
  }

  async listEntries(type: string, options: ListOptions = {}): Promise<ListResult> {
    let params = new URLSearchParams()
    if (options.populate) params.set('populate', '1')
    if (options.sort) params.set('sort', options.sort)
    if (options.pageSize != null) params.set('pageSize', String(options.pageSize))
    for (let [name, value] of Object.entries(options.filters ?? {})) {
      params.set(`filter[${name}]`, value)
    }

    let response = await this.#fetch(new Request(this.#url(routes.api.list.href({ type }), params)))
    if (response.status !== 200) return { ok: false, data: [] }
    let body = (await response.json()) as { data: ApiEntry[] }
    return { ok: true, data: body.data }
  }

  async getEntry(
    type: string,
    id: string | number,
    options: { populate?: boolean } = {},
  ): Promise<ApiEntry | null> {
    let params = new URLSearchParams()
    if (options.populate) params.set('populate', '1')

    let response = await this.#fetch(
      new Request(this.#url(routes.api.show.href({ type, id: String(id) }), params)),
    )
    if (response.status !== 200) return null
    let body = (await response.json()) as { data: ApiEntry }
    return body.data
  }

  #url(path: string, params: URLSearchParams): string {
    let query = params.toString()
    return `${this.#origin}${path}${query ? `?${query}` : ''}`
  }
}
