import { column as c, table } from 'remix/data-table'
import type { TableRow } from 'remix/data-table'

// Table definitions mirror the DDL in db/migrations. Migrations own the actual
// schema; these give us typed queries via remix/data-table. Timestamps are
// stored as epoch milliseconds (integer).

export const users = table({
  name: 'users',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    email: c.text().notNull().unique(),
    name: c.text().notNull(),
    password_hash: c.text().notNull(),
    role: c.text().notNull(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

export const contentTypes = table({
  name: 'content_types',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    name: c.text().notNull(),
    api_id: c.text().notNull().unique(),
    api_id_plural: c.text().notNull().unique(),
    kind: c.text().notNull(),
    schema: c.text().notNull(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

export const entries = table({
  name: 'entries',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    content_type_id: c.integer().notNull().references('content_types', 'id').onDelete('cascade'),
    data: c.text().notNull(),
    status: c.text().notNull(),
    published_at: c.integer(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

export type UserRow = TableRow<typeof users>
export type ContentTypeRow = TableRow<typeof contentTypes>
export type EntryRow = TableRow<typeof entries>
