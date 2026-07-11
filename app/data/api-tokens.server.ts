import { createHash, randomBytes } from 'node:crypto'

import type { AppDatabase } from './db.ts'
import { apiTokens, type ApiTokenRow } from './schema.ts'
import { isApiTokenRequired } from './settings.server.ts'

// Scoped bearer tokens for the public read API. Only a sha256 hash is stored;
// the plaintext token ("rcms_" + 32 random hex bytes) exists exactly once, in
// the createApiToken return value, so it can be shown to the admin one time.

export interface ApiToken {
  id: number
  name: string
  createdAt: number
  lastUsedAt: number | null
}

function toApiToken(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
  }
}

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

export async function listApiTokens(db: AppDatabase): Promise<ApiToken[]> {
  let rows = await db.findMany(apiTokens, { orderBy: ['created_at', 'desc'] })
  return rows.map(toApiToken)
}

export async function findApiToken(db: AppDatabase, id: number): Promise<ApiToken | null> {
  let row = await db.find(apiTokens, id)
  return row ? toApiToken(row) : null
}

export async function createApiToken(
  db: AppDatabase,
  name: string,
): Promise<{ token: ApiToken; plaintext: string }> {
  let plaintext = 'rcms_' + randomBytes(32).toString('hex')
  let created = await db.create(
    apiTokens,
    { name, token_hash: hashToken(plaintext), created_at: Date.now() },
    { returnRow: true },
  )
  return { token: toApiToken(created), plaintext }
}

export async function deleteApiToken(db: AppDatabase, id: number): Promise<void> {
  await db.delete(apiTokens, id)
}

function unauthorized(): Response {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}

// Gate for the public read API. Gating is controlled by the 'require_api_token'
// setting (managed at /admin/tokens), independent of how many tokens exist:
// while it is off the API stays fully public, and while it is on every request
// must carry a valid "Authorization: Bearer <token>". Returns null when the
// request is allowed, or a 401 JSON Response to return as-is. Successful auth
// records last_used_at on the matching token.
export async function authorizeApiRequest(
  db: AppDatabase,
  request: Request,
): Promise<Response | null> {
  if (!(await isApiTokenRequired(db))) return null

  let header = request.headers.get('Authorization') ?? ''
  let match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  if (!match) return unauthorized()

  let hash = hashToken(match[1]!)
  let rows = await db.findMany(apiTokens, { orderBy: ['id', 'asc'] })
  let row = rows.find((candidate) => candidate.token_hash === hash)
  if (!row) return unauthorized()

  await db.update(apiTokens, row.id, { last_used_at: Date.now() })
  return null
}
