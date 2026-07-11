import type { AppDatabase } from './db.ts'
import { components, type ComponentRow } from './schema.ts'
import type { FieldDef } from '../utils/fields.ts'

// Reusable field groups ("components"). A component's `schema` column stores a
// JSON array of scalar FieldDefs; content types embed a component by api id
// via a field with type 'component'. Clean shape returned to controllers.
export interface Component {
  id: number
  name: string
  apiId: string
  fields: FieldDef[]
  createdAt: number
  updatedAt: number
}

export interface ComponentInput {
  name: string
  apiId: string
  fields: FieldDef[]
}

function toComponent(row: ComponentRow): Component {
  let fields: FieldDef[] = []
  try {
    let parsed = JSON.parse(row.schema)
    if (Array.isArray(parsed)) fields = parsed
  } catch {
    fields = []
  }

  return {
    id: row.id,
    name: row.name,
    apiId: row.api_id,
    fields,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listComponents(db: AppDatabase): Promise<Component[]> {
  let rows = await db.findMany(components, { orderBy: ['name', 'asc'] })
  return rows.map(toComponent)
}

export async function findComponent(db: AppDatabase, id: number): Promise<Component | null> {
  let row = await db.find(components, id)
  return row ? toComponent(row) : null
}

export async function findComponentByApiId(
  db: AppDatabase,
  apiId: string,
): Promise<Component | null> {
  let row = await db.findOne(components, { where: { api_id: apiId } })
  return row ? toComponent(row) : null
}

export async function createComponent(
  db: AppDatabase,
  input: ComponentInput,
): Promise<Component> {
  let now = Date.now()
  let created = await db.create(
    components,
    {
      name: input.name,
      api_id: input.apiId,
      schema: JSON.stringify(input.fields),
      created_at: now,
      updated_at: now,
    },
    { returnRow: true },
  )
  return toComponent(created)
}

export async function updateComponent(
  db: AppDatabase,
  id: number,
  input: ComponentInput,
): Promise<Component> {
  let updated = await db.update(components, id, {
    name: input.name,
    api_id: input.apiId,
    schema: JSON.stringify(input.fields),
    updated_at: Date.now(),
  })
  return toComponent(updated)
}

export async function deleteComponent(db: AppDatabase, id: number): Promise<void> {
  await db.delete(components, id)
}

// api_id -> sub-fields lookup used when building entry schemas and forms.
export function componentFieldsByApiId(list: Component[]): Record<string, FieldDef[]> {
  let map: Record<string, FieldDef[]> = {}
  for (let component of list) map[component.apiId] = component.fields
  return map
}
