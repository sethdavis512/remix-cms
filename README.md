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
   number, boolean, date, email, enumeration, component. Mark a type
   **Localized** to author its entries per locale. A component field embeds a
   reusable field group (pick the component and whether it is repeatable). A
   field marked **Unique** is enforced on write (see Content Manager). The
   Unique control is only shown where it applies (not for boolean or component
   fields), and the Options input only for enumeration fields. Deleting a
   content type goes through a confirmation page that shows how many entries
   will be cascaded, since deletion removes all of the type's content.
2. **Components** (`/admin/components`): build reusable field groups (e.g. a
   "Card" with heading and body) that content types embed via fields of type
   Component. Components can only contain scalar field types (one level of
   nesting). Entry data stores the group nested, as an object for a single
   component or an array of objects when repeatable, and the public API serves
   it the same way. A component that content types still reference cannot be
   deleted.
3. **Locales** (`/admin/locales`) — manage the locales available to localized
   types. `en` (English) is seeded as the permanent default; locales that are
   the default or still referenced by entries cannot be deleted.
4. **Content Manager** (`/admin/content/:type`) — create, edit, delete, and
   publish/unpublish entries. Input is validated against the type's fields, and
   fields marked Unique are rejected with an inline error when another entry in
   the same type and locale already uses the value (the same value is allowed
   across different locales). Localized types show locale tabs; an entry's locale is chosen at creation
   and immutable afterwards. The **Scheduling** card on an entry's edit page
   sets per-entry "publish at" / "unpublish at" timers (server time); leaving
   a field blank clears that timer, and a fired timer clears itself. Due
   timers run from the same 60s server timer as releases and are also checked
   lazily on every public API read.
5. **Releases** (`/admin/releases`) — group publish/unpublish actions on
   entries and fire them together, either at a scheduled time or manually
   with "Publish now". Stage entries from their edit page ("Add to release").
   Draft entries staged to publish stay hidden from the API until the release
   fires. Due releases run from a 60s server timer and are also checked
   lazily on every public API read.
6. **Webhooks** (`/admin/webhooks`) — register URLs that receive a JSON POST
   whenever an entry is created, updated, deleted, published, or unpublished
   (including entries published/unpublished by a release). Each webhook picks
   the events it cares about and can be disabled without deleting it. The body
   is `{event, occurredAt, data}` where `data` carries the entry's id, content
   type, locale, status, field data, and publish time. Delivery is best-effort
   with a 5 second timeout: failures are logged on the server, never retried.
7. **API Tokens** (`/admin/tokens`) — bearer tokens that protect the headless
   API. A **Require API tokens** toggle controls the gate independently of how
   many tokens exist: while it is off the API is fully public, and while it is
   on every `/api` request must send `Authorization: Bearer <token>` or it gets
   a 401. The page warns when the requirement is on but no tokens exist (the API
   is then unreachable). The plaintext token is shown exactly once, right after
   creation; only a hash is stored.
8. **Users** (`/admin/users`) — invite additional admin users and reset
   passwords. There is no SMTP: inviting (or resetting) generates a random
   temporary password that is shown exactly once to the acting admin, who
   passes it along themselves. An admin cannot delete their own account, and
   the last remaining user can never be deleted.
9. **Audit log** (`/admin/audit`) — a read-only record of every admin
   mutation (content types, entries, locales, releases, users, API tokens,
   webhooks, components, and scheduling changes), showing when, who, the action,
   and a summary. Automatic transitions fired by the scheduler or a due release
   are recorded with the actor `system`. The page lists the latest 200 entries,
   newest first, with no pagination.
10. **Headless API** — published entries are served as JSON, addressed by the
   content type's plural api id:
   - `GET /api/:typePlural` — list published entries (e.g. `/api/articles`)
   - `GET /api/:typePlural/:id` — a single published entry
   - For localized types, `?locale=fr` filters the list; omitting it serves
     the default locale, and an unknown locale is a 400.

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
