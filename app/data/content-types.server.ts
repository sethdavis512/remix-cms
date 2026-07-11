import type { AppDatabase } from './db.ts'
import { contentTypes, type ContentTypeRow } from './schema.ts'
import type { FieldDef } from '../utils/fields.ts'

// Clean, framework-agnostic shape returned to controllers (never the raw row).
export interface ContentType {
  id: number
  name: string
  apiId: string
  apiIdPlural: string
  kind: 'collection' | 'single'
  localized: boolean
  fields: FieldDef[]
  createdAt: number
  updatedAt: number
}

export interface ContentTypeInput {
  name: string
  apiId: string
  apiIdPlural: string
  kind: 'collection' | 'single'
  localized: boolean
  fields: FieldDef[]
}

function toContentType(row: ContentTypeRow): ContentType {
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
    apiIdPlural: row.api_id_plural,
    kind: row.kind === 'single' ? 'single' : 'collection',
    localized: row.localized === 1,
    fields,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listContentTypes(db: AppDatabase): Promise<ContentType[]> {
  let rows = await db.findMany(contentTypes, { orderBy: ['name', 'asc'] })
  return rows.map(toContentType)
}

export async function findContentType(db: AppDatabase, id: number): Promise<ContentType | null> {
  let row = await db.find(contentTypes, id)
  return row ? toContentType(row) : null
}

export async function findContentTypeByApiId(
  db: AppDatabase,
  apiId: string,
): Promise<ContentType | null> {
  let row = await db.findOne(contentTypes, { where: { api_id: apiId } })
  return row ? toContentType(row) : null
}

export async function findContentTypeByPluralApiId(
  db: AppDatabase,
  apiIdPlural: string,
): Promise<ContentType | null> {
  let row = await db.findOne(contentTypes, { where: { api_id_plural: apiIdPlural } })
  return row ? toContentType(row) : null
}

export async function createContentType(
  db: AppDatabase,
  input: ContentTypeInput,
): Promise<ContentType> {
  let now = Date.now()
  let created = await db.create(
    contentTypes,
    {
      name: input.name,
      api_id: input.apiId,
      api_id_plural: input.apiIdPlural,
      kind: input.kind,
      schema: JSON.stringify(input.fields),
      localized: input.localized ? 1 : 0,
      created_at: now,
      updated_at: now,
    },
    { returnRow: true },
  )
  return toContentType(created)
}

export async function updateContentType(
  db: AppDatabase,
  id: number,
  input: ContentTypeInput,
): Promise<ContentType> {
  let updated = await db.update(contentTypes, id, {
    name: input.name,
    api_id: input.apiId,
    api_id_plural: input.apiIdPlural,
    kind: input.kind,
    schema: JSON.stringify(input.fields),
    localized: input.localized ? 1 : 0,
    updated_at: Date.now(),
  })
  return toContentType(updated)
}

export async function deleteContentType(db: AppDatabase, id: number): Promise<void> {
  await db.delete(contentTypes, id)
}
