import type { AppDatabase } from './db.ts'
import { webhooks, type WebhookRow } from './schema.ts'
import type { Entry } from './entries.server.ts'

// Webhooks fire on entry lifecycle events. Delivery is best-effort and
// fire-and-forget: a slow or failing endpoint is logged with console.error and
// never blocks, slows, or fails the request that triggered the event.

export const ENTRY_EVENTS = [
  'entry.created',
  'entry.updated',
  'entry.deleted',
  'entry.published',
  'entry.unpublished',
] as const

export type EntryEvent = (typeof ENTRY_EVENTS)[number]

export function isEntryEvent(value: string): value is EntryEvent {
  return (ENTRY_EVENTS as readonly string[]).includes(value)
}

export interface Webhook {
  id: number
  name: string
  url: string
  events: EntryEvent[]
  enabled: boolean
  createdAt: number
  updatedAt: number
}

// The `data` half of a delivered webhook body: {event, occurredAt, data}.
export interface EntryEventPayload {
  id: number
  contentType: string
  locale: string
  status: 'draft' | 'published'
  data: Record<string, unknown>
  publishedAt: number | null
}

function toWebhook(row: WebhookRow): Webhook {
  let events: EntryEvent[] = []
  try {
    let parsed = JSON.parse(row.events)
    if (Array.isArray(parsed)) {
      events = parsed.filter((event): event is EntryEvent =>
        typeof event === 'string' && isEntryEvent(event),
      )
    }
  } catch {
    events = []
  }

  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listWebhooks(db: AppDatabase): Promise<Webhook[]> {
  let rows = await db.findMany(webhooks, { orderBy: ['created_at', 'asc'] })
  return rows.map(toWebhook)
}

export async function findWebhook(db: AppDatabase, id: number): Promise<Webhook | null> {
  let row = await db.find(webhooks, id)
  return row ? toWebhook(row) : null
}

export async function createWebhook(
  db: AppDatabase,
  input: { name: string; url: string; events: EntryEvent[] },
): Promise<Webhook> {
  let now = Date.now()
  let created = await db.create(
    webhooks,
    {
      name: input.name,
      url: input.url,
      events: JSON.stringify(input.events),
      enabled: 1,
      created_at: now,
      updated_at: now,
    },
    { returnRow: true },
  )
  return toWebhook(created)
}

export async function setWebhookEnabled(
  db: AppDatabase,
  id: number,
  enabled: boolean,
): Promise<Webhook> {
  let updated = await db.update(webhooks, id, {
    enabled: enabled ? 1 : 0,
    updated_at: Date.now(),
  })
  return toWebhook(updated)
}

export async function deleteWebhook(db: AppDatabase, id: number): Promise<void> {
  await db.delete(webhooks, id)
}

// Serializer for entry events: the shape delivered as `data` in the POST body.
export function entryEventPayload(entry: Entry, contentTypeApiId: string): EntryEventPayload {
  return {
    id: entry.id,
    contentType: contentTypeApiId,
    locale: entry.locale,
    status: entry.status,
    data: entry.data,
    publishedAt: entry.publishedAt,
  }
}

// Deliveries still in flight. Requests never await these; tests await them via
// flushWebhookDeliveries() so assertions do not race the POSTs.
const inFlightDeliveries = new Set<Promise<void>>()

export async function dispatchEntryEvent(
  db: AppDatabase,
  event: EntryEvent,
  payload: EntryEventPayload,
): Promise<void> {
  let rows = await db.findMany(webhooks, { where: { enabled: 1 } })
  let subscribed = rows.map(toWebhook).filter((hook) => hook.events.includes(event))
  if (subscribed.length === 0) return

  let body = JSON.stringify({ event, occurredAt: new Date().toISOString(), data: payload })
  for (let hook of subscribed) {
    const delivery: Promise<void> = fetch(hook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    })
      .then((response) => {
        if (!response.ok) {
          console.error(
            `Webhook "${hook.name}" (${hook.url}): ${event} delivery got HTTP ${response.status}`,
          )
        }
      })
      .catch((error) => {
        console.error(`Webhook "${hook.name}" (${hook.url}): ${event} delivery failed:`, error)
      })
      .finally(() => {
        inFlightDeliveries.delete(delivery)
      })
    inFlightDeliveries.add(delivery)
  }
}

// Await every in-flight delivery (including any that start while waiting).
export async function flushWebhookDeliveries(): Promise<void> {
  while (inFlightDeliveries.size > 0) {
    await Promise.all([...inFlightDeliveries])
  }
}
