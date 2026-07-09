import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { createDatabase } from 'remix/data-table'
import { createMigrationRunner } from 'remix/data-table/migrations'
import { loadMigrations } from 'remix/data-table/migrations/node'
import { createSqliteDatabaseAdapter } from 'remix/data-table/sqlite'
import { createMemorySessionStorage } from 'remix/session-storage/memory'

import { createAppRouter, type AppRouter } from './router.ts'
import { users } from './data/schema.ts'
import { hashPassword } from './utils/password.ts'
import { routes } from './routes.ts'

// Note: this app uses node:test (driven by `node --test`), the runner the Remix
// v3 starter ships with, rather than vitest. Tests drive the app through
// `router.fetch(new Request(...))` and assert on the returned Response, with a
// fresh in-memory database and memory session storage per suite for isolation.

const ORIGIN = 'http://localhost'

async function buildApp(): Promise<{ router: AppRouter }> {
  let sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  let adapter = createSqliteDatabaseAdapter(sqlite)
  let migrations = await loadMigrations(path.resolve('db/migrations'))
  await createMigrationRunner(adapter, migrations).up()

  let db = createDatabase(adapter)
  let now = Date.now()
  await db.create(users, {
    email: 'admin@example.com',
    name: 'Admin',
    password_hash: hashPassword('password123'),
    role: 'admin',
    created_at: now,
    updated_at: now,
  })

  let router = createAppRouter({ database: db, sessionStorage: createMemorySessionStorage() })
  return { router }
}

function form(data: Record<string, string | string[]>): URLSearchParams {
  let params = new URLSearchParams()
  for (let [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item))
    else params.append(key, value)
  }
  return params
}

function req(pathname: string, init: (RequestInit & { cookie?: string }) | undefined = {}): Request {
  let headers = new Headers(init.headers)
  if (init.cookie) headers.set('Cookie', init.cookie)
  if (init.body) headers.set('Content-Type', 'application/x-www-form-urlencoded')
  return new Request(ORIGIN + pathname, { ...init, headers })
}

function sessionCookie(response: Response): string {
  let setCookie = response.headers.getSetCookie()[0] ?? ''
  return setCookie.split(';')[0]
}

async function login(router: AppRouter): Promise<string> {
  let response = await router.fetch(
    req(routes.auth.login.href(), {
      method: 'POST',
      body: form({ email: 'admin@example.com', password: 'password123', returnTo: '' }),
    }),
  )
  assert.equal(response.status, 303)
  return sessionCookie(response)
}

const ARTICLE_FIELDS = {
  name: 'Article',
  kind: 'collection',
  field_name: ['title', 'body'],
  field_label: ['Title', 'Body'],
  field_type: ['text', 'richtext'],
  field_required: ['yes', 'no'],
  field_unique: ['no', 'no'],
  field_options: ['', ''],
}

async function createArticleType(router: AppRouter, cookie: string): Promise<void> {
  let response = await router.fetch(
    req(routes.admin.types.create.href(), { method: 'POST', cookie, body: form(ARTICLE_FIELDS) }),
  )
  assert.equal(response.status, 303)
}

describe('auth', () => {
  it('redirects unauthenticated admin requests to login', async () => {
    let { router } = await buildApp()
    let response = await router.fetch(req(routes.admin.index.href()))
    assert.equal(response.status, 303)
    assert.match(response.headers.get('location') ?? '', /\/auth\/login/)
  })

  it('rejects invalid credentials with 401', async () => {
    let { router } = await buildApp()
    let response = await router.fetch(
      req(routes.auth.login.href(), {
        method: 'POST',
        body: form({ email: 'admin@example.com', password: 'wrong', returnTo: '' }),
      }),
    )
    assert.equal(response.status, 401)
  })

  it('logs in with valid credentials and grants access to the admin', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    assert.notEqual(cookie, '')

    let response = await router.fetch(req(routes.admin.index.href(), { cookie }))
    assert.equal(response.status, 200)
  })
})

describe('content-type builder', () => {
  it('creates a content type that then appears in the list', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)

    let response = await router.fetch(req(routes.admin.types.index.href(), { cookie }))
    assert.equal(response.status, 200)
    let html = await response.text()
    assert.match(html, /Article/)
    assert.match(html, /article/) // the derived api id
  })

  it('rejects a content type with no name', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    let response = await router.fetch(
      req(routes.admin.types.create.href(), {
        method: 'POST',
        cookie,
        body: form({ name: '', kind: 'collection' }),
      }),
    )
    assert.equal(response.status, 400)
  })
})

describe('content manager and API', () => {
  it('validates required fields, persists valid entries, and publishes them', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)

    // Invalid: required title is empty -> re-render with 400
    let invalid = await router.fetch(
      req(routes.admin.content.create.href({ type: 'article' }), {
        method: 'POST',
        cookie,
        body: form({ title: '', body: 'x' }),
      }),
    )
    assert.equal(invalid.status, 400)

    // Valid create -> redirect to the entry edit page
    let created = await router.fetch(
      req(routes.admin.content.create.href({ type: 'article' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Hello World', body: 'Body copy.' }),
      }),
    )
    assert.equal(created.status, 303)
    let location = created.headers.get('location') ?? ''
    let entryId = location.split('/').pop() ?? ''
    assert.match(entryId, /^\d+$/)

    // Draft is not exposed by the API yet
    let beforePublish = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    assert.equal(beforePublish.status, 200)
    assert.deepEqual(await beforePublish.json(), { data: [] })

    // Publish it
    let published = await router.fetch(
      req(routes.admin.content.publish.href({ type: 'article', entryId }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(published.status, 303)

    // Now the API returns exactly the one published entry
    let afterPublish = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    let body = (await afterPublish.json()) as { data: Array<{ id: number; attributes: Record<string, unknown> }> }
    assert.equal(body.data.length, 1)
    assert.equal(body.data[0]!.attributes.title, 'Hello World')

    // Single-entry endpoint works
    let single = await router.fetch(req(routes.api.show.href({ type: 'articles', id: entryId })))
    assert.equal(single.status, 200)

    // Unknown type is a 404
    let unknown = await router.fetch(req(routes.api.list.href({ type: 'widgets' })))
    assert.equal(unknown.status, 404)
  })
})
