# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A headless, Strapi-style CMS built on **Remix 3** (the `remix` npm package, `^3.0.0`). Content types and their fields are defined at runtime through an admin UI and stored generically as JSON — adding a content type never needs a migration. Published entries are served over a public read-only JSON API.

## Critical: Remix v3 is not React Router and not React

This app does NOT use React Router 7 / framework mode, loaders/actions, `./+types`, or React itself. Global rules and skills about React Router or React components do not apply here. The source of truth for framework patterns is the bundled skill at `.agents/skills/remix/SKILL.md` — read it before structural work. It points you to the installed docs: `node_modules/remix/INDEX.md` maps tasks to `node_modules/remix/guides/*.md` and to the package READMEs under `node_modules/remix/src/**/README.md`. Treat those installed docs as canonical. Key differences:

- Import from `remix/<subpath>` only (e.g. `remix/router`, `remix/data-schema`). The root `remix` module is type-only and exists solely for the `declare module 'remix' { interface RouterTypes {...} }` augmentation in `app/router.ts`.
- UI components come from `remix/component`, not React: `function Page(handle: Handle<Props>) { return () => <jsx/> }`. Props are read from `handle.props`, state lives in setup-scope variables, updates are explicit via `handle.update()`. No hooks.
- Controllers return explicit `Response` objects (including redirects, 404s, and 400s for validation failures).
- Styling is done inline with the `css()` mixin from `remix/component` applied via the `mix` prop — no Tailwind, no stylesheets.
- Server-rendered first; only add `clientEntry(import.meta.url, Component)` for real browser interactivity. Browser-reachable source must live in a colocated `public/` directory (`app/actions/public/entry.ts` is the browser entry; client entries sit in `public/` next to the controller or shared UI that owns them). The asset server only serves `app/routes.ts` and `app/**/public/**`, so a client entry anywhere else will 404 in the browser.

## Requirements and commands

Node **>= 24.3** is required. The default shell Node may be older — use `source ~/.nvm/nvm.sh && nvm use 24.18.0` first or commands fail cryptically.

A local **PostgreSQL** server must be running (Postgres.app on this machine). The app uses `DATABASE_URL` (default `postgres://localhost:5432/remix_cms`); tests use `TEST_DATABASE_URL` (default `postgres://localhost:5432/remix_cms_test`), which `npm test` drops and recreates on every run, so never point it at a database you care about.

```sh
npm run dev         # dev server with watch (server restarts only), http://localhost:44100
npm run hmr         # dev server with full-stack HMR (server reload + in-place component updates)
npm run start       # production mode
npm test            # remix test (integration suite)
npm run typecheck   # tsc --noEmit
npm run db:reset    # remix db reset --force: drop, recreate, and migrate the database (first-time setup)
npm run db:migrate  # remix db migrate: apply pending SQL migrations
npm run db:rollback # remix db rollback: revert the most recent migration (--step N / --to <id> / --dry-run)
npm run db:status   # remix db status: list applied / pending migrations
npm run db:seed     # create the first admin user (ADMIN_EMAIL / ADMIN_PASSWORD)
npm run db:generate # interactive sample-data generator (@inquirer/prompts); -- --all -y for non-interactive
```

The `remix db` commands read their database and migrations directory from `remix.json` (Postgres connection from `DATABASE_URL`). The CLI does not load `.env`, so export the variable in the shell when it differs from the default. `remix doctor` and `remix routes` are also available via `npx remix ...`.

Run a single test file: `NODE_ENV=test npx remix test router` (a bare word expands to `**/*router*.test*`; add `--only "<name pattern>"` for one test). Tests use `remix/test` + `remix/assert` (a `node:assert/strict`-compatible subset), NOT vitest — this is the runner the Remix 3 starter ships with; keep it.

`SESSION_SECRET` must be set outside tests. Local login after seeding: `admin@example.com` / `password123`.

## Architecture

Request flow: `server.ts` → `createAppRouter()` (`app/router.ts`) → middleware stack (compression, static files, `render({ assets })` from `remix/middleware/render`, formData, methodOverride, session, database, cms-client, auth) → one controller per route area. `app/assets.ts` owns the asset server (`remix/assets`) and resolves the browser entry's import map and preloads once at startup for `app/ui/document.tsx`.

