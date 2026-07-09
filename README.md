# Remix CMS

A headless, Strapi-style content management system built on **Remix v3**.

Define content types and their fields at runtime through an admin UI, author and
publish entries, and read published content over a public JSON API. Content-type
definitions and entries are stored generically (no per-type tables), so adding a
new content type never needs a migration.

## Requirements

- **Node.js >= 24.3** (the app uses the built-in `node:sqlite` client)

## Setup

```sh
npm i

# required: a secret used to sign the session cookie
export SESSION_SECRET="a-long-random-string"

# create the database schema
npm run db:migrate

# create the first admin user (defaults to admin@example.com / password123)
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=choose-a-password npm run db:seed

# run it
npm run dev
```

Then open <http://localhost:44100/admin> and sign in.

## Environment

| Variable         | Required     | Purpose                                            |
| ---------------- | ------------ | -------------------------------------------------- |
| `SESSION_SECRET` | yes (prod)   | Signs the session cookie. Required outside tests.  |
| `ADMIN_EMAIL`    | seed only    | Email for the seeded admin user.                   |
| `ADMIN_PASSWORD` | seed only    | Password for the seeded admin user.                |
| `DATABASE_PATH`  | no           | SQLite file path (default `./db/app.sqlite`).      |
| `PORT`           | no           | HTTP port (default `44100`).                       |

## Using it

1. **Content-Type Builder** (`/admin/content-types`) — create a content type
   (e.g. "Article") and add fields. Supported field types: text, rich text,
   number, boolean, date, email, enumeration.
2. **Content Manager** (`/admin/content/:type`) — create, edit, delete, and
   publish/unpublish entries. Input is validated against the type's fields.
3. **Headless API** — published entries are served as JSON, addressed by the
   content type's plural api id:
   - `GET /api/:typePlural` — list published entries (e.g. `/api/articles`)
   - `GET /api/:typePlural/:id` — a single published entry

Drafts are never exposed by the API.

## Architecture

- `app/routes.ts` — the typed URL contract (source of truth for links/redirects).
- `app/router.ts` — `createAppRouter(...)` builds the middleware stack and maps
  controllers. Shared by `server.ts` and the tests (which inject an in-memory DB).
- `app/actions/**/controller.tsx` — request handlers, one controller per route
  area. Admin controllers are protected with `requireAdmin()`.
- `app/data/` — `schema.ts` (typed tables), `db.ts` (SQLite connection), and
  `*.server.ts` query modules returning clean shapes.
- `app/middleware/` — session, auth, and database injection.
- `app/ui/` — shared admin shell and form-field rendering.
- `app/utils/` — pure helpers (password hashing, field metadata, dynamic
  validation-schema construction).
- `db/migrations/` — hand-written SQL. `db/migrate.ts` and `db/seed.ts` are the
  runners behind `npm run db:migrate` / `npm run db:seed`.

## Commands

```sh
npm run dev         # start the dev server (watch mode)
npm run start       # start in production mode
npm run db:migrate  # apply SQL migrations
npm run db:seed     # create the first admin user
npm test            # run the integration tests (node --test)
npm run typecheck   # tsc --noEmit
```
