// Build a representative sample of the JSON the public read API serves for a
// content type, so developers can see the response shape before any entry
// exists (à la Contentful's "sample payload"). Pure helpers only — no
// framework or DB imports. The envelope here must mirror `serialize()` in the
// public API controller (app/actions/api/controller.tsx).

import type { FieldDef } from './fields.ts'

// A fixed epoch (2024-01-01T00:00:00Z) so timestamps render as the same
// millisecond numbers the API emits, without depending on the clock.
const SAMPLE_TIMESTAMP = 1704067200000

// Example value for one field, matching the coerced type the API serves (see
// field-schema.ts). `components` maps a component api id to its sub-field defs
// so component fields can nest.
export function sampleFieldValue(
  field: FieldDef,
  components: Record<string, FieldDef[]> = {},
): unknown {
  switch (field.type) {
    case 'number':
      return 42
    case 'boolean':
      return true
    case 'date':
      return '2024-01-01'
    case 'email':
      return 'jane@example.com'
    case 'enumeration':
      return field.options[0] ?? 'option-a'
    case 'richtext':
      return 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'
    case 'component': {
      let subFields = components[field.component ?? ''] ?? []
      let group = sampleAttributes(subFields, components)
      return field.repeatable ? [group] : group
    }
    case 'relation':
      // Raw target entry id(s); ?populate=1 expands these to the full entries.
      return field.repeatable ? [1, 2] : 1
    case 'media':
      // The API always expands a media id into an asset descriptor (or null
      // when the asset is missing); mirror that shape here.
      return {
        url: 'https://cms.example.com/uploads/1/photo.jpg',
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        size: 12345,
      }
    case 'text':
    default:
      return 'Lorem ipsum'
  }
}

// The sample `attributes` object (the entry's field values, keyed by api id).
export function sampleAttributes(
  fields: FieldDef[],
  components: Record<string, FieldDef[]> = {},
): Record<string, unknown> {
  let attributes: Record<string, unknown> = {}
  for (let field of fields) {
    attributes[field.name] = sampleFieldValue(field, components)
  }
  return attributes
}

// One serialized entry, matching the API's `serialize()` envelope. Entries
// always carry a locale ('en' by default, even for non-localized types).
export function sampleEntry(
  fields: FieldDef[],
  components: Record<string, FieldDef[]> = {},
) {
  return {
    id: 1,
    attributes: sampleAttributes(fields, components),
    locale: 'en',
    publishedAt: SAMPLE_TIMESTAMP,
    createdAt: SAMPLE_TIMESTAMP,
    updatedAt: SAMPLE_TIMESTAMP,
  }
}

// The list-endpoint response body (`GET /api/<plural>`): a `data` array plus a
// `meta.pagination` block. The envelope here must mirror the list action in the
// public API controller (app/actions/api/controller.tsx).
export function sampleListPayload(
  fields: FieldDef[],
  components: Record<string, FieldDef[]> = {},
): string {
  return JSON.stringify(
    {
      data: [sampleEntry(fields, components)],
      meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } },
    },
    null,
    2,
  )
}
