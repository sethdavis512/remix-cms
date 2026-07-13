import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { createHash, createHmac } from 'node:crypto'

// Object-storage abstraction for uploaded media bytes. Assets always store an
// opaque `<uuid>-<sanitized-name>` key; the driver decides where the bytes
// physically live. The local-disk driver is the default; the S3-compatible
// driver takes over when the AWS_* environment variables are present (see
// `getStorage`). Consumers of media never touch the driver directly — they go
// through assets.server.ts and the /uploads/:id/:filename serving route.

export interface StoredObject {
  bytes: Uint8Array
  // The content type reported by the backend, when it knows one. The serving
  // route ignores this and streams the mime type recorded in the database, so
  // an empty string here is fine.
  contentType: string
}

export interface StorageDriver {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  delete(key: string): Promise<void>
}

// ----- Local disk driver -----

// On-disk home for uploaded bytes. Kept out of the repo (see .gitignore).
// Resolved lazily (not a module const) so tests can point UPLOADS_DIR at a temp
// dir. The stored key is always a bare basename, so joining it to UPLOADS_DIR
// can never escape the uploads directory.
export function uploadsDir(): string {
  return process.env.UPLOADS_DIR ?? path.resolve('uploads')
}

function diskPath(key: string): string {
  return path.join(uploadsDir(), path.basename(key))
}

const diskDriver: StorageDriver = {
  async put(key, bytes) {
    await fsp.mkdir(uploadsDir(), { recursive: true })
    await fsp.writeFile(diskPath(key), bytes)
  },

  async get(key) {
    let file = diskPath(key)
    if (!fs.existsSync(file)) return null
    let bytes = new Uint8Array(await fsp.readFile(file))
    return { bytes, contentType: '' }
  },

  async delete(key) {
    // Best-effort removal; a missing file must not fail the delete.
    await fsp.rm(diskPath(key), { force: true }).catch(() => {})
  },
}

// ----- S3-compatible driver -----

interface S3Config {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  urlStyle: string
}

function s3Config(): S3Config {
  return {
    endpoint: process.env.AWS_ENDPOINT_URL!,
    bucket: process.env.AWS_S3_BUCKET_NAME!,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    // Region goes into the credential scope verbatim; Railway sets it to "auto".
    region: process.env.AWS_DEFAULT_REGION ?? 'auto',
    urlStyle: process.env.AWS_S3_URL_STYLE ?? 'virtual-host',
  }
}

const EMPTY = new Uint8Array(0)

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

// RFC 3986 encoding for a single path segment. encodeURIComponent leaves a few
// characters unescaped that AWS expects encoded.
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!*'()]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

interface S3Target {
  url: string
  host: string
  canonicalUri: string
}

// Resolve the request URL, Host header, and canonical URI for an object key.
// Virtual-host style puts the bucket in the subdomain (the Railway default);
// anything else falls back to path-style (bucket as the first path segment),
// which is what the test fake uses.
function s3Target(config: S3Config, key: string): S3Target {
  let endpoint = new URL(config.endpoint)
  let encodedKey = key.split('/').map(encodeSegment).join('/')

  if (config.urlStyle === 'virtual-host') {
    let host = `${config.bucket}.${endpoint.host}`
    let canonicalUri = `/${encodedKey}`
    return { url: `${endpoint.protocol}//${host}${canonicalUri}`, host, canonicalUri }
  }

  let host = endpoint.host
  let canonicalUri = `/${encodeSegment(config.bucket)}/${encodedKey}`
  return { url: `${endpoint.protocol}//${host}${canonicalUri}`, host, canonicalUri }
}

// Sign and send one S3 request with AWS Signature Version 4. We sign exactly
// host;x-amz-content-sha256;x-amz-date over a hashed payload. The Host header is
// not set on the fetch call (it is a forbidden header) — fetch derives it from
// the URL to the same value we signed.
async function s3Fetch(
  config: S3Config,
  method: string,
  key: string,
  payload: Uint8Array,
  contentType?: string,
): Promise<Response> {
  let { url, host, canonicalUri } = s3Target(config, key)

  let amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  let dateStamp = amzDate.slice(0, 8)
  let payloadHash = sha256Hex(payload)
  let scope = `${dateStamp}/${config.region}/s3/aws4_request`
  let signedHeaders = 'host;x-amz-content-sha256;x-amz-date'

  let canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`

  let canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  let stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  let kDate = hmac('AWS4' + config.secretAccessKey, dateStamp)
  let kRegion = hmac(kDate, config.region)
  let kService = hmac(kRegion, 's3')
  let kSigning = hmac(kService, 'aws4_request')
  let signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  let authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  let headers: Record<string, string> = {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: authorization,
  }
  if (contentType) headers['Content-Type'] = contentType

  let init: RequestInit = { method, headers }
  // Node/undici accept a Uint8Array body at runtime; the bundled lib types omit
  // typed arrays from BodyInit, so cast at this single boundary.
  if (method === 'PUT') init.body = payload as unknown as BodyInit
  return fetch(url, init)
}

const s3Driver: StorageDriver = {
  async put(key, bytes, contentType) {
    let res = await s3Fetch(s3Config(), 'PUT', key, bytes, contentType)
    if (!res.ok) {
      throw new Error(`S3 put failed for ${key}: ${res.status} ${res.statusText}`)
    }
  },

  async get(key) {
    let res = await s3Fetch(s3Config(), 'GET', key, EMPTY)
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`S3 get failed for ${key}: ${res.status} ${res.statusText}`)
    }
    let bytes = new Uint8Array(await res.arrayBuffer())
    return { bytes, contentType: res.headers.get('content-type') ?? '' }
  },

  async delete(key) {
    // Best-effort, like the disk driver: never throw on a failed delete.
    await s3Fetch(s3Config(), 'DELETE', key, EMPTY).catch(() => {})
  },
}

// ----- Driver selection -----

// The S3 driver is used only when both the endpoint and bucket are configured;
// otherwise storage stays on local disk with its existing behavior. Evaluated
// per call (not cached) so tests can toggle the environment cleanly.
export function isS3Configured(): boolean {
  return Boolean(process.env.AWS_ENDPOINT_URL && process.env.AWS_S3_BUCKET_NAME)
}

export function getStorage(): StorageDriver {
  return isS3Configured() ? s3Driver : diskDriver
}
