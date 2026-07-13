import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as path from 'node:path'
import * as os from 'node:os'
import * as fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { createDatabase } from 'remix/data-table'
import { createMigrationRunner } from 'remix/data-table/migrations'
import { loadMigrations } from 'remix/data-table/migrations/node'
import { createSqliteDatabaseAdapter } from 'remix/data-table/sqlite'
import { createMemorySessionStorage } from 'remix/session-storage/memory'

import { createAppRouter, type AppRouter } from './router.ts'
import { flushWebhookDeliveries } from './data/webhooks.server.ts'
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

  it('renders the dynamic field editor with a single blank row and no save-and-reopen hint', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    let response = await router.fetch(req(routes.admin.types.newForm.href(), { cookie }))
    assert.equal(response.status, 200)
    let html = await response.text()

    // The add/remove client entry is wired (its module URL is emitted for the
    // client runtime to hydrate).
    assert.match(html, /app\/assets\/field-rows\.tsx/)
    assert.match(html, /Add field/)
    // The old "save and re-open" workflow hint is gone.
    assert.doesNotMatch(html, /Save and re-open/)
    // Exactly one blank name input is server-rendered for the no-JS fallback.
    assert.equal((html.match(/name="field_name"/g) ?? []).length, 1)
  })

  it('serves the field-rows client entry module', async () => {
    let { router } = await buildApp()
    let response = await router.fetch(
      req(routes.assets.href({ path: 'app/assets/field-rows.tsx' })),
    )
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /javascript/)
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
    let beforePublishBody = (await beforePublish.json()) as { data: unknown[] }
    assert.deepEqual(beforePublishBody.data, [])

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

  it('paginates the public list endpoint with a meta.pagination block', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)

    // Create and publish three entries.
    for (let title of ['One', 'Two', 'Three']) {
      let created = await router.fetch(
        req(routes.admin.content.create.href({ type: 'article' }), {
          method: 'POST',
          cookie,
          body: form({ title, body: 'x' }),
        }),
      )
      let entryId = (created.headers.get('location') ?? '').split('/').pop() ?? ''
      await router.fetch(
        req(routes.admin.content.publish.href({ type: 'article', entryId }), {
          method: 'POST',
          cookie,
        }),
      )
    }

    // First page of two, with the pagination metadata.
    let page1 = await router.fetch(req(routes.api.list.href({ type: 'articles' }) + '?pageSize=2'))
    let body1 = (await page1.json()) as {
      data: unknown[]
      meta: { pagination: { page: number; pageSize: number; pageCount: number; total: number } }
    }
    assert.equal(body1.data.length, 2)
    assert.deepEqual(body1.meta.pagination, { page: 1, pageSize: 2, pageCount: 2, total: 3 })

    // Second page holds the remainder.
    let page2 = await router.fetch(
      req(routes.api.list.href({ type: 'articles' }) + '?pageSize=2&page=2'),
    )
    let body2 = (await page2.json()) as { data: unknown[]; meta: { pagination: { page: number } } }
    assert.equal(body2.data.length, 1)
    assert.equal(body2.meta.pagination.page, 2)

    // An out-of-range page clamps to the last page rather than erroring.
    let pageBig = await router.fetch(
      req(routes.api.list.href({ type: 'articles' }) + '?pageSize=2&page=99'),
    )
    let bodyBig = (await pageBig.json()) as { meta: { pagination: { page: number } } }
    assert.equal(bodyBig.meta.pagination.page, 2)
  })

  it('renders the pager on an admin list once it overflows one page', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)

    // 21 entries -> 2 pages at 20 per page.
    for (let i = 1; i <= 21; i++) {
      await router.fetch(
        req(routes.admin.content.create.href({ type: 'article' }), {
          method: 'POST',
          cookie,
          body: form({ title: `Entry ${i}`, body: 'x' }),
        }),
      )
    }

    let page1 = await router.fetch(
      req(routes.admin.content.index.href({ type: 'article' }), { cookie }),
    )
    let html1 = await page1.text()
    assert.match(html1, /Page 1 of 2/)
    assert.match(html1, /Next/)

    let page2 = await router.fetch(
      req(routes.admin.content.index.href({ type: 'article' }) + '?page=2', { cookie }),
    )
    let html2 = await page2.text()
    assert.match(html2, /Page 2 of 2/)
    assert.match(html2, /Previous/)
  })
})

describe('releases', () => {
  async function createDraftEntry(
    router: AppRouter,
    cookie: string,
    title: string,
  ): Promise<string> {
    let created = await router.fetch(
      req(routes.admin.content.create.href({ type: 'article' }), {
        method: 'POST',
        cookie,
        body: form({ title, body: 'x' }),
      }),
    )
    assert.equal(created.status, 303)
    return (created.headers.get('location') ?? '').split('/').pop() ?? ''
  }

  async function addToRelease(
    router: AppRouter,
    cookie: string,
    releaseId: string,
    entryId: string,
    action: 'publish' | 'unpublish',
  ): Promise<void> {
    let added = await router.fetch(
      req(routes.admin.releases.addItem.href(), {
        method: 'POST',
        cookie,
        body: form({ release_id: releaseId, entry_id: entryId, action }),
      }),
    )
    assert.equal(added.status, 303)
  }

  it('publishes staged entries together when a due scheduled release runs', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)

    let entryA = await createDraftEntry(router, cookie, 'Sale hero')
    let entryB = await createDraftEntry(router, cookie, 'Sale banner')

    // Release scheduled in the past = due immediately
    let created = await router.fetch(
      req(routes.admin.releases.create.href(), {
        method: 'POST',
        cookie,
        body: form({ name: 'Summer blowout', scheduled_at: '2020-01-01T00:00' }),
      }),
    )
    assert.equal(created.status, 303)
    let releaseId = (created.headers.get('location') ?? '').split('/').pop() ?? ''
    assert.match(releaseId, /^\d+$/)

    await addToRelease(router, cookie, releaseId, entryA, 'publish')
    await addToRelease(router, cookie, releaseId, entryB, 'publish')

    // Nothing published yet from the staging itself... but the next public API
    // read runs due releases, so both entries go live together.
    let list = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    let body = (await list.json()) as { data: Array<{ attributes: Record<string, unknown> }> }
    assert.equal(body.data.length, 2)
    let titles = body.data.map((item) => item.attributes.title).sort()
    assert.deepEqual(titles, ['Sale banner', 'Sale hero'])

    // The release is now marked published in the admin
    let show = await router.fetch(
      req(routes.admin.releases.show.href({ releaseId }), { cookie }),
    )
    let html = await show.text()
    assert.match(html, /Published/)
  })

  it('publish now fires publish and unpublish actions as one unit', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)

    // One live entry (to be taken down) and one draft (to go live)
    let liveEntry = await createDraftEntry(router, cookie, 'Old promo')
    await router.fetch(
      req(routes.admin.content.publish.href({ type: 'article', entryId: liveEntry }), {
        method: 'POST',
        cookie,
      }),
    )
    let draftEntry = await createDraftEntry(router, cookie, 'New promo')

    // Unscheduled (manual) release
    let created = await router.fetch(
      req(routes.admin.releases.create.href(), {
        method: 'POST',
        cookie,
        body: form({ name: 'Promo swap', scheduled_at: '' }),
      }),
    )
    let releaseId = (created.headers.get('location') ?? '').split('/').pop() ?? ''

    await addToRelease(router, cookie, releaseId, draftEntry, 'publish')
    await addToRelease(router, cookie, releaseId, liveEntry, 'unpublish')

    // Before: only the old promo is live
    let before = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    let beforeBody = (await before.json()) as { data: Array<{ attributes: Record<string, unknown> }> }
    assert.deepEqual(beforeBody.data.map((item) => item.attributes.title), ['Old promo'])

    // Publish now
    let published = await router.fetch(
      req(routes.admin.releases.publish.href({ releaseId }), { method: 'POST', cookie }),
    )
    assert.equal(published.status, 303)

    // After: swapped atomically
    let after = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    let afterBody = (await after.json()) as { data: Array<{ attributes: Record<string, unknown> }> }
    assert.deepEqual(afterBody.data.map((item) => item.attributes.title), ['New promo'])
  })
})

