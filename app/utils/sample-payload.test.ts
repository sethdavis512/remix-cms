import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { FieldDef } from './fields.ts'
import { sampleAttributes, sampleEntry, sampleListPayload } from './sample-payload.ts'

function field(partial: Partial<FieldDef> & Pick<FieldDef, 'name' | 'type'>): FieldDef {
  return {
    label: partial.name,
    required: false,
    unique: false,
    options: [],
    ...partial,
  }
}

test('sampleAttributes produces a value shaped to each scalar field type', () => {
  let attributes = sampleAttributes([
    field({ name: 'title', type: 'text' }),
    field({ name: 'views', type: 'number' }),
    field({ name: 'featured', type: 'boolean' }),
    field({ name: 'publishedOn', type: 'date' }),
    field({ name: 'contact', type: 'email' }),
    field({ name: 'status', type: 'enumeration', options: ['draft', 'published'] }),
  ])

  assert.equal(typeof attributes.title, 'string')
  assert.equal(attributes.views, 42)
  assert.equal(attributes.featured, true)
  assert.equal(attributes.publishedOn, '2024-01-01')
  assert.match(attributes.contact as string, /@/)
  // Enumerations sample the first declared option.
  assert.equal(attributes.status, 'draft')
})

test('component fields nest their sub-fields, respecting repeatable', () => {
  let components = {
    seo: [field({ name: 'metaTitle', type: 'text' }), field({ name: 'noindex', type: 'boolean' })],
  }
  let attributes = sampleAttributes(
    [
      field({ name: 'meta', type: 'component', component: 'seo' }),
      field({ name: 'blocks', type: 'component', component: 'seo', repeatable: true }),
    ],
    components,
  )

  assert.deepEqual(attributes.meta, { metaTitle: 'Lorem ipsum', noindex: true })
  assert.ok(Array.isArray(attributes.blocks))
  assert.equal((attributes.blocks as unknown[]).length, 1)
})

test('media fields sample the expanded asset descriptor the API serves', () => {
  let attributes = sampleAttributes([field({ name: 'photo', type: 'media' })])
  assert.deepEqual(Object.keys(attributes.photo as Record<string, unknown>), [
    'url',
    'filename',
    'mimeType',
    'size',
  ])
})

test('sampleEntry mirrors the API serialize envelope', () => {
  let entry = sampleEntry([field({ name: 'title', type: 'text' })])
  assert.deepEqual(Object.keys(entry), [
    'id',
    'attributes',
    'locale',
    'publishedAt',
    'createdAt',
    'updatedAt',
  ])
  assert.equal(entry.locale, 'en')
})

test('sampleListPayload is valid JSON wrapping a data array', () => {
  let payload = sampleListPayload([field({ name: 'title', type: 'text' })])
  let parsed = JSON.parse(payload)
  assert.ok(Array.isArray(parsed.data))
  assert.equal(parsed.data[0].attributes.title, 'Lorem ipsum')
  assert.deepEqual(parsed.meta.pagination, { page: 1, pageSize: 25, pageCount: 1, total: 1 })
})
