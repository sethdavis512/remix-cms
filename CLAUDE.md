# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A headless, Strapi-style CMS built on **Remix v3** (the `remix` npm package, v3 beta). Content types and their fields are defined at runtime through an admin UI and stored generically as JSON — adding a content type never needs a migration. Published entries are served over a public read-only JSON API.

## Critical: Remix v3 is not React Router and not React

This app does NOT use React Router 7 / framework mode, loaders/actions, `./+types`, or React itself. Global rules and skills about React Router or React components do not apply here. The source of truth for framework patterns is the bundled skill at `.agents/skills/remix/SKILL.md` — read it before structural work, and load only the reference files it points you to. Key differences:

- Import from `remix/<subpath>` only (e.g. `remix/router`, `remix/data-schema`); there is no top-level `remix` import.
- UI components come from `remix/ui`, not React: `function Page(handle: Handle<Props>) { return () => <jsx/> }`. Props are read from `handle.props`, state lives in setup-scope variables, updates are explicit via `handle.update()`. No hooks.
- Controllers return explicit `Response` objects (including redirects, 404s, and 400s for validation failures).
- Styling is done inline with the `css()` mixin from `remix/ui` applied via the `mix` prop — no Tailwind, no stylesheets.
- Everything here is server-rendered with zero hydration so far; only add `clientEntry(...)` for real browser interactivity.

## Requirements and commands

Node **>= 24.3** is required (`node:sqlite`). The default shell Node may be older — use `source ~/.nvm/nvm.sh && nvm use 24.18.0` first or commands fail cryptically.

```sh
npm run dev         # dev server with watch, http://localhost:44100 (needs SESSION_SECRET)
npm run start       # production mode
npm test            # node --test integration suite
npm run typecheck   # tsc --noEmit
npm run db:migrate  # apply SQL migrations (node --import remix/node-tsx db/migrate.ts [up|down])
npm run db:seed     # create the first admin user (ADMIN_EMAIL / ADMIN_PASSWORD)
npm run db:generate # interactive sample-data generator (@inquirer/prompts); -- --all -y for non-interactive
```

Run a single test file: `NODE_ENV=test node --import remix/node-tsx --test app/router.test.ts` (add `--test-name-pattern="..."` for one test). Tests use `node:test` + `node:assert`, NOT vitest — this is the runner the Remix v3 starter ships with; keep it.

`SESSION_SECRET` must be set outside tests. Local login after seeding: `admin@example.com` / `password123`.

Warning: `db/migrate.ts down` reverts ALL migrations, not just the last one — it wipes the local database (`db/app.sqlite`). Re-run `db:migrate` + `db:seed` afterwards.

## Architecture

Request flow: `server.ts` → `createAppRouter()` (`app/router.ts`) → middleware stack (static files, render, formData, methodOverride, session, database, auth) → one controller per route area.

- `app/routes.ts` — the typed URL contract. Always define new URLs here first and generate URLs everywhere else with `routes.<name>.href(...)`. Search params (e.g. `?sort=`) are appended manually to `href()` output.
- `app/router.ts` — builds the middleware stack and maps controllers. Nested route maps (e.g. `routes.admin.types`, `routes.admin.releases`) each need their own controller registered explicitly with `router.map(...)`; controller middleware does not cascade, so every admin controller adds `requireAdmin()` itself.
- `app/actions/<route-key>/controller.tsx` — request handlers plus their route-local page components, co-located in the same file. Directory names match route-map keys, not URL segments.
- `app/data/` — `schema.ts` (typed `remix/data-table` definitions mirroring the SQL DDL), `db.ts` (SQLite connection), and `*.server.ts` query modules that return clean camelCase shapes, never raw rows. Controllers never touch tables directly.
- `app/ui/` — shared admin shell (sidebar/nav/buttons/theme via CSS custom properties) and form-field rendering.
- `app/utils/` — pure helpers only (no framework/DB imports): password hashing, field metadata, dynamic validation-schema construction.
- `db/migrations/<timestamp>_<name>/up.sql` + `down.sql` — hand-written SQL owns the actual schema; `app/data/schema.ts` must be kept in sync by hand.

### The dynamic content model

The headline design decision (see `docs/data-model.md`): `content_types.schema` stores a JSON array of `FieldDef`s, and `entries.data` stores a JSON object validated against them at the boundary via `buildEntrySchema()` (`app/utils/field-schema.ts`), which constructs a `remix/data-schema` schema at request time. Consequence: you cannot efficiently query inside entry data.

Adding a new field type touches three places: `app/utils/fields.ts` (metadata), `app/utils/field-schema.ts` (validation), `app/ui/form-fields.tsx` (input rendering).

### Content releases and per-entry scheduling

Sanity-style releases: `releases` + `release_items` tables stage publish/unpublish actions on entries, fired atomically by `publishRelease()` (`app/data/releases.server.ts`). Releases do not stage content versions; they only flip entry visibility. Entries also carry their own `publish_at` / `unpublish_at` timers (Scheduling card on the entry edit page, posted to `routes.admin.content.schedule`; a blank input clears a timer). All time-driven work runs through `runScheduledWork()` (`app/data/scheduler.server.ts`), which fires due releases and per-entry timers (recording a `system` audit entry for each transition); it is called from a 60-second `setInterval` in `server.ts` AND lazily at the top of public API reads, so tests can trigger scheduled publishing by hitting the API.

### Testing pattern

Integration tests drive the whole app through `router.fetch(new Request(...))` and assert on the `Response` — no HTTP server. Each suite builds a fresh app via `buildApp()` in `app/router.test.ts`: in-memory SQLite, migrations applied from disk, memory session storage, seeded admin. Reuse its helpers (`req`, `form`, `login`) when adding tests; get URLs from `routes.<name>.href(...)`.

## Docs

`docs/` holds decision records for every significant choice (data model, persistence, auth, validation, rendering, testing) plus `docs/limitations-and-follow-ups.md`, which lists known gaps and the Linear tickets tracking them. Read the relevant record before revisiting one of those decisions; update the limitations doc when you close or add a gap.