describe('scheduled publishing', () => {
  async function createDraftEntry(
    router: AppRouter,
    cookie: string,
    title: string,
  ): Promise<string> {
    let created = await router.fetch(
      req(routes.admin.content.create.href({ type: 'article' }), {
        method: 'POST',
        cookie,
        body: form({ title, body: 'x' }),
      }),
    )
    assert.equal(created.status, 303)
    return (created.headers.get('location') ?? '').split('/').pop() ?? ''
  }

  async function saveSchedule(
    router: AppRouter,
    cookie: string,
    entryId: string,
    publishAt: string,
    unpublishAt: string,
  ): Promise<void> {
    let saved = await router.fetch(
      req(routes.admin.content.schedule.href({ type: 'article', entryId }), {
        method: 'POST',
        cookie,
        body: form({ publish_at: publishAt, unpublish_at: unpublishAt }),
      }),
    )
    assert.equal(saved.status, 303)
  }

  it('publishes a draft with a past publish_at on the next public API read', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)
    let entryId = await createDraftEntry(router, cookie, 'Timed launch')

    await saveSchedule(router, cookie, entryId, '2020-01-01T00:00', '')

    let list = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    let body = (await list.json()) as { data: Array<{ attributes: Record<string, unknown> }> }
    assert.equal(body.data.length, 1)
    assert.equal(body.data[0]!.attributes.title, 'Timed launch')

    // The fired timer is cleared, so the edit page no longer shows a schedule
    let edit = await router.fetch(
      req(routes.admin.content.editForm.href({ type: 'article', entryId }), { cookie }),
    )
    assert.doesNotMatch(await edit.text(), /Scheduled:/)
  })

  it('unpublishes a live entry with a past unpublish_at on the next API read', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)
    let entryId = await createDraftEntry(router, cookie, 'Timed takedown')

    let published = await router.fetch(
      req(routes.admin.content.publish.href({ type: 'article', entryId }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(published.status, 303)

    let before = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    let beforeBody = (await before.json()) as { data: unknown[] }
    assert.equal(beforeBody.data.length, 1)

    await saveSchedule(router, cookie, entryId, '', '2020-01-01T00:00')

    let after = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    let afterBody = (await after.json()) as { data: unknown[] }
    assert.deepEqual(afterBody.data, [])
  })

  it('round-trips the schedule form: set, display, then clear', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)
    let entryId = await createDraftEntry(router, cookie, 'Future launch')

    // Set both timers far in the future
    await saveSchedule(router, cookie, entryId, '2030-01-02T03:04', '2031-05-06T07:08')

    let edit = await router.fetch(
      req(routes.admin.content.editForm.href({ type: 'article', entryId }), { cookie }),
    )
    let html = await edit.text()
    assert.match(html, /Schedule saved\./)
    assert.match(html, /value="2030-01-02T03:04"/)
    assert.match(html, /value="2031-05-06T07:08"/)
    assert.match(html, /Scheduled:/)

    // Still a draft: future timers change nothing yet
    let list = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    let listBody = (await list.json()) as { data: unknown[] }
    assert.deepEqual(listBody.data, [])

    // Blank inputs clear both timers
    await saveSchedule(router, cookie, entryId, '', '')
    let cleared = await router.fetch(
      req(routes.admin.content.editForm.href({ type: 'article', entryId }), { cookie }),
    )
    let clearedHtml = await cleared.text()
    assert.doesNotMatch(clearedHtml, /value="2030-01-02T03:04"/)
    assert.doesNotMatch(clearedHtml, /Scheduled:/)
  })
})

describe('api tokens', () => {
  async function publishArticle(router: AppRouter, cookie: string, title: string): Promise<void> {
    let created = await router.fetch(
      req(routes.admin.content.create.href({ type: 'article' }), {
        method: 'POST',
        cookie,
        body: form({ title, body: 'x' }),
      }),
    )
    assert.equal(created.status, 303)
    let entryId = (created.headers.get('location') ?? '').split('/').pop() ?? ''
    let published = await router.fetch(
      req(routes.admin.content.publish.href({ type: 'article', entryId }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(published.status, 303)
  }

  // Create a token through the admin UI and pull the one-time plaintext token
  // off the page shown after the redirect.
  async function createToken(router: AppRouter, cookie: string, name: string): Promise<string> {
    let created = await router.fetch(
      req(routes.admin.tokens.create.href(), { method: 'POST', cookie, body: form({ name }) }),
    )
    assert.equal(created.status, 303)

    let index = await router.fetch(req(routes.admin.tokens.index.href(), { cookie }))
    assert.equal(index.status, 200)
    let html = await index.text()
    let plaintext = /rcms_[0-9a-f]{64}/.exec(html)?.[0]
    assert.ok(plaintext, 'expected the new token to be displayed once')
    return plaintext
  }

  // Toggle the 'require_api_token' setting through the admin UI.
  async function setRequirement(
    router: AppRouter,
    cookie: string,
    value: 'true' | 'false',
  ): Promise<void> {
    let response = await router.fetch(
      req(routes.admin.tokens.setRequire.href(), { method: 'POST', cookie, body: form({ value }) }),
    )
    assert.equal(response.status, 303)
  }

  it('leaves the API fully public while the requirement is off', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)
    await publishArticle(router, cookie, 'Open access')

    // A token existing does not gate the API; only the setting does.
    await createToken(router, cookie, 'Reader')

    let list = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    assert.equal(list.status, 200)
    let body = (await list.json()) as { data: Array<{ attributes: Record<string, unknown> }> }
    assert.equal(body.data[0]!.attributes.title, 'Open access')
  })

  it('requires a valid bearer token once the requirement is turned on', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)
    await publishArticle(router, cookie, 'Gated')

    let plaintext = await createToken(router, cookie, 'CI reader')
    // Gating now follows the setting, not token count.
    await setRequirement(router, cookie, 'true')

    // The plaintext is shown exactly once: a second index load no longer has it
    let again = await router.fetch(req(routes.admin.tokens.index.href(), { cookie }))
    assert.doesNotMatch(await again.text(), /rcms_[0-9a-f]{64}/)

    // Bare request -> 401 JSON
    let bare = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    assert.equal(bare.status, 401)
    assert.deepEqual(await bare.json(), { error: 'Unauthorized' })

    // Wrong bearer -> 401
    let wrong = await router.fetch(
      req(routes.api.list.href({ type: 'articles' }), {
        headers: { Authorization: 'Bearer rcms_' + '0'.repeat(64) },
      }),
    )
    assert.equal(wrong.status, 401)

    // Correct bearer -> 200, on both endpoints
    let ok = await router.fetch(
      req(routes.api.list.href({ type: 'articles' }), {
        headers: { Authorization: `Bearer ${plaintext}` },
      }),
    )
    assert.equal(ok.status, 200)
    let body = (await ok.json()) as { data: Array<{ id: number }> }
    assert.equal(body.data.length, 1)

    let single = await router.fetch(
      req(routes.api.show.href({ type: 'articles', id: String(body.data[0]!.id) }), {
        headers: { Authorization: `Bearer ${plaintext}` },
      }),
    )
    assert.equal(single.status, 200)

    // Successful auth records last_used_at
    let index = await router.fetch(req(routes.admin.tokens.index.href(), { cookie }))
    assert.doesNotMatch(await index.text(), />Never</)
  })

  it('restores public access when the requirement is turned off again', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)
    await publishArticle(router, cookie, 'Back open')

    await createToken(router, cookie, 'Temporary')
    await setRequirement(router, cookie, 'true')
    let gated = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    assert.equal(gated.status, 401)

    await setRequirement(router, cookie, 'false')
    let open = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    assert.equal(open.status, 200)
  })

  it('warns when the requirement is on but no tokens exist', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await setRequirement(router, cookie, 'true')

    let index = await router.fetch(req(routes.admin.tokens.index.href(), { cookie }))
    assert.equal(index.status, 200)
    assert.match(await index.text(), /the public API is unreachable/)

    // With the gate on and no tokens, every API request is a 401.
    let denied = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    assert.equal(denied.status, 401)
  })
})

describe('user management', () => {
  // The temp password is shown exactly once on the index page after the
  // redirect; pull it out of the <code> element it renders in.
  async function readTempPassword(router: AppRouter, cookie: string): Promise<string> {
    let index = await router.fetch(req(routes.admin.users.index.href(), { cookie }))
    assert.equal(index.status, 200)
    let html = await index.text()
    let password = /<code[^>]*>([A-Za-z0-9]{16})<\/code>/.exec(html)?.[1]
    assert.ok(password, 'expected the temp password to be displayed once')
    return password
  }

  it('invites a user who can then log in with the temp password', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)

    let created = await router.fetch(
      req(routes.admin.users.create.href(), {
        method: 'POST',
        cookie,
        body: form({ name: 'Casey Editor', email: 'casey@example.com' }),
      }),
    )
    assert.equal(created.status, 303)
    let password = await readTempPassword(router, cookie)

    // Shown exactly once: a second index load no longer has it
    let again = await router.fetch(req(routes.admin.users.index.href(), { cookie }))
    assert.doesNotMatch(await again.text(), /<code[^>]*>[A-Za-z0-9]{16}<\/code>/)

    // A duplicate email is rejected with a friendly 400
    let duplicate = await router.fetch(
      req(routes.admin.users.create.href(), {
        method: 'POST',
        cookie,
        body: form({ name: 'Casey Again', email: 'casey@example.com' }),
      }),
    )
    assert.equal(duplicate.status, 400)
    assert.match(await duplicate.text(), /already exists/)

    // The invited user can sign in and reach the admin
    let loggedIn = await router.fetch(
      req(routes.auth.login.href(), {
        method: 'POST',
        body: form({ email: 'casey@example.com', password, returnTo: '' }),
      }),
    )
    assert.equal(loggedIn.status, 303)
    let caseyCookie = sessionCookie(loggedIn)
    let admin = await router.fetch(req(routes.admin.index.href(), { cookie: caseyCookie }))
    assert.equal(admin.status, 200)
  })

  it('resets a password so old credentials stop working and new ones work', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)

    let reset = await router.fetch(
      req(routes.admin.users.resetPassword.href({ userId: '1' }), { method: 'POST', cookie }),
    )
    assert.equal(reset.status, 303)
    let password = await readTempPassword(router, cookie)

    // Old credentials are rejected now
    let oldLogin = await router.fetch(
      req(routes.auth.login.href(), {
        method: 'POST',
        body: form({ email: 'admin@example.com', password: 'password123', returnTo: '' }),
      }),
    )
    assert.equal(oldLogin.status, 401)

    // The new password works
    let newLogin = await router.fetch(
      req(routes.auth.login.href(), {
        method: 'POST',
        body: form({ email: 'admin@example.com', password, returnTo: '' }),
      }),
    )
    assert.equal(newLogin.status, 303)
  })

  it('blocks deleting the last remaining user', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)

    let deleted = await router.fetch(
      req(routes.admin.users.destroy.href({ userId: '1' }), { method: 'POST', cookie }),
    )
    assert.equal(deleted.status, 303)

    let index = await router.fetch(req(routes.admin.users.index.href(), { cookie }))
    let html = await index.text()
    assert.match(html, /The last user cannot be deleted/)
    assert.match(html, /admin@example\.com/)
  })
})

