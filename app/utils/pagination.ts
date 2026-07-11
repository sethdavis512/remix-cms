// Shared pagination helpers. Pure — no framework or DB imports. The public API
// paginates result counts (paginate); admin list pages paginate in-memory arrays
// (paginateList) and build prev/next links (pageHref).

export const DEFAULT_PAGE_SIZE = 20

export interface Pagination {
  page: number
  totalPages: number
  total: number
}

// Clamp a requested page against a known total and compute the slice offset.
// `pageParam` is the raw ?page= value (string | null); anything invalid or out
// of range collapses to the nearest valid page.
export function paginate(
  total: number,
  pageParam: string | null,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Pagination & { offset: number } {
  let totalPages = Math.max(1, Math.ceil(total / pageSize))
  let requested = Number(pageParam ?? '1')
  let page = Number.isInteger(requested) ? requested : 1
  if (page < 1) page = 1
  if (page > totalPages) page = totalPages
  let offset = (page - 1) * pageSize
  return { page, totalPages, total, offset }
}

// Paginate an already-loaded array, returning the current page's slice plus the
// pagination block admin pages pass to the <Pagination> component.
export function paginateList<T>(
  items: T[],
  pageParam: string | null,
  pageSize: number = DEFAULT_PAGE_SIZE,
): { pagination: Pagination; items: T[] } {
  let { page, totalPages, total, offset } = paginate(items.length, pageParam, pageSize)
  return {
    pagination: { page, totalPages, total },
    items: items.slice(offset, offset + pageSize),
  }
}

// Build a ?page= href for a prev/next link. Returns '' when the target page is
// out of range, so the component can render a disabled control at the ends.
export function pageHref(baseHref: string, page: number, totalPages: number): string {
  if (page < 1 || page > totalPages) return ''
  let separator = baseHref.includes('?') ? '&' : '?'
  return `${baseHref}${separator}page=${page}`
}
