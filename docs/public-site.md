# Public site: self-consuming the JSON API

**Status:** Accepted

## Context

The repo is a headless CMS: runtime-defined content types served over a public,
read-only JSON API (`app/actions/api/controller.tsx`). What was missing was a
consumer that proves the point, a public-facing surface whose copy comes from
CMS entries, so editing and publishing an entry in the admin changes the live
page.

Two public areas now exist:

- `/` (root `home` action) renders the newest published `Homepage` entry, falling
  back to the original static copy when there is none.
- `/blog` and `/blog/:entryId` (`app/actions/blog/controller.tsx`) render
  published Articles from the seeded blog model.

## Decision: consume the app's own public API in-process

The public pages call the same `/api/:type` endpoints an external consumer would,
rather than reaching into the model layer directly. The pages are literally an
API consumer.

Requests are dispatched in-process through the router's own `fetch`, not over the
network:

- `app/data/cms-client.server.ts` is a small typed client (`listEntries`,
  `getEntry`) built from a fetch function plus an origin. It builds URLs from
  `routes.api.*` and returns the API's `{ id, attributes, publishedAt, ... }`
  shape.
- `app/middleware/cms-client.ts` (`loadCmsClient`) injects a client whose fetch is
  `(request) => router.fetch(request)` and whose origin is `context.url.origin`.
  It follows the `loadDatabase` context-key pattern and is registered in
  `createAppRouter`.

### Why in-process `router.fetch`

- Integration tests drive the app through `router.fetch(new Request(...))` with no
  HTTP server; the public pages work unchanged under that harness.
- API reads run `runScheduledWork`, so scheduled publishing fires automatically
  when a public page is viewed (covered by a `/blog` scheduling test).
- The client module never imports the router. The router is read through a
  deferred holder assigned right after `createRouter` returns, so there is no
  circular import and no self-referential type.

## Fallback behavior

The client plays by the same rules as any consumer: no bypass header. When the
API returns a non-200 (for example a 401 while `require_api_token` is on), the
client reports "unavailable" (`ok: false` / `null`). The home page then renders
its static default copy and the blog renders an explanatory empty state.

## Shared theme and seed content

- `app/ui/site-theme.ts` holds the design tokens (light + dark via
  `prefers-color-scheme`) and CTA styles shared by `/` and `/blog` so they read as
  one site.
- The `homepage` preset in `db/generate.ts` seeds a single-kind `Homepage` type
  (with a repeatable `Feature card` component) and one published entry carrying
  the current static copy verbatim, so switching `/` to CMS-driven rendering is
  visually seamless.
