// Build a data-schema form-data schema dynamically from a content type's field
// definitions, so entry input is validated and normalized at the request
// boundary. Values arrive as strings from FormData and are coerced per type.

import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'

import type { FieldDef } from './fields.ts'

// Every form value starts as a string; default to '' so absent fields (e.g. an
// unchecked checkbox) don't blow up before the per-type transform runs.
function baseString() {
  return s.defaulted(s.string(), '')
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function fieldSchema(field: FieldDef) {
  let required = field.required
  let requiredMessage = `${field.label} is required.`

  switch (field.type) {
    case 'number':
      return baseString()
        .transform((value) => value.trim())
        .refine((value) => (required ? value !== '' : true), requiredMessage)
        .transform((value) => (value === '' ? null : Number(value)))
        .refine(
          (value) => value === null || Number.isFinite(value),
          `${field.label} must be a number.`,
        )

    case 'boolean':
      return baseString().transform(
        (value) => value === 'on' || value === 'true' || value === '1' || value === 'yes',
      )

    case 'email':
      return baseString()
        .transform((value) => value.trim())
        .refine((value) => (required ? value !== '' : true), requiredMessage)
        .refine(
          (value) => value === '' || EMAIL_RE.test(value),
          `${field.label} must be a valid email address.`,
        )

    case 'enumeration':
      return baseString()
        .refine((value) => (required ? value !== '' : true), requiredMessage)
        .refine(
          (value) => value === '' || field.options.includes(value),
          `${field.label} is not a valid option.`,
        )

    case 'date':
    case 'richtext':
    case 'text':
    default:
      return baseString()
        .transform((value) => (field.type === 'richtext' ? value : value.trim()))
        .refine((value) => (required ? value !== '' : true), requiredMessage)
  }
}

export function buildEntrySchema(fields: FieldDef[]) {
  let shape: Record<string, ReturnType<typeof f.field>> = {}
  for (let field of fields) {
    shape[field.name] = f.field(fieldSchema(field))
  }
  return f.object(shape)
}
