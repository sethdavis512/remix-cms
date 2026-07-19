import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { paginate, paginateList, pageHref, DEFAULT_PAGE_SIZE } from './pagination.ts'

describe('paginate', () => {
  it('defaults to page 1 when the param is null or invalid', () => {
    assert.deepEqual(paginate(100, null, 10), { page: 1, totalPages: 10, total: 100, offset: 0 })
    assert.equal(paginate(100, 'abc', 10).page, 1)
  })

  it('clamps an out-of-range page into [1, totalPages]', () => {
    assert.equal(paginate(30, '99', 10).page, 3)
    assert.equal(paginate(30, '0', 10).page, 1)
    assert.equal(paginate(30, '-5', 10).page, 1)
  })

  it('always reports at least one page, even when empty', () => {
    assert.deepEqual(paginate(0, '1', 10), { page: 1, totalPages: 1, total: 0, offset: 0 })
  })

  it('computes the slice offset from the clamped page', () => {
    assert.equal(paginate(100, '3', 10).offset, 20)
  })

  it('uses DEFAULT_PAGE_SIZE when no size is given', () => {
    assert.equal(paginate(DEFAULT_PAGE_SIZE * 2, null).totalPages, 2)
  })
})

describe('paginateList', () => {
  it('returns the current page slice and pagination block', () => {
    let items = Array.from({ length: 25 }, (_, i) => i)
    let { pagination, items: slice } = paginateList(items, '2', 10)
    assert.deepEqual(pagination, { page: 2, totalPages: 3, total: 25 })
    assert.deepEqual(slice, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })

  it('handles an empty list', () => {
    let { pagination, items } = paginateList([], null, 10)
    assert.deepEqual(pagination, { page: 1, totalPages: 1, total: 0 })
    assert.deepEqual(items, [])
  })
})

describe('pageHref', () => {
  it('appends ?page= for an in-range page', () => {
    assert.equal(pageHref('/admin/media', 2, 3), '/admin/media?page=2')
  })

  it('uses & when the base already has a query string', () => {
    assert.equal(pageHref('/admin/media?q=x', 2, 3), '/admin/media?q=x&page=2')
  })

  it('returns an empty string when the page is out of range', () => {
    assert.equal(pageHref('/admin/media', 0, 3), '')
    assert.equal(pageHref('/admin/media', 4, 3), '')
  })
})
