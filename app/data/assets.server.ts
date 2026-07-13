import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

import type { AppDatabase } from './db.ts'
import { assets, type AssetRow } from './schema.ts'
import { listContentTypes } from './content-types.server.ts'
import { listEntries } from './entries.server.ts'
import { routes } from '../routes.ts'

// On-disk home for uploaded bytes. Kept out of the repo (see .gitignore); the
// database only stores each file's basename in storage_path, never a full path,
// so serving can never be tricked into reading outside this directory. Resolved
// lazily (not a module const) so tests can point UPLOADS_DIR at a temp dir.
export function uploadsDir(): string {
  return process.env.UPLOADS_DIR ?? path.resolve('uploads')
}

// Clean shape returned to controllers and serialized by the API. `url` is left
// to the caller to build from the serving route (it needs the request origin).
export interface Asset {
  id: number
  filename: string
  mimeType: string
  size: number
  storagePath: string
  uploadedBy: number | null
  createdAt: number
}

export function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    storagePath: row.storage_path,
    uploadedBy: row.uploaded_by ?? null,
    createdAt: row.created_at,
  }
}

// Reduce an original upload name to a safe basename fragment: no directory
// separators, no traversal, only characters that are harmless on disk and in
// URLs. The stored name is prefixed with a random token so two uploads of the
// same file never collide.
export function sanitizeFilename(name: string): string {
  let base = name.split(/[\\/]/).pop() ?? ''
  let cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'file'
}

export async function listAssets(db: AppDatabase): Promise<Asset[]> {
  let rows = await db.findMany(assets, { orderBy: ['created_at', 'desc'] })
  return rows.map(toAsset)
}

export async function findAsset(db: AppDatabase, id: number): Promise<Asset | null> {
  let row = await db.find(assets, id)
  return row ? toAsset(row) : null
}

// Persist the uploaded bytes to disk under UPLOADS_DIR and record the file. The
// stored filename is `<uuid>-<sanitized original>` so it is unique and safe.
export async function createAsset(
  db: AppDatabase,
  input: {
    filename: string
    mimeType: string
    bytes: Uint8Array
    uploadedBy: number | null
  },
): Promise<Asset> {
  await fsp.mkdir(uploadsDir(), { recursive: true })
  let storagePath = `${randomUUID()}-${sanitizeFilename(input.filename)}`
  await fsp.writeFile(path.join(uploadsDir(), storagePath), input.bytes)

  let created = await db.create(
    assets,
    {
      filename: input.filename,
      mime_type: input.mimeType || 'application/octet-stream',
      size: input.bytes.byteLength,
      storage_path: storagePath,
      uploaded_by: input.uploadedBy ?? undefined,
      created_at: Date.now(),
    },
    { returnRow: true },
  )
  return toAsset(created)
}

export async function deleteAsset(db: AppDatabase, asset: Asset): Promise<void> {
  await db.delete(assets, asset.id)
  // Best-effort removal of the file; a missing file must not fail the delete.
  await fsp.rm(path.join(uploadsDir(), asset.storagePath), { force: true }).catch(() => {})
}

// The public URL path for an asset, via the serving route. Prefix with the
// request origin to get an absolute URL (done by the public API serializer).
export function assetUrlPath(asset: Asset): string {
  return routes.uploads.href({ id: String(asset.id), filename: asset.filename })
}

// Absolute on-disk path for a stored asset. Built only from the DB-controlled
// basename joined to UPLOADS_DIR, so it can never escape the uploads directory.
export function assetFilePath(asset: Asset): string {
  return path.join(uploadsDir(), path.basename(asset.storagePath))
}

// Whether the file exists on disk (used by the serving route before streaming).
export function assetFileExists(asset: Asset): boolean {
  return fs.existsSync(assetFilePath(asset))
}

// In-use guard for deletion: scan every content type that has a media field and
// return true if any entry references this asset id. A full scan, like
// nullifyRelationsToEntry — acceptable at current scale given generic JSON
// storage (you cannot query inside entry data).
export async function isAssetInUse(db: AppDatabase, assetId: number): Promise<boolean> {
  let types = await listContentTypes(db)
  for (let type of types) {
    let mediaFields = type.fields.filter((field) => field.type === 'media')
    if (mediaFields.length === 0) continue

    let rows = await listEntries(db, type.id)
    for (let entry of rows) {
      for (let field of mediaFields) {
        if (entry.data[field.name] === assetId) return true
      }
    }
  }
  return false
}
