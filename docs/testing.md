# Testing strategy

**Status:** Accepted (Milestone 1)

## Context

Remix v3 is built on the Fetch API, so routes can be tested by handing a `Request`
to `router.fetch(...)` and asserting on the returned `Response`, with no HTTP
server or mocking. The scaffold's test script runs `node --test`.

## Decision

Write **integration tests at the router boundary** using `node:test`, driving the
real app through `router.fetch(new Request(...))`.

- `app/router.test.ts` builds a fresh app per suite via `createAppRouter(...)`
  (the same factory `server.ts` uses) with an **in-memory SQLite database** and
  **memory session storage**, so suites are isolated with no shared state and no
  filesystem writes. Migrations are applied to the in-memory DB and an admin user
  is seeded in the setup helper.
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

These tests use `node:test`, the runner the Remix v3 starter ships with, rather
than the project owner's usual `vitest`. Vitest is not wired into this app and the
framework's testing idiom is `router.fetch` + a lightweight runner, so `node:test`
was kept. Revisit if the repo later adopts vitest.

## Where it lives

- `app/router.test.ts` (run with `npm test`)
