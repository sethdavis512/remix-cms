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
  'component',
] as const

export type FieldType = (typeof FIELD_TYPES)[number]

// Components may only contain scalar fields (single-level nesting).
export const SCALAR_FIELD_TYPES = FIELD_TYPES.filter((type) => type !== 'component')

export interface FieldDef {
  name: string
  label: string
  type: FieldType
  required: boolean
  unique: boolean
  options: string[]
  // Only set for type 'component': the api id of the referenced component and
  // whether the field holds a list of items or a single group.
  component?: string
  repeatable?: boolean
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  richtext: 'Rich text',
  number: 'Number',
  boolean: 'Boolean',
  date: 'Date',
  email: 'Email',
  enumeration: 'Enumeration',
  component: 'Component',
}

export function isFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value)
}

// Human-readable label for an entry: the first text-ish field value, falling
// back to "Entry #<id>".
export function entryLabel(
  entryId: number,
  data: Record<string, unknown>,
  fields: FieldDef[],
): string {
  let firstText = fields.find((f) => f.type === 'text' || f.type === 'email')
  if (firstText) {
    let value = data[firstText.name]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return `Entry #${entryId}`
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

// Parse a field-builder form into field defs. Builders render one row per
// field with aligned same-name inputs (selects for enums so every row always
// submits a value and the parallel arrays stay index-aligned). The component
// builder parses with the default options so a 'component' type can never
// nest inside a component; the content-type builder passes allowComponent.
export function parseFieldDefs(
  formData: FormData,
  parseOptions: { allowComponent?: boolean } = {},
): FieldDef[] {
  let names = formData.getAll('field_name').map(String)
  let labels = formData.getAll('field_label').map(String)
  let types = formData.getAll('field_type').map(String)
  let required = formData.getAll('field_required').map(String)
  let unique = formData.getAll('field_unique').map(String)
  let options = formData.getAll('field_options').map(String)
  let componentIds = formData.getAll('field_component').map(String)
  let repeatable = formData.getAll('field_repeatable').map(String)

  let fields: FieldDef[] = []
  for (let i = 0; i < names.length; i++) {
    let name = slugify(names[i] ?? '')
    if (!name) continue

    let rawType = types[i] ?? 'text'
    let type: FieldType = isFieldType(rawType) ? rawType : 'text'
    if (type === 'component' && !parseOptions.allowComponent) type = 'text'

    let field: FieldDef = {
      name,
      label: (labels[i] ?? '').trim() || names[i]!.trim(),
      type,
      required: required[i] === 'yes',
      unique: unique[i] === 'yes',
      options: (options[i] ?? '')
        .split(',')
        .map((option) => option.trim())
        .filter(Boolean),
    }

    if (type === 'component') {
      field.component = (componentIds[i] ?? '').trim()
      field.repeatable = repeatable[i] === 'yes'
    }

    fields.push(field)
  }

  return fields
}