- `app/routes.ts` — the typed URL contract. Always define new URLs here first and generate URLs everywhere else with `routes.<name>.href(...)`. Search params (e.g. `?sort=`) are appended manually to `href()` output.
- `app/router.ts` — builds the middleware stack and maps controllers. Nested route maps (e.g. `routes.admin.types`, `routes.admin.releases`) each need their own controller registered explicitly with `router.map(...)`; controller middleware does not cascade, so every admin controller adds `requireAdmin()` itself.
- `app/actions/<route-key>/controller.tsx` — request handlers plus their route-local page components, co-located in the same file. Directory names match route-map keys, not URL segments.
- `app/data/` — `schema.ts` (typed `remix/data-table` definitions mirroring the SQL DDL), `db.ts` (`createPostgresDatabase` from `remix/data-table/postgres` via `openDatabase(url)`; it also installs the `pg` int8 parser so bigint timestamps come back as numbers), and `*.server.ts` query modules that return clean camelCase shapes, never raw rows. Controllers never touch tables directly.
- `app/ui/` — shared admin shell (sidebar/nav/buttons/theme via CSS custom properties) and form-field rendering.
- `app/utils/` — pure helpers only (no framework/DB imports): password hashing, field metadata, dynamic validation-schema construction.
- `db/migrations/<timestamp>_<name>/up.sql` + `down.sql` — hand-written Postgres SQL owns the actual schema; `app/data/schema.ts` must be kept in sync by hand. Every directory prefix must have the same digit count (14, `YYYYMMDDHHmmss`). Ids are `integer generated by default as identity`; timestamps are epoch milliseconds in `bigint` columns (declared `c.integer()` in schema.ts, which is why db.ts parses int8 to number). The raw-SQL escape hatch (`rawSql('... ?', [...])`) keeps `?` placeholders; the Postgres compiler rewrites them to `$n`.

### The dynamic content model

The headline design decision (see `docs/data-model.md`): `content_types.schema` stores a JSON array of `FieldDef`s, and `entries.data` stores a JSON object validated against them at the boundary via `buildEntrySchema()` (`app/utils/field-schema.ts`), which constructs a `remix/data-schema` schema at request time. Consequence: you cannot efficiently query inside entry data.

Adding a new field type touches three places: `app/utils/fields.ts` (metadata), `app/utils/field-schema.ts` (validation), `app/ui/form-fields.tsx` (input rendering).

### Content releases and per-entry scheduling

Sanity-style releases: `releases` + `release_items` tables stage publish/unpublish actions on entries, fired atomically by `publishRelease()` (`app/data/releases.server.ts`). Releases do not stage content versions; they only flip entry visibility. Entries also carry their own `publish_at` / `unpublish_at` timers (Scheduling card on the entry edit page, posted to `routes.admin.content.schedule`; a blank input clears a timer). All time-driven work runs through `runScheduledWork()` (`app/data/scheduler.server.ts`), which fires due releases and per-entry timers (recording a `system` audit entry for each transition); it is called from a 60-second `setInterval` in `server.ts` AND lazily at the top of public API reads, so tests can trigger scheduled publishing by hitting the API.

### Public site (self-consuming the API)

The public pages `/` (root `home` action) and `/blog` + `/blog/:entryId` (`app/actions/blog/controller.tsx`) are consumers of the app's own public JSON API: they call the same `/api/:type` endpoints an external client would, dispatched in-process via the CMS client (`app/data/cms-client.server.ts`) that `loadCmsClient` (`app/middleware/cms-client.ts`) injects with `(request) => router.fetch(request)`. So publishing an entry in the admin changes the live page, and API reads fire `runScheduledWork` automatically. A non-200 from the API (e.g. token-gated) is treated as "unavailable": home falls back to its static default copy, the blog shows an empty state. The home page is driven by a single-kind `Homepage` type; seed one with `npm run db:generate` (the `homepage` preset). See `docs/public-site.md`.

### Testing pattern

Integration tests drive the whole app through `router.fetch(new Request(...))` and assert on the `Response` — no HTTP server. `app/router.test.ts` opens one Postgres test database (`TEST_DATABASE_URL`), resets and migrates it once in `beforeAll`, and every `buildApp()` truncates all app tables (`restart identity cascade`), restores the settings seed row, seeds the admin, and returns a router with memory session storage. This relies on tests in the file running one at a time; a second DB-backed test file would need its own database name. Reuse its helpers (`req`, `form`, `login`) when adding tests; get URLs from `routes.<name>.href(...)`.

## Docs

`docs/` holds decision records for every significant choice (data model, persistence, auth, validation, rendering, testing) plus `docs/limitations-and-follow-ups.md`, which lists known gaps and the Linear tickets tracking them. Read the relevant record before revisiting one of those decisions; update the limitations doc when you close or add a gap.
