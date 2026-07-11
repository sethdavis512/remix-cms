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

export const locales = table({
  name: 'locales',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    code: c.text().notNull().unique(),
    name: c.text().notNull(),
    is_default: c.integer().notNull(),
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
    localized: c.integer().notNull(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

export const components = table({
  name: 'components',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    name: c.text().notNull(),
    api_id: c.text().notNull().unique(),
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
    locale: c.text().notNull(),
    status: c.text().notNull(),
    published_at: c.integer(),
    publish_at: c.integer(),
    unpublish_at: c.integer(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

export const releases = table({
  name: 'releases',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    name: c.text().notNull(),
    status: c.text().notNull(),
    scheduled_at: c.integer(),
    published_at: c.integer(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

export const releaseItems = table({
  name: 'release_items',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    release_id: c.integer().notNull().references('releases', 'id').onDelete('cascade'),
    entry_id: c.integer().notNull().references('entries', 'id').onDelete('cascade'),
    action: c.text().notNull(),
    created_at: c.integer().notNull(),
  },
})

export const webhooks = table({
  name: 'webhooks',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    name: c.text().notNull(),
    url: c.text().notNull(),
    events: c.text().notNull(),
    enabled: c.integer().notNull(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

export const apiTokens = table({
  name: 'api_tokens',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    name: c.text().notNull(),
    token_hash: c.text().notNull().unique(),
    created_at: c.integer().notNull(),
    last_used_at: c.integer(),
  },
})

export const settings = table({
  name: 'settings',
  primaryKey: 'key',
  columns: {
    key: c.text().notNull(),
    value: c.text().notNull(),
  },
})

export const auditLog = table({
  name: 'audit_log',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    actor_email: c.text().notNull(),
    action: c.text().notNull(),
    subject_type: c.text().notNull(),
    subject_id: c.integer(),
    summary: c.text().notNull(),
    created_at: c.integer().notNull(),
  },
})

export type UserRow = TableRow<typeof users>
export type LocaleRow = TableRow<typeof locales>
export type ContentTypeRow = TableRow<typeof contentTypes>
export type ComponentRow = TableRow<typeof components>
export type EntryRow = TableRow<typeof entries>
export type ReleaseRow = TableRow<typeof releases>
export type ReleaseItemRow = TableRow<typeof releaseItems>
export type WebhookRow = TableRow<typeof webhooks>
export type ApiTokenRow = TableRow<typeof apiTokens>
export type SettingRow = TableRow<typeof settings>
export type AuditLogRow = TableRow<typeof auditLog>
