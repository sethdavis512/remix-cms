// Builds a formatted, illustrative JSON string showing what the public read API
// returns for a content type, from its field definitions. Pure — placeholder
// values are shaped to each field's type. Used by the Content-Type Builder's
// "Sample API response" card. Mirrors the API list envelope in
// app/actions/api/controller.tsx (serialize + meta.pagination).

import type { FieldDef } from './fields.ts'

// A placeholder value shaped to a scalar field's type.
function sampleScalar(field: FieldDef): unknown {
  switch (field.type) {
    case 'number':
      return 42
    case 'boolean':
      return true
    case 'email':
      return 'user@example.com'
    case 'date':
      return '2026-01-01'
    case 'enumeration':
      return field.options[0] ?? 'option'
    case 'richtext':
      return 'Rich text content…'
    case 'text':
    default:
      return `Example ${field.label.toLowerCase() || field.name}`
  }
}

// The attributes object for one sample entry: every field mapped to a
// type-shaped placeholder. Component fields nest their sub-fields (an object for
// single, a one-item array for repeatable).
function sampleAttributes(
  fields: FieldDef[],
  componentMap: Record<string, FieldDef[]>,
): Record<string, unknown> {
  let attributes: Record<string, unknown> = {}
  for (let field of fields) {
    if (field.type === 'component') {
      let subFields = componentMap[field.component ?? ''] ?? []
      let group = sampleAttributes(subFields, componentMap)
      attributes[field.name] = field.repeatable ? [group] : group
    } else {
      attributes[field.name] = sampleScalar(field)
    }
  }
  return attributes
}

// The full list-endpoint payload (GET /api/:typePlural), pretty-printed.
export function sampleListPayload(
  fields: FieldDef[],
  componentMap: Record<string, FieldDef[]> = {},
): string {
  let payload = {
    data: [
      {
        id: 1,
        attributes: sampleAttributes(fields, componentMap),
        locale: 'en',
        publishedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } },
  }
  return JSON.stringify(payload, null, 2)
}
