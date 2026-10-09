# Testing strategy

**Status:** Accepted (Milestone 1)

## Context

Remix v3 is built on the Fetch API, so routes can be tested by handing a `Request`
to `router.fetch(...)` and asserting on the returned `Response`, with no HTTP
server or mocking. The scaffold's test script runs `remix test`.

## Decision

Write **integration tests at the router boundary** using `remix/test`, driving the
real app through `router.fetch(new Request(...))`.

- `app/router.test.ts` builds a fresh app per test via `createAppRouter(...)`
  (the same factory `server.ts` uses) with a **real PostgreSQL test database**
  (`TEST_DATABASE_URL`, default `remix_cms_test`) and **memory session storage**.
  The database is dropped, recreated, and migrated once per run (`beforeAll`),
  and `buildApp()` truncates every app table with `restart identity cascade`,
  restores the settings seed row, and seeds the admin, so each test starts from
  identical state. Tests in the file run one at a time, which is what makes the
  shared database safe; a second DB-backed test file must use its own database
  name.
- Tests use `routes.<name>.href(...)` to build URLs (coupled to the route
  contract), post `x-www-form-urlencoded` bodies, and carry the session cookie
  returned from login.

### Coverage

- Auth: unauthenticated `/admin` redirects to login; invalid credentials 401;
  valid login grants access.
- Content-Type Builder: create a type and see it listed; reject an unnamed type.
- Content Manager + API: reject a missing required field (400); persist a valid
  entry; confirm a draft is absent from the API; publish; confirm the API then
  returns exactly the one entry; unknown type 404.

## Why

- Testing through `router.fetch` exercises the actual middleware stack,
  controllers, validation, and persistence together, which is the behavior that
  matters, and it needs no test harness.
- The shared factory means tests run the same wiring as production, only with
  injected in-memory dependencies.

## Note on the runner

These tests use `remix/test` (`describe`/`it`/`before`/`after`) with
`remix/assert` (a `node:assert/strict`-compatible subset), run by `remix test`,
which is the runner the Remix 3 starter ships with, rather than the project
owner's usual `vitest`. The suite started on `node:test` during the 3.0 beta and
was moved over as an import swap when upgrading to 3.0. Vitest is not wired into
this app and the framework's testing idiom is `router.fetch` + a lightweight
runner. Test discovery and the `server` type are configured in `remix.json`; the
Playwright e2e suite under `e2e/` is excluded and still runs via `npm run
test:e2e`.

## Where it lives

- `app/router.test.ts` (run with `npm test`)
