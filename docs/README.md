# Remix CMS: Design Decisions

This folder documents the significant decisions made while building Milestone 1
of Remix CMS, a headless, Strapi-style content management system on **Remix v3**.

Each document is a lightweight decision record: what the problem was, what we
chose, why, what we rejected, and the consequences we accepted. They describe the
state as of Milestone 1 and the reasoning behind it, so a future session (human or
agent) can extend the system without re-deriving the context.

## Reading order

1. [Remix v3 as the foundation](./remix-v3.md) — what the framework is and its
   programming model (it is not React Router, not React).
2. [Dynamic content modeling](./data-model.md) — the headline decision: content
   types and entries stored generically as JSON, no per-type tables.
3. [Persistence: SQLite, node:sqlite, SQL migrations](./persistence.md)
4. [Auth and sessions](./auth-and-sessions.md)
5. [Routing, controllers, and the middleware stack](./routing-and-controllers.md)
6. [Boundary validation with dynamic schemas](./validation.md)
7. [UI and rendering](./ui-and-rendering.md)
8. [Testing strategy](./testing.md)
9. [Known limitations and follow-ups](./limitations-and-follow-ups.md)

## Decision summary

| Area          | Decision                                                        | Doc |
| ------------- | --------------------------------------------------------------- | --- |
| Framework     | Remix v3 (`remix` package), server-first, `remix/ui` (not React)| [remix-v3](./remix-v3.md) |
| Content model | Dynamic builder; field defs + entries stored as JSON            | [data-model](./data-model.md) |
| Database      | SQLite via built-in `node:sqlite`; hand-written SQL migrations  | [persistence](./persistence.md) |
| Runtime       | Node >= 24.3 (required by `node:sqlite`)                         | [persistence](./persistence.md) |
| Auth          | Session cookie + scrypt hashing; `requireAdmin()` per controller| [auth-and-sessions](./auth-and-sessions.md) |
| Routing       | Explicit `get`/`post` leaves; controller per route area         | [routing-and-controllers](./routing-and-controllers.md) |
| Validation    | `remix/data-schema` built dynamically from a type's fields      | [validation](./validation.md) |
| Rendering     | Server-first; selective `clientEntry` hydration                 | [ui-and-rendering](./ui-and-rendering.md) |
| Tests         | `node:test` driving `router.fetch(Request)` with in-memory DB   | [testing](./testing.md) |

## Scope of Milestone 1

Admin auth, a runtime Content-Type Builder, a Content Manager (entry CRUD +
publish), and a public read-only JSON API. Deliberately out of scope and tracked
in Linear: relation/media fields, RBAC, GraphQL, API pagination/filtering, and a
few known gaps. See [limitations-and-follow-ups](./limitations-and-follow-ups.md).
