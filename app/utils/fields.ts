// Content-type field definitions. A content type's `schema` column stores a
// JSON array of these. Pure helpers only — no framework or DB imports.

export const FIELD_TYPES = [
  'text',
  'richtext',
  'number',
  'boolean',
  'date',
  'email',
  'enumeration',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

export interface FieldDef {
  name: string
  label: string
  type: FieldType
  required: boolean
  unique: boolean
  options: string[]
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  richtext: 'Rich text',
  number: 'Number',
  boolean: 'Boolean',
  date: 'Date',
  email: 'Email',
  enumeration: 'Enumeration',
}

export function isFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value)
}

// Turn a display name into a URL/DB-safe api id, e.g. "Blog Post" -> "blog-post".
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Naive English pluralizer — good enough for generating a plural api id.
export function pluralize(value: string): string {
  if (/[^aeiou]y$/.test(value)) return value.replace(/y$/, 'ies')
  if (/(s|x|z|ch|sh)$/.test(value)) return `${value}es`
  return `${value}s`
}

// Parse the content-type builder form into field defs. The builder renders one
// row per field with aligned same-name inputs (selects for enums so every row
// always submits a value and the parallel arrays stay index-aligned).
export function parseFieldDefs(formData: FormData): FieldDef[] {
  let names = formData.getAll('field_name').map(String)
  let labels = formData.getAll('field_label').map(String)
  let types = formData.getAll('field_type').map(String)
  let required = formData.getAll('field_required').map(String)
  let unique = formData.getAll('field_unique').map(String)
  let options = formData.getAll('field_options').map(String)

  let fields: FieldDef[] = []
  for (let i = 0; i < names.length; i++) {
    let name = slugify(names[i] ?? '')
    if (!name) continue

    let type = types[i] ?? 'text'
    fields.push({
      name,
      label: (labels[i] ?? '').trim() || names[i]!.trim(),
      type: isFieldType(type) ? type : 'text',
      required: required[i] === 'yes',
      unique: unique[i] === 'yes',
      options: (options[i] ?? '')
        .split(',')
        .map((option) => option.trim())
        .filter(Boolean),
    })
  }

  return fields
}
