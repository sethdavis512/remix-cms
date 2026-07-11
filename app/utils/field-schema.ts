// Build a data-schema schema dynamically from a content type's field
// definitions, so entry input is validated and normalized at the request
// boundary. Form values arrive as strings and are coerced per type; component
// fields nest as objects (single) or arrays of objects (repeatable).

import * as s from 'remix/data-schema'

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

function componentItemSchema(subFields: FieldDef[]) {
  let shape: Record<string, s.Schema<any, any>> = {}
  for (let sub of subFields) shape[sub.name] = fieldSchema(sub)
  return s.object(shape)
}

// A single component validates to an object (or null when left blank); a
// repeatable component validates to an array of objects. Blank groups are
// dropped by extractEntryInput before validation, so sub-field rules only
// apply to items that are actually present.
function componentSchema(field: FieldDef, subFields: FieldDef[]) {
  let item = componentItemSchema(subFields)

  if (field.repeatable) {
    let list = s.array(item)
    return field.required
      ? list.refine((items) => items.length > 0, `${field.label} needs at least one item.`)
      : list
  }

  let single = s.nullable(item)
  return field.required
    ? single.refine((value) => value !== null, `${field.label} is required.`)
    : single
}

// `components` maps a component api id to its sub-field definitions (see
// componentFieldsByApiId). Types without component fields can omit it.
export function buildEntrySchema(fields: FieldDef[], components: Record<string, FieldDef[]> = {}) {
  let shape: Record<string, s.Schema<any, any>> = {}
  for (let field of fields) {
    shape[field.name] =
      field.type === 'component'
        ? componentSchema(field, components[field.component ?? ''] ?? [])
        : fieldSchema(field)
  }
  return s.object(shape)
}

// Reshape flat FormData into the nested raw-input object buildEntrySchema
// validates. Scalar inputs are named '<field>'; component inputs are named
// '<field>.<sub>' (single) or '<field>.<index>.<sub>' (repeatable). All values
// stay raw strings here so the same structure can re-render the form after a
// validation failure. Blank groups (every sub-value empty) are skipped: a
// blank single component becomes null and blank repeatable items are dropped.
export function extractEntryInput(
  formData: FormData,
  fields: FieldDef[],
  components: Record<string, FieldDef[]> = {},
): Record<string, unknown> {
  let input: Record<string, unknown> = {}

  for (let field of fields) {
    if (field.type !== 'component') {
      input[field.name] = String(formData.get(field.name) ?? '')
      continue
    }

    let subFields = components[field.component ?? ''] ?? []
    if (field.repeatable) {
      let items: Record<string, string>[] = []
      for (let index of groupIndexes(formData, field.name)) {
        let item = readGroup(formData, `${field.name}.${index}`, subFields)
        if (!isBlankGroup(item)) items.push(item)
      }
      input[field.name] = items
    } else {
      let item = readGroup(formData, field.name, subFields)
      input[field.name] = isBlankGroup(item) ? null : item
    }
  }

  return input
}

function readGroup(
  formData: FormData,
  prefix: string,
  subFields: FieldDef[],
): Record<string, string> {
  let group: Record<string, string> = {}
  for (let sub of subFields) {
    group[sub.name] = String(formData.get(`${prefix}.${sub.name}`) ?? '')
  }
  return group
}

function isBlankGroup(group: Record<string, string>): boolean {
  return Object.values(group).every((value) => value.trim() === '')
}

// The submitted item indexes for a repeatable field, in order. Scanning the
// actual keys (rather than counting up from zero) tolerates gaps left by
// groups whose inputs all went unsubmitted (e.g. only unchecked checkboxes).
function groupIndexes(formData: FormData, fieldName: string): number[] {
  let indexes = new Set<number>()
  let prefix = `${fieldName}.`
  for (let key of formData.keys()) {
    if (!key.startsWith(prefix)) continue
    let head = key.slice(prefix.length).split('.')[0] ?? ''
    if (/^\d+$/.test(head)) indexes.add(Number(head))
  }
  return [...indexes].sort((a, b) => a - b)
}