describe('webhooks', () => {
  interface Delivery {
    event: string
    occurredAt: string
    data: Record<string, unknown>
  }

  // A real local HTTP server that records every JSON body it receives, so the
  // tests exercise actual fetch-based delivery end to end.
  async function startReceiver(): Promise<{
    url: string
    received: Delivery[]
    close: () => Promise<void>
  }> {
    let received: Delivery[] = []
    let server = http.createServer((request, response) => {
      let chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => {
        received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        response.writeHead(200).end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    let { port } = server.address() as AddressInfo
    return {
      url: `http://127.0.0.1:${port}/hook`,
      received,
      close: () => new Promise((resolve) => server.close(() => resolve())),
    }
  }

  async function registerWebhook(
    router: AppRouter,
    cookie: string,
    url: string,
    events: string[],
  ): Promise<void> {
    let created = await router.fetch(
      req(routes.admin.webhooks.create.href(), {
        method: 'POST',
        cookie,
        body: form({ name: 'Test hook', url, events }),
      }),
    )
    assert.equal(created.status, 303)
  }

  it('delivers entry.created and entry.published with the payload shape', async () => {
    let receiver = await startReceiver()
    try {
      let { router } = await buildApp()
      let cookie = await login(router)
      await createArticleType(router, cookie)
      await registerWebhook(router, cookie, receiver.url, ['entry.created', 'entry.published'])

      let created = await router.fetch(
        req(routes.admin.content.create.href({ type: 'article' }), {
          method: 'POST',
          cookie,
          body: form({ title: 'Hooked', body: 'x' }),
        }),
      )
      assert.equal(created.status, 303)
      let entryId = (created.headers.get('location') ?? '').split('/').pop() ?? ''

      let published = await router.fetch(
        req(routes.admin.content.publish.href({ type: 'article', entryId }), {
          method: 'POST',
          cookie,
        }),
      )
      assert.equal(published.status, 303)

      await flushWebhookDeliveries()
      assert.equal(receiver.received.length, 2)
      assert.deepEqual(
        receiver.received.map((delivery) => delivery.event).sort(),
        ['entry.created', 'entry.published'],
      )

      let createdEvent = receiver.received.find((d) => d.event === 'entry.created')!
      assert.ok(createdEvent.occurredAt)
      assert.equal(createdEvent.data.id, Number(entryId))
      assert.equal(createdEvent.data.contentType, 'article')
      assert.equal(createdEvent.data.locale, 'en')
      assert.equal(createdEvent.data.status, 'draft')
      assert.equal(createdEvent.data.publishedAt, null)
      assert.deepEqual(createdEvent.data.data, { title: 'Hooked', body: 'x' })

      let publishedEvent = receiver.received.find((d) => d.event === 'entry.published')!
      assert.equal(publishedEvent.data.status, 'published')
      assert.equal(typeof publishedEvent.data.publishedAt, 'number')
    } finally {
      await receiver.close()
    }
  })

  it('fires entry.published for entries that go live through a release', async () => {
    let receiver = await startReceiver()
    try {
      let { router } = await buildApp()
      let cookie = await login(router)
      await createArticleType(router, cookie)
      await registerWebhook(router, cookie, receiver.url, ['entry.published'])

      let created = await router.fetch(
        req(routes.admin.content.create.href({ type: 'article' }), {
          method: 'POST',
          cookie,
          body: form({ title: 'Via release', body: 'x' }),
        }),
      )
      let entryId = (created.headers.get('location') ?? '').split('/').pop() ?? ''

      let release = await router.fetch(
        req(routes.admin.releases.create.href(), {
          method: 'POST',
          cookie,
          body: form({ name: 'Hook release', scheduled_at: '' }),
        }),
      )
      let releaseId = (release.headers.get('location') ?? '').split('/').pop() ?? ''
      await router.fetch(
        req(routes.admin.releases.addItem.href(), {
          method: 'POST',
          cookie,
          body: form({ release_id: releaseId, entry_id: entryId, action: 'publish' }),
        }),
      )
      let fired = await router.fetch(
        req(routes.admin.releases.publish.href({ releaseId }), { method: 'POST', cookie }),
      )
      assert.equal(fired.status, 303)

      await flushWebhookDeliveries()
      assert.equal(receiver.received.length, 1)
      assert.equal(receiver.received[0]!.event, 'entry.published')
      assert.equal(receiver.received[0]!.data.id, Number(entryId))
      assert.equal(receiver.received[0]!.data.status, 'published')
    } finally {
      await receiver.close()
    }
  })

  it('a disabled webhook receives nothing', async () => {
    let receiver = await startReceiver()
    try {
      let { router } = await buildApp()
      let cookie = await login(router)
      await createArticleType(router, cookie)
      await registerWebhook(router, cookie, receiver.url, ['entry.created'])

      // First webhook in a fresh database has id 1; disable it.
      let toggled = await router.fetch(
        req(routes.admin.webhooks.toggle.href({ webhookId: '1' }), { method: 'POST', cookie }),
      )
      assert.equal(toggled.status, 303)
      let index = await router.fetch(req(routes.admin.webhooks.index.href(), { cookie }))
      assert.match(await index.text(), /Disabled/)

      let created = await router.fetch(
        req(routes.admin.content.create.href({ type: 'article' }), {
          method: 'POST',
          cookie,
          body: form({ title: 'Silent', body: 'x' }),
        }),
      )
      assert.equal(created.status, 303)

      await flushWebhookDeliveries()
      assert.equal(receiver.received.length, 0)
    } finally {
      await receiver.close()
    }
  })
})

describe('components', () => {
  const CARD_COMPONENT = {
    name: 'Card',
    field_name: ['heading', 'body'],
    field_label: ['Heading', 'Body'],
    field_type: ['text', 'text'],
    field_required: ['yes', 'no'],
    field_unique: ['no', 'no'],
    field_options: ['', ''],
  }

  // A "Page" type with a plain title and a repeatable Card component field.
  const PAGE_TYPE = {
    name: 'Page',
    kind: 'collection',
    field_name: ['title', 'cards'],
    field_label: ['Title', 'Cards'],
    field_type: ['text', 'component'],
    field_component: ['', 'card'],
    field_repeatable: ['no', 'yes'],
    field_required: ['yes', 'no'],
    field_unique: ['no', 'no'],
    field_options: ['', ''],
  }

  async function createCardComponent(router: AppRouter, cookie: string): Promise<void> {
    let response = await router.fetch(
      req(routes.admin.components.create.href(), {
        method: 'POST',
        cookie,
        body: form(CARD_COMPONENT),
      }),
    )
    assert.equal(response.status, 303)
  }

  async function createPageType(router: AppRouter, cookie: string): Promise<void> {
    let response = await router.fetch(
      req(routes.admin.types.create.href(), { method: 'POST', cookie, body: form(PAGE_TYPE) }),
    )
    assert.equal(response.status, 303)
  }

  it('stores repeatable component items and serves them nested from the API', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createCardComponent(router, cookie)
    await createPageType(router, cookie)

    // Two filled items plus one blank group (all sub-fields empty) that must
    // be skipped, exactly like the two blank groups the form renders.
    let created = await router.fetch(
      req(routes.admin.content.create.href({ type: 'page' }), {
        method: 'POST',
        cookie,
        body: form({
          title: 'Home',
          'cards.0.heading': 'First card',
          'cards.0.body': 'Alpha',
          'cards.1.heading': 'Second card',
          'cards.1.body': 'Beta',
          'cards.2.heading': '',
          'cards.2.body': '',
        }),
      }),
    )
    assert.equal(created.status, 303)
    let entryId = (created.headers.get('location') ?? '').split('/').pop() ?? ''

    let published = await router.fetch(
      req(routes.admin.content.publish.href({ type: 'page', entryId }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(published.status, 303)

    let list = await router.fetch(req(routes.api.list.href({ type: 'pages' })))
    assert.equal(list.status, 200)
    let body = (await list.json()) as { data: Array<{ attributes: Record<string, unknown> }> }
    assert.equal(body.data.length, 1)
    assert.equal(body.data[0]!.attributes.title, 'Home')
    assert.deepEqual(body.data[0]!.attributes.cards, [
      { heading: 'First card', body: 'Alpha' },
      { heading: 'Second card', body: 'Beta' },
    ])
  })

  it('rejects an item missing a required sub-field with a 400 re-render', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createCardComponent(router, cookie)
    await createPageType(router, cookie)

    // The item is present (body is filled) but its required heading is blank.
    let invalid = await router.fetch(
      req(routes.admin.content.create.href({ type: 'page' }), {
        method: 'POST',
        cookie,
        body: form({
          title: 'Home',
          'cards.0.heading': '',
          'cards.0.body': 'Body without a heading',
        }),
      }),
    )
    assert.equal(invalid.status, 400)
    let html = await invalid.text()
    assert.match(html, /Heading is required\./)
    // The submitted sub-field input survives the re-render
    assert.match(html, /Body without a heading/)
  })

  it('blocks deleting a component while content types still reference it', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createCardComponent(router, cookie)
    await createPageType(router, cookie)

    // First component in a fresh database has id 1
    let blocked = await router.fetch(
      req(routes.admin.components.destroy.href({ componentId: '1' }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(blocked.status, 303)

    let index = await router.fetch(req(routes.admin.components.index.href(), { cookie }))
    let html = await index.text()
    assert.match(html, /content types still use it/)
    assert.match(html, /Card/)

    // Remove the referencing type (id 1 in a fresh database), then delete works
    let typeDeleted = await router.fetch(
      req(routes.admin.types.destroy.href({ typeId: '1' }), { method: 'POST', cookie }),
    )
    assert.equal(typeDeleted.status, 303)

    let deleted = await router.fetch(
      req(routes.admin.components.destroy.href({ componentId: '1' }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(deleted.status, 303)
    let after = await router.fetch(req(routes.admin.components.index.href(), { cookie }))
    assert.match(await after.text(), /Component "Card" deleted\./)
  })
})

describe('audit log', () => {
  it('records admin mutations with the acting user as the actor', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)

    // Create then publish an entry
    let created = await router.fetch(
      req(routes.admin.content.create.href({ type: 'article' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Sale hero', body: 'x' }),
      }),
    )
    assert.equal(created.status, 303)
    let entryId = (created.headers.get('location') ?? '').split('/').pop() ?? ''
    let published = await router.fetch(
      req(routes.admin.content.publish.href({ type: 'article', entryId }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(published.status, 303)

    let page = await router.fetch(req(routes.admin.audit.index.href(), { cookie }))
    assert.equal(page.status, 200)
    let html = await page.text()

    // Every row above was performed by the seeded admin
    assert.match(html, /admin@example\.com/)
    // The mutations are listed with their actions and summaries
    assert.match(html, /content_type\.created/)
    assert.match(html, /entry\.created/)
    assert.match(html, /entry\.published/)
    assert.match(html, /Published "Sale hero" \(Article\)/)
    // A system actor has not acted yet
    assert.doesNotMatch(html, />system</)
  })

  it('records scheduled release publishing with the actor "system"', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)

    let created = await router.fetch(
      req(routes.admin.content.create.href({ type: 'article' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Timed hero', body: 'x' }),
      }),
    )
    let entryId = (created.headers.get('location') ?? '').split('/').pop() ?? ''

    // Release scheduled in the past = due immediately
    let release = await router.fetch(
      req(routes.admin.releases.create.href(), {
        method: 'POST',
        cookie,
        body: form({ name: 'Auto release', scheduled_at: '2020-01-01T00:00' }),
      }),
    )
    let releaseId = (release.headers.get('location') ?? '').split('/').pop() ?? ''
    await router.fetch(
      req(routes.admin.releases.addItem.href(), {
        method: 'POST',
        cookie,
        body: form({ release_id: releaseId, entry_id: entryId, action: 'publish' }),
      }),
    )

    // A public API read fires the due release, which publishes the entry as 'system'
    let list = await router.fetch(req(routes.api.list.href({ type: 'articles' })))
    let body = (await list.json()) as { data: unknown[] }
    assert.equal(body.data.length, 1)

    let page = await router.fetch(req(routes.admin.audit.index.href(), { cookie }))
    let html = await page.text()
    assert.match(html, />system</)
    assert.match(html, /Published "Timed hero" \(Article\) via release/)
  })
})

describe('localization', () => {
  it('serves locale-filtered published content for localized types', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)

    // Add a French locale
    let addedLocale = await router.fetch(
      req(routes.admin.locales.create.href(), {
        method: 'POST',
        cookie,
        body: form({ code: 'fr', name: 'French' }),
      }),
    )
    assert.equal(addedLocale.status, 303)

    // Create a localized content type
    let createdType = await router.fetch(
      req(routes.admin.types.create.href(), {
        method: 'POST',
        cookie,
        body: form({ ...ARTICLE_FIELDS, name: 'Post', localized: 'yes' }),
      }),
    )
    assert.equal(createdType.status, 303)

    // One entry in the default locale, one in French
    async function createAndPublish(fields: Record<string, string>): Promise<void> {
      let created = await router.fetch(
        req(routes.admin.content.create.href({ type: 'post' }), {
          method: 'POST',
          cookie,
          body: form(fields),
        }),
      )
      assert.equal(created.status, 303)
      let entryId = (created.headers.get('location') ?? '').split('/').pop() ?? ''
      let published = await router.fetch(
        req(routes.admin.content.publish.href({ type: 'post', entryId }), {
          method: 'POST',
          cookie,
        }),
      )
      assert.equal(published.status, 303)
    }

    await createAndPublish({ title: 'Hello', body: 'x' })
    await createAndPublish({ title: 'Bonjour', body: 'x', _locale: 'fr' })

    type ApiList = { data: Array<{ attributes: Record<string, unknown>; locale: string }> }

    // No locale param -> default locale only
    let defaultList = await router.fetch(req(routes.api.list.href({ type: 'posts' })))
    let defaultBody = (await defaultList.json()) as ApiList
    assert.equal(defaultBody.data.length, 1)
    assert.equal(defaultBody.data[0]!.attributes.title, 'Hello')
    assert.equal(defaultBody.data[0]!.locale, 'en')

    // ?locale=fr -> the French entry only
    let frenchList = await router.fetch(
      req(routes.api.list.href({ type: 'posts' }) + '?locale=fr'),
    )
    let frenchBody = (await frenchList.json()) as ApiList
    assert.equal(frenchBody.data.length, 1)
    assert.equal(frenchBody.data[0]!.attributes.title, 'Bonjour')

    // Unknown locale -> 400
    let unknown = await router.fetch(req(routes.api.list.href({ type: 'posts' }) + '?locale=de'))
    assert.equal(unknown.status, 400)
  })

  it('protects the default locale and locales that entries still use', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)

    // The seeded default locale (id 1) cannot be deleted
    let deletedDefault = await router.fetch(
      req(routes.admin.locales.destroy.href({ localeId: '1' }), { method: 'POST', cookie }),
    )
    assert.equal(deletedDefault.status, 303)

    let index = await router.fetch(req(routes.admin.locales.index.href(), { cookie }))
    let html = await index.text()
    assert.match(html, /English/)
    assert.match(html, /cannot be deleted/)

    // A locale with entries in it cannot be deleted either
    await router.fetch(
      req(routes.admin.locales.create.href(), {
        method: 'POST',
        cookie,
        body: form({ code: 'fr', name: 'French' }),
      }),
    )
    await router.fetch(
      req(routes.admin.types.create.href(), {
        method: 'POST',
        cookie,
        body: form({ ...ARTICLE_FIELDS, localized: 'yes' }),
      }),
    )
    await router.fetch(
      req(routes.admin.content.create.href({ type: 'article' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Bonjour', body: 'x', _locale: 'fr' }),
      }),
    )

    let deletedInUse = await router.fetch(
      req(routes.admin.locales.destroy.href({ localeId: '2' }), { method: 'POST', cookie }),
    )
    assert.equal(deletedInUse.status, 303)

    let afterDelete = await router.fetch(req(routes.admin.locales.index.href(), { cookie }))
    let afterHtml = await afterDelete.text()
    assert.match(afterHtml, /French/)
    assert.match(afterHtml, /entries still use it/)
  })
})

describe('entry delete form', () => {
  it('deletes an entry on POST and renders no nested form on the edit page', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)

    let created = await router.fetch(
      req(routes.admin.content.create.href({ type: 'article' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Doomed', body: 'x' }),
      }),
    )
    assert.equal(created.status, 303)
    let entryId = (created.headers.get('location') ?? '').split('/').pop() ?? ''

    // The main entry form must contain no nested <form> (invalid HTML that
    // browsers drop, which used to make Delete submit a Save).
    let edit = await router.fetch(
      req(routes.admin.content.editForm.href({ type: 'article', entryId }), { cookie }),
    )
    let html = await edit.text()
    let updatePath = routes.admin.content.update.href({ type: 'article', entryId })
    let actionIdx = html.indexOf(`action="${updatePath}"`)
    assert.ok(actionIdx !== -1, 'expected the update form on the edit page')
    let formStart = html.lastIndexOf('<form', actionIdx)
    let formEnd = html.indexOf('</form>', actionIdx)
    let mainForm = html.slice(formStart, formEnd)
    assert.equal(mainForm.split('<form').length - 1, 1, 'main form must not contain a nested form')

    // POST destroy actually deletes: the entry 404s afterwards.
    let deleted = await router.fetch(
      req(routes.admin.content.destroy.href({ type: 'article', entryId }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(deleted.status, 303)

    let gone = await router.fetch(
      req(routes.admin.content.editForm.href({ type: 'article', entryId }), { cookie }),
    )
    assert.equal(gone.status, 404)
  })
})

describe('content-type deletion confirmation', () => {
  it('shows a confirm page with the entry count and deletes only on POST', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createArticleType(router, cookie)

    let created = await router.fetch(
      req(routes.admin.content.create.href({ type: 'article' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Doomed', body: 'x' }),
      }),
    )
    assert.equal(created.status, 303)

    // Article type has id 1 in a fresh database.
    let confirm = await router.fetch(
      req(routes.admin.types.confirmDestroy.href({ typeId: '1' }), { cookie }),
    )
    assert.equal(confirm.status, 200)
    assert.match(await confirm.text(), /1 entry will be permanently deleted/)

    // A GET does not delete: the type is still listed.
    let stillThere = await router.fetch(req(routes.admin.types.index.href(), { cookie }))
    assert.match(await stillThere.text(), /article/)

    // The POST destroys it, cascading its entries.
    let destroyed = await router.fetch(
      req(routes.admin.types.destroy.href({ typeId: '1' }), { method: 'POST', cookie }),
    )
    assert.equal(destroyed.status, 303)
    let gone = await router.fetch(req(routes.admin.content.index.href({ type: 'article' }), { cookie }))
    assert.equal(gone.status, 404)
  })
})

describe('unique fields', () => {
  const DOC_TYPE = {
    name: 'Doc',
    kind: 'collection',
    field_name: ['slug', 'body'],
    field_label: ['Slug', 'Body'],
    field_type: ['text', 'text'],
    field_required: ['yes', 'no'],
    field_unique: ['yes', 'no'],
    field_options: ['', ''],
  }

  async function createDocType(
    router: AppRouter,
    cookie: string,
    extra: Record<string, string> = {},
  ): Promise<void> {
    let response = await router.fetch(
      req(routes.admin.types.create.href(), {
        method: 'POST',
        cookie,
        body: form({ ...DOC_TYPE, ...extra }),
      }),
    )
    assert.equal(response.status, 303)
  }

  function createDoc(
    router: AppRouter,
    cookie: string,
    fields: Record<string, string>,
  ): Promise<Response> {
    return router.fetch(
      req(routes.admin.content.create.href({ type: 'doc' }), {
        method: 'POST',
        cookie,
        body: form(fields),
      }),
    )
  }

  it('rejects a duplicate unique value on create', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createDocType(router, cookie)

    let first = await createDoc(router, cookie, { slug: 'intro', body: 'x' })
    assert.equal(first.status, 303)

    let dup = await createDoc(router, cookie, { slug: 'intro', body: 'y' })
    assert.equal(dup.status, 400)
    assert.match(await dup.text(), /Must be unique/)
  })

  it('rejects a duplicate on update but lets an entry keep its own value', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createDocType(router, cookie)

    let a = await createDoc(router, cookie, { slug: 'a', body: 'x' })
    assert.equal(a.status, 303)
    let b = await createDoc(router, cookie, { slug: 'b', body: 'x' })
    assert.equal(b.status, 303)
    let bId = (b.headers.get('location') ?? '').split('/').pop() ?? ''

    // Changing B to A's slug clashes.
    let clash = await router.fetch(
      req(routes.admin.content.update.href({ type: 'doc', entryId: bId }), {
        method: 'POST',
        cookie,
        body: form({ slug: 'a', body: 'x' }),
      }),
    )
    assert.equal(clash.status, 400)
    assert.match(await clash.text(), /Must be unique/)

    // Saving B with its own slug is allowed (self is excluded).
    let ok = await router.fetch(
      req(routes.admin.content.update.href({ type: 'doc', entryId: bId }), {
        method: 'POST',
        cookie,
        body: form({ slug: 'b', body: 'updated' }),
      }),
    )
    assert.equal(ok.status, 303)
  })

  it('allows the same unique value in a different locale', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)

    await router.fetch(
      req(routes.admin.locales.create.href(), {
        method: 'POST',
        cookie,
        body: form({ code: 'fr', name: 'French' }),
      }),
    )
    await createDocType(router, cookie, { localized: 'yes' })

    let en = await createDoc(router, cookie, { slug: 'shared', body: 'x' })
    assert.equal(en.status, 303)

    // Same value, different locale: allowed.
    let fr = await createDoc(router, cookie, { slug: 'shared', body: 'x', _locale: 'fr' })
    assert.equal(fr.status, 303)

    // Same value, same locale: still rejected.
    let dupEn = await createDoc(router, cookie, { slug: 'shared', body: 'y' })
    assert.equal(dupEn.status, 400)
  })
})

describe('feature flags', () => {
  async function createFlag(
    router: AppRouter,
    cookie: string,
    fields: { name: string; key?: string; kind: string },
  ): Promise<Response> {
    return router.fetch(
      req(routes.admin.flags.create.href(), {
        method: 'POST',
        cookie,
        body: form({ key: '', ...fields }),
      }),
    )
  }

  function flagIdFrom(response: Response): string {
    return (response.headers.get('location') ?? '').split('/').pop() ?? ''
  }

  // Variant ids in the flag detail page, in listed (position) order.
  async function variantIds(router: AppRouter, cookie: string, flagId: string): Promise<string[]> {
    let html = await (
      await router.fetch(req(routes.admin.flags.show.href({ flagId }), { cookie }))
    ).text()
    let seen: string[] = []
    for (let match of html.matchAll(/\/flags\/\d+\/variants\/(\d+)(?:\/delete)?"/g)) {
      if (!seen.includes(match[1]!)) seen.push(match[1]!)
    }
    return seen
  }

  it('creates a boolean flag and lists it', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)

    let created = await createFlag(router, cookie, { name: 'Beta banner', kind: 'boolean' })
    assert.equal(created.status, 303)

    let index = await router.fetch(req(routes.admin.flags.index.href(), { cookie }))
    let html = await index.text()
    assert.match(html, /Beta banner/)
    assert.match(html, /beta-banner/)
  })

  it('rejects an experiment split that does not sum to 100, accepts 100', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    let flagId = flagIdFrom(await createFlag(router, cookie, { name: 'Checkout', kind: 'experiment' }))
    let [control, treatment] = await variantIds(router, cookie, flagId)

    let bad = await router.fetch(
      req(routes.admin.flags.setWeights.href({ flagId }), {
        method: 'POST',
        cookie,
        body: form({ variant_id: [control!, treatment!], weight: ['60', '30'] }),
      }),
    )
    assert.equal(bad.status, 400)

    let good = await router.fetch(
      req(routes.admin.flags.setWeights.href({ flagId }), {
        method: 'POST',
        cookie,
        body: form({ variant_id: [control!, treatment!], weight: ['70', '30'] }),
      }),
    )
    assert.equal(good.status, 303)
  })

  it('rejects a variant whose config is not valid JSON', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    let flagId = flagIdFrom(await createFlag(router, cookie, { name: 'Checkout', kind: 'experiment' }))

    let bad = await router.fetch(
      req(routes.admin.flags.addVariant.href({ flagId }), {
        method: 'POST',
        cookie,
        body: form({ key: 'variant-c', name: 'Variant C', weight: '0', config: '{not json}' }),
      }),
    )
    assert.equal(bad.status, 400)
    assert.match(await bad.text(), /valid JSON/)
  })

  it('serves the off variant with reason "disabled" while off, and buckets once enabled', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    let flagId = flagIdFrom(await createFlag(router, cookie, { name: 'Checkout', kind: 'experiment' }))

    // Disabled by default -> off variant (control), reason disabled.
    let off = await router.fetch(req(routes.api.flags.evaluateOne.href({ key: 'checkout' }) + '?user=u1'))
    let offBody = (await off.json()) as { data: { variant: string; reason: string; enabled: boolean } }
    assert.equal(offBody.data.enabled, false)
    assert.equal(offBody.data.reason, 'disabled')
    assert.equal(offBody.data.variant, 'control')

    // Enable (starter split is 50/50 = 100).
    let toggle = await router.fetch(
      req(routes.admin.flags.toggle.href({ flagId }), { method: 'POST', cookie }),
    )
    assert.equal(toggle.status, 303)

    let on = await router.fetch(req(routes.api.flags.evaluateOne.href({ key: 'checkout' }) + '?user=u1'))
    let onBody = (await on.json()) as { data: { variant: string; reason: string; enabled: boolean } }
    assert.equal(onBody.data.enabled, true)
    assert.equal(onBody.data.reason, 'bucket')
    assert.ok(['control', 'treatment'].includes(onBody.data.variant))
  })

  it('applies a matching targeting rule before bucketing', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    let flagId = flagIdFrom(await createFlag(router, cookie, { name: 'Checkout', kind: 'experiment' }))
    let [, treatment] = await variantIds(router, cookie, flagId)

    await router.fetch(
      req(routes.admin.flags.addRule.href({ flagId }), {
        method: 'POST',
        cookie,
        body: form({ attribute: 'country', operator: 'equals', value: 'US', variant_id: treatment! }),
      }),
    )
    await router.fetch(req(routes.admin.flags.toggle.href({ flagId }), { method: 'POST', cookie }))

    let matched = await router.fetch(
      req(routes.api.flags.evaluateOne.href({ key: 'checkout' }) + '?user=u1&country=US'),
    )
    let matchedBody = (await matched.json()) as { data: { variant: string; reason: string } }
    assert.equal(matchedBody.data.reason, 'rule_match')
    assert.equal(matchedBody.data.variant, 'treatment')

    // No matching attribute -> falls through to bucketing.
    let missed = await router.fetch(
      req(routes.api.flags.evaluateOne.href({ key: 'checkout' }) + '?user=u1&country=CA'),
    )
    assert.equal(((await missed.json()) as { data: { reason: string } }).data.reason, 'bucket')
  })

  it('requires a user key and 404s an unknown flag', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createFlag(router, cookie, { name: 'Checkout', kind: 'experiment' })

    let noUser = await router.fetch(req(routes.api.flags.evaluateOne.href({ key: 'checkout' })))
    assert.equal(noUser.status, 400)

    let unknown = await router.fetch(
      req(routes.api.flags.evaluateOne.href({ key: 'nope' }) + '?user=u1'),
    )
    assert.equal(unknown.status, 404)
  })

  it('evaluates every flag for a user via /api/flags', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createFlag(router, cookie, { name: 'Alpha', kind: 'boolean' })
    await createFlag(router, cookie, { name: 'Bravo', kind: 'experiment' })

    let all = await router.fetch(req(routes.api.flags.evaluateAll.href() + '?user=u1'))
    assert.equal(all.status, 200)
    let body = (await all.json()) as { data: Array<{ key: string }>; meta: { user: string } }
    assert.equal(body.meta.user, 'u1')
    assert.deepEqual(body.data.map((f) => f.key).sort(), ['alpha', 'bravo'])
  })

  it('is deterministic: the same user always gets the same variant', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    let flagId = flagIdFrom(await createFlag(router, cookie, { name: 'Checkout', kind: 'experiment' }))
    await router.fetch(req(routes.admin.flags.toggle.href({ flagId }), { method: 'POST', cookie }))

    let first: string | null = null
    for (let i = 0; i < 5; i++) {
      let res = await router.fetch(
        req(routes.api.flags.evaluateOne.href({ key: 'checkout' }) + '?user=sticky-user'),
      )
      let variant = ((await res.json()) as { data: { variant: string } }).data.variant
      if (first === null) first = variant
      assert.equal(variant, first)
    }
  })

  it('fires a scheduled end on the next API read (out_of_window + audit)', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    let flagId = flagIdFrom(await createFlag(router, cookie, { name: 'Checkout', kind: 'experiment' }))
    await router.fetch(req(routes.admin.flags.toggle.href({ flagId }), { method: 'POST', cookie }))

    // End the flag in the past.
    let update = await router.fetch(
      req(routes.admin.flags.update.href({ flagId }), {
        method: 'POST',
        cookie,
        body: form({ name: 'Checkout', description: '', start_at: '', end_at: '2020-01-01T00:00' }),
      }),
    )
    assert.equal(update.status, 303)

    // A public read fires runScheduledWork -> lifecycle ends.
    let ev = await router.fetch(req(routes.api.flags.evaluateOne.href({ key: 'checkout' }) + '?user=u1'))
    let body = (await ev.json()) as { data: { reason: string } }
    assert.equal(body.data.reason, 'out_of_window')

    let audit = await router.fetch(req(routes.admin.audit.index.href(), { cookie }))
    assert.match(await audit.text(), /ended on schedule/)
  })

  it('guards removing a variant below two and clears default pointers otherwise', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    let flagId = flagIdFrom(await createFlag(router, cookie, { name: 'Checkout', kind: 'experiment' }))
    let [control] = await variantIds(router, cookie, flagId)

    // Only two variants -> removing is refused.
    let refused = await router.fetch(
      req(routes.admin.flags.removeVariant.href({ flagId, variantId: control! }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(refused.status, 400)

    // Add a third, then removing the off/control pointer succeeds.
    await router.fetch(
      req(routes.admin.flags.addVariant.href({ flagId }), {
        method: 'POST',
        cookie,
        body: form({ key: 'variant-c', name: 'Variant C', weight: '0', config: '{}' }),
      }),
    )
    let removed = await router.fetch(
      req(routes.admin.flags.removeVariant.href({ flagId, variantId: control! }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(removed.status, 303)

    // The flag still renders (off pointer was NULL-cleared, not dangling).
    let show = await router.fetch(req(routes.admin.flags.show.href({ flagId }), { cookie }))
    assert.equal(show.status, 200)
  })
})

describe('relations', () => {
  const AUTHOR_TYPE = {
    name: 'Author',
    kind: 'collection',
    field_name: ['name'],
    field_label: ['Name'],
    field_type: ['text'],
    field_target: [''],
    field_repeatable: ['no'],
    field_required: ['yes'],
    field_unique: ['no'],
    field_options: [''],
  }

  // A Post with a single Author relation (target api id 'author').
  const POST_TYPE = {
    name: 'Post',
    kind: 'collection',
    field_name: ['title', 'author'],
    field_label: ['Title', 'Author'],
    field_type: ['text', 'relation'],
    field_target: ['', 'author'],
    field_repeatable: ['no', 'no'],
    field_required: ['yes', 'no'],
    field_unique: ['no', 'no'],
    field_options: ['', ''],
  }

  // A Post variant with a many-Author relation.
  const POST_MANY_TYPE = {
    ...POST_TYPE,
    field_name: ['title', 'authors'],
    field_label: ['Title', 'Authors'],
    field_repeatable: ['no', 'yes'],
  }

  async function createType(
    router: AppRouter,
    cookie: string,
    def: Record<string, string | string[]>,
  ): Promise<void> {
    let response = await router.fetch(
      req(routes.admin.types.create.href(), { method: 'POST', cookie, body: form(def) }),
    )
    assert.equal(response.status, 303)
  }

  async function createAndPublish(
    router: AppRouter,
    cookie: string,
    type: string,
    body: Record<string, string | string[]>,
  ): Promise<number> {
    let created = await router.fetch(
      req(routes.admin.content.create.href({ type }), { method: 'POST', cookie, body: form(body) }),
    )
    assert.equal(created.status, 303)
    let entryId = (created.headers.get('location') ?? '').split('/').pop() ?? ''
    await router.fetch(
      req(routes.admin.content.publish.href({ type, entryId }), { method: 'POST', cookie }),
    )
    return Number(entryId)
  }

  it('links an entry and expands it with ?populate=1', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createType(router, cookie, AUTHOR_TYPE)
    await createType(router, cookie, POST_TYPE)

    let authorId = await createAndPublish(router, cookie, 'author', { name: 'Ada' })
    await createAndPublish(router, cookie, 'post', { title: 'Hello', author: String(authorId) })

    // Raw: the relation serializes as the target id.
    let raw = await router.fetch(req(routes.api.list.href({ type: 'posts' })))
    let rawBody = (await raw.json()) as { data: Array<{ attributes: { author: unknown } }> }
    assert.equal(rawBody.data[0]!.attributes.author, authorId)

    // Populated: the relation expands one level to the target entry.
    let populated = await router.fetch(req(routes.api.list.href({ type: 'posts' }) + '?populate=1'))
    let popBody = (await populated.json()) as {
      data: Array<{ attributes: { author: { id: number; attributes: { name: string } } } }>
    }
    assert.equal(popBody.data[0]!.attributes.author.id, authorId)
    assert.equal(popBody.data[0]!.attributes.author.attributes.name, 'Ada')
  })

  it('renders a relation picker of target entries on the entry form', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createType(router, cookie, AUTHOR_TYPE)
    await createType(router, cookie, POST_TYPE)
    await createAndPublish(router, cookie, 'author', { name: 'Ada' })

    // The builder exposes the relation-target column.
    let builder = await router.fetch(req(routes.admin.types.newForm.href(), { cookie }))
    assert.match(await builder.text(), /Relation target/)

    // The new-post form renders a <select name="author"> listing the author.
    let entryForm = await router.fetch(
      req(routes.admin.content.newForm.href({ type: 'post' }), { cookie }),
    )
    let html = await entryForm.text()
    assert.match(html, /name="author"/)
    assert.match(html, /Ada/)
  })

  it('rejects a reference to a non-existent target entry', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createType(router, cookie, AUTHOR_TYPE)
    await createType(router, cookie, POST_TYPE)

    let bad = await router.fetch(
      req(routes.admin.content.create.href({ type: 'post' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Orphan', author: '99999' }),
      }),
    )
    assert.equal(bad.status, 400)
    assert.match(await bad.text(), /not in the target type/)
  })

  it('nulls the reference when the target entry is deleted', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createType(router, cookie, AUTHOR_TYPE)
    await createType(router, cookie, POST_TYPE)

    let authorId = await createAndPublish(router, cookie, 'author', { name: 'Ada' })
    await createAndPublish(router, cookie, 'post', { title: 'Hello', author: String(authorId) })

    await router.fetch(
      req(routes.admin.content.destroy.href({ type: 'author', entryId: String(authorId) }), {
        method: 'POST',
        cookie,
      }),
    )

    let raw = await router.fetch(req(routes.api.list.href({ type: 'posts' })))
    let rawBody = (await raw.json()) as { data: Array<{ attributes: { author: unknown } }> }
    assert.equal(rawBody.data[0]!.attributes.author, null)
  })

  it('stores and expands a many-relation', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await createType(router, cookie, AUTHOR_TYPE)
    await createType(router, cookie, POST_MANY_TYPE)

    let ada = await createAndPublish(router, cookie, 'author', { name: 'Ada' })
    let alan = await createAndPublish(router, cookie, 'author', { name: 'Alan' })
    await createAndPublish(router, cookie, 'post', {
      title: 'Both',
      authors: [String(ada), String(alan)],
    })

    let raw = await router.fetch(req(routes.api.list.href({ type: 'posts' })))
    let rawBody = (await raw.json()) as { data: Array<{ attributes: { authors: number[] } }> }
    assert.deepEqual([...rawBody.data[0]!.attributes.authors].sort(), [ada, alan].sort())

    let populated = await router.fetch(req(routes.api.list.href({ type: 'posts' }) + '?populate=1'))
    let popBody = (await populated.json()) as {
      data: Array<{ attributes: { authors: Array<{ id: number }> } }>
    }
    assert.equal(popBody.data[0]!.attributes.authors.length, 2)
  })
})

describe('media library', () => {
  // Uploads land in a per-run temp directory so tests never touch the real
  // uploads/ folder. assets.server.ts reads UPLOADS_DIR lazily per call.
  const TEST_UPLOADS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-cms-uploads-'))
  process.env.UPLOADS_DIR = TEST_UPLOADS_DIR

  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

  // Multipart POST to the media upload action. Passing a FormData body lets
  // fetch set the multipart boundary header itself.
  async function uploadFile(
    router: AppRouter,
    cookie: string,
    filename = 'photo.png',
    mimeType = 'image/png',
  ): Promise<number> {
    let body = new FormData()
    body.append('file', new File([PNG_BYTES], filename, { type: mimeType }))
    let headers = new Headers({ Cookie: cookie })
    let response = await router.fetch(
      new Request(ORIGIN + routes.admin.media.create.href(), { method: 'POST', body, headers }),
    )
    assert.equal(response.status, 303)

    // Recover the new asset's id from its serving-route URL embedded in the
    // rendered media page (matched by filename, so parallel uploads are safe).
    let page = await router.fetch(req(routes.admin.media.index.href(), { cookie }))
    let html = await page.text()
    let match = html.match(new RegExp(`/uploads/(\\d+)/${filename.replace('.', '\\.')}`))
    assert.ok(match, 'expected an uploaded asset link on the media page')
    return Number(match![1])
  }

  const GALLERY_TYPE = {
    name: 'Gallery',
    kind: 'collection',
    field_name: ['title', 'photo'],
    field_label: ['Title', 'Photo'],
    field_type: ['text', 'media'],
    field_required: ['yes', 'no'],
    field_unique: ['no', 'no'],
    field_options: ['', ''],
    field_component: ['', ''],
    field_target: ['', ''],
    field_repeatable: ['no', 'no'],
  }

  it('uploads a file, stores it on disk, and serves it back with its content type', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)

    let assetId = await uploadFile(router, cookie, 'cat.png')

    // A uniquely-named file exists on disk with the uploaded bytes.
    let stored = fs.readdirSync(TEST_UPLOADS_DIR).filter((name) => name.endsWith('-cat.png'))
    assert.equal(stored.length, 1)
    assert.deepEqual(
      new Uint8Array(fs.readFileSync(path.join(TEST_UPLOADS_DIR, stored[0]!))),
      PNG_BYTES,
    )

    // The public serving route streams the bytes with the recorded mime type.
    let served = await router.fetch(
      req(routes.uploads.href({ id: String(assetId), filename: 'cat.png' })),
    )
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('content-type'), 'image/png')
    assert.deepEqual(new Uint8Array(await served.arrayBuffer()), PNG_BYTES)

    // Unknown asset ids are a 404.
    let missing = await router.fetch(req(routes.uploads.href({ id: '9999', filename: 'x.png' })))
    assert.equal(missing.status, 404)
  })

  it('renders the image preview lightbox for image assets and serves its client entry', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await uploadFile(router, cookie, 'photo.png', 'image/png')
    await uploadFile(router, cookie, 'notes.pdf', 'application/pdf')

    let page = await router.fetch(req(routes.admin.media.index.href(), { cookie }))
    assert.equal(page.status, 200)
    let html = await page.text()

    // The lightbox client entry is wired (its module URL is emitted for the
    // client runtime), with a <dialog> per image tile. Non-image assets keep
    // the plain mime-type tile, so exactly one dialog renders here.
    assert.match(html, /app\/assets\/media-lightbox\.tsx/)
    assert.equal((html.match(/<dialog/g) ?? []).length, 1)
    assert.match(html, /application\/pdf/)

    // The client entry module itself is reachable.
    let module_ = await router.fetch(
      req(routes.assets.href({ path: 'app/assets/media-lightbox.tsx' })),
    )
    assert.equal(module_.status, 200)
    assert.match(module_.headers.get('content-type') ?? '', /javascript/)
  })

  it('requires an admin session for the media pages and tolerates empty uploads', async () => {
    let { router } = await buildApp()

    let anonymous = await router.fetch(req(routes.admin.media.index.href()))
    assert.equal(anonymous.status, 303)

    let cookie = await login(router)
    let body = new FormData()
    body.append('note', 'no file part')
    let headers = new Headers({ Cookie: cookie })
    let response = await router.fetch(
      new Request(ORIGIN + routes.admin.media.create.href(), { method: 'POST', body, headers }),
    )
    // No file part -> flash + redirect back, no asset created.
    assert.equal(response.status, 303)
    let page = await router.fetch(req(routes.admin.media.index.href(), { cookie }))
    let html = await page.text()
    assert.match(html, /Choose a file to upload/)
    assert.match(html, /No files yet/)
  })

  it('validates media fields: rejects non-integers and unknown asset ids, accepts real ones', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    let created = await router.fetch(
      req(routes.admin.types.create.href(), { method: 'POST', cookie, body: form(GALLERY_TYPE) }),
    )
    assert.equal(created.status, 303)

    // Non-integer -> 400 from shape validation.
    let junk = await router.fetch(
      req(routes.admin.content.create.href({ type: 'gallery' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Bad', photo: 'not-a-number' }),
      }),
    )
    assert.equal(junk.status, 400)

    // Unknown asset id -> 400 from the write-time referential check.
    let unknown = await router.fetch(
      req(routes.admin.content.create.href({ type: 'gallery' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Ghost', photo: '4242' }),
      }),
    )
    assert.equal(unknown.status, 400)
    assert.match(await unknown.text(), /no longer exists/)

    // A real asset id saves fine; blank is fine for an optional field.
    let assetId = await uploadFile(router, cookie)
    let valid = await router.fetch(
      req(routes.admin.content.create.href({ type: 'gallery' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Good', photo: String(assetId) }),
      }),
    )
    assert.equal(valid.status, 303)

    let blank = await router.fetch(
      req(routes.admin.content.create.href({ type: 'gallery' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'No photo', photo: '' }),
      }),
    )
    assert.equal(blank.status, 303)
  })

  it('expands media fields into asset objects on the public API', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await router.fetch(
      req(routes.admin.types.create.href(), { method: 'POST', cookie, body: form(GALLERY_TYPE) }),
    )
    let assetId = await uploadFile(router, cookie, 'hero.png')

    let created = await router.fetch(
      req(routes.admin.content.create.href({ type: 'gallery' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Shot', photo: String(assetId) }),
      }),
    )
    let entryId = (created.headers.get('location') ?? '').split('/').pop() ?? ''
    await router.fetch(
      req(routes.admin.content.publish.href({ type: 'gallery', entryId }), {
        method: 'POST',
        cookie,
      }),
    )

    // List endpoint: the media id expands into { url, filename, mimeType, size }.
    let list = await router.fetch(req(routes.api.list.href({ type: 'galleries' })))
    let listBody = (await list.json()) as {
      data: Array<{
        attributes: { photo: { url: string; filename: string; mimeType: string; size: number } }
      }>
    }
    let photo = listBody.data[0]!.attributes.photo
    assert.equal(photo.filename, 'hero.png')
    assert.equal(photo.mimeType, 'image/png')
    assert.equal(photo.size, PNG_BYTES.byteLength)
    assert.equal(
      photo.url,
      ORIGIN + routes.uploads.href({ id: String(assetId), filename: 'hero.png' }),
    )

    // Show endpoint expands the same way.
    let show = await router.fetch(req(routes.api.show.href({ type: 'galleries', id: entryId })))
    let showBody = (await show.json()) as { data: { attributes: { photo: { url: string } } } }
    assert.equal(showBody.data.attributes.photo.url, photo.url)

    // The expanded URL actually serves the file.
    let served = await router.fetch(req(new URL(photo.url).pathname))
    assert.equal(served.status, 200)
  })

  it('refuses to delete an in-use asset and deletes unused ones (file included)', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)
    await router.fetch(
      req(routes.admin.types.create.href(), { method: 'POST', cookie, body: form(GALLERY_TYPE) }),
    )
    let usedId = await uploadFile(router, cookie, 'used.png')
    let unusedId = await uploadFile(router, cookie, 'unused.png')

    await router.fetch(
      req(routes.admin.content.create.href({ type: 'gallery' }), {
        method: 'POST',
        cookie,
        body: form({ title: 'Uses it', photo: String(usedId) }),
      }),
    )

    // In use -> refused; the asset still exists and still serves.
    let refused = await router.fetch(
      req(routes.admin.media.destroy.href({ assetId: String(usedId) }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(refused.status, 303)
    let page = await router.fetch(req(routes.admin.media.index.href(), { cookie }))
    assert.match(await page.text(), /still referenced/)
    let stillServed = await router.fetch(
      req(routes.uploads.href({ id: String(usedId), filename: 'used.png' })),
    )
    assert.equal(stillServed.status, 200)

    // Not in use -> deleted, gone from the serving route and from disk.
    let deleted = await router.fetch(
      req(routes.admin.media.destroy.href({ assetId: String(unusedId) }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(deleted.status, 303)
    let gone = await router.fetch(
      req(routes.uploads.href({ id: String(unusedId), filename: 'unused.png' })),
    )
    assert.equal(gone.status, 404)
    let leftovers = fs.readdirSync(TEST_UPLOADS_DIR).filter((name) => name.endsWith('-unused.png'))
    assert.equal(leftovers.length, 0)
  })
})

describe('S3-compatible storage driver', () => {
  // A tiny in-process object store that behaves like an S3-compatible endpoint:
  // it accepts PUT/GET/DELETE, keeps bytes in a Map, and validates that every
  // request carries a well-formed AWS SigV4 Authorization header. We point the
  // storage driver at it with path-style addressing (the fake lives on
  // 127.0.0.1, so virtual-host subdomains would not resolve).
  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7, 6])
  const objects = new Map<string, { bytes: Buffer; contentType?: string }>()
  const seen: Array<{ method: string; url: string; ok: boolean }> = []

  function hasValidSigV4(headers: http.IncomingHttpHeaders): boolean {
    let auth = typeof headers['authorization'] === 'string' ? headers['authorization'] : ''
    let region = process.env.AWS_DEFAULT_REGION
    return (
      auth.startsWith('AWS4-HMAC-SHA256 ') &&
      auth.includes(`/${region}/s3/aws4_request`) &&
      auth.includes('SignedHeaders=host;x-amz-content-sha256;x-amz-date') &&
      typeof headers['x-amz-date'] === 'string' &&
      typeof headers['x-amz-content-sha256'] === 'string'
    )
  }

  const server = http.createServer((request, response) => {
    let chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk as Buffer))
    request.on('end', () => {
      let ok = hasValidSigV4(request.headers)
      let key = request.url ?? ''
      seen.push({ method: request.method ?? '', url: key, ok })
      if (!ok) {
        response.statusCode = 403
        response.end('SignatureDoesNotMatch')
        return
      }
      if (request.method === 'PUT') {
        objects.set(key, {
          bytes: Buffer.concat(chunks),
          contentType: request.headers['content-type'] as string | undefined,
        })
        response.statusCode = 200
        response.end()
      } else if (request.method === 'GET') {
        let object = objects.get(key)
        if (!object) {
          response.statusCode = 404
          response.end()
          return
        }
        response.setHeader('Content-Type', object.contentType ?? 'application/octet-stream')
        response.end(object.bytes)
      } else if (request.method === 'DELETE') {
        objects.delete(key)
        response.statusCode = 204
        response.end()
      } else {
        response.statusCode = 405
        response.end()
      }
    })
  })

  const AWS_KEYS = [
    'AWS_ENDPOINT_URL',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_BUCKET_NAME',
    'AWS_DEFAULT_REGION',
    'AWS_S3_URL_STYLE',
  ] as const
  const previousEnv: Record<string, string | undefined> = {}

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    let port = (server.address() as AddressInfo).port
    for (let key of AWS_KEYS) previousEnv[key] = process.env[key]
    process.env.AWS_ENDPOINT_URL = `http://127.0.0.1:${port}`
    process.env.AWS_ACCESS_KEY_ID = 'AKIAEXAMPLE'
    process.env.AWS_SECRET_ACCESS_KEY = 'secret-example'
    process.env.AWS_S3_BUCKET_NAME = 'test-bucket'
    process.env.AWS_DEFAULT_REGION = 'auto'
    process.env.AWS_S3_URL_STYLE = 'path-style'
  })

  after(async () => {
    // Restore env exactly so the disk-backed suites are unaffected.
    for (let key of AWS_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key]
      else process.env[key] = previousEnv[key]
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function uploadFile(
    router: AppRouter,
    cookie: string,
    filename: string,
  ): Promise<number> {
    let body = new FormData()
    body.append('file', new File([PNG_BYTES], filename, { type: 'image/png' }))
    let headers = new Headers({ Cookie: cookie })
    let response = await router.fetch(
      new Request(ORIGIN + routes.admin.media.create.href(), { method: 'POST', body, headers }),
    )
    assert.equal(response.status, 303)
    let page = await router.fetch(req(routes.admin.media.index.href(), { cookie }))
    let html = await page.text()
    let match = html.match(new RegExp(`/uploads/(\\d+)/${filename.replace('.', '\\.')}`))
    assert.ok(match, 'expected an uploaded asset link on the media page')
    return Number(match![1])
  }

  it('stores, serves, and deletes uploads through the bucket with valid SigV4', async () => {
    let { router } = await buildApp()
    let cookie = await login(router)

    let assetId = await uploadFile(router, cookie, 'via-s3.png')

    // The bytes went to the bucket (not local disk) under one object.
    assert.equal(objects.size, 1)

    // The public serving route pulls the object back through the driver and
    // streams it with the recorded mime type.
    let served = await router.fetch(
      req(routes.uploads.href({ id: String(assetId), filename: 'via-s3.png' })),
    )
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('content-type'), 'image/png')
    assert.equal(served.headers.get('content-length'), String(PNG_BYTES.byteLength))
    assert.match(served.headers.get('cache-control') ?? '', /immutable/)
    assert.deepEqual(new Uint8Array(await served.arrayBuffer()), PNG_BYTES)

    // Every request the fake bucket saw carried a well-formed SigV4 signature,
    // and both a PUT (upload) and GET (serve) were exercised.
    assert.ok(seen.length > 0)
    for (let entry of seen) {
      assert.ok(entry.ok, `expected valid SigV4 on ${entry.method} ${entry.url}`)
    }
    assert.ok(seen.some((entry) => entry.method === 'PUT'))
    assert.ok(seen.some((entry) => entry.method === 'GET'))

    // Delete removes the object from the bucket and the serving route 404s.
    let deleted = await router.fetch(
      req(routes.admin.media.destroy.href({ assetId: String(assetId) }), {
        method: 'POST',
        cookie,
      }),
    )
    assert.equal(deleted.status, 303)
    assert.equal(objects.size, 0)

    let gone = await router.fetch(
      req(routes.uploads.href({ id: String(assetId), filename: 'via-s3.png' })),
    )
    assert.equal(gone.status, 404)
  })
})
