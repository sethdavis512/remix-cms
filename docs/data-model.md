# Dynamic content modeling

**Status:** Accepted (Milestone 1)

This is the headline architectural decision of the project.

## Context

The goal is a Strapi-style CMS where admins define content types and their fields
**at runtime** through the UI. Three modeling strategies were on the table:

1. **Dynamic builder** — type definitions and entries stored generically (JSON);
   no per-type tables, no migration when a type is added.
2. **Code-defined collections** — each type is declared in code with a real SQL
   table and migration; type-safe but adding a type needs a code change.
3. **Hybrid** — a dynamic builder UI that generates a real table + migration per
   type behind the scenes (closest to Strapi's actual behavior, most complex).

## Decision

Use the **dynamic builder** model.

- A content type is a row in `content_types`. Its fields are a JSON array in the
  `schema` TEXT column, e.g.
  `[{"name":"title","type":"text","required":true,...}]`.
- An entry is a row in `entries`. Its field values are a JSON object in the
  `data` TEXT column, e.g. `{"title":"Hello World","body":"..."}`.
- Entries link to their type via `content_type_id` (foreign key, cascade delete).
- There is **no `articles` table** and no per-field columns anywhere.

## Why

- It delivers the defining Strapi-like capability: create a type or add a field
  and it works immediately, with **no schema migration and no `ALTER TABLE`**.
- It fits the grain of Remix v3's `data-table`, which models fixed tables plus
  hand-written SQL migrations. A runtime table generator (the hybrid option)
  fights that grain and is far more complex to build and keep safe.
- For Milestone 1 the value is in the modeling flexibility, not in rich querying,
  so the generic store is the right trade.

## Alternatives considered

- **Code-defined collections** were rejected because they are not "dynamic": a
  content editor could not create a new type without a developer and a migration.
- **Hybrid (runtime migrations)** was rejected for Milestone 1 as too complex and
  risky (generating and running DDL at runtime). It remains the natural upgrade
  path if strong per-field querying is needed later.

## Consequences

- Adding types and fields is instant and migration-free.
- You **cannot** efficiently query or filter inside the JSON with SQL (e.g. "all
  articles where author = X" needs a scan or `json_extract`). No per-field
  indexes.
- Field-level `unique` is stored in the schema but not DB-enforced (tracked as a
  follow-up, TEC-302).
- Field definitions are documentation and validation input, not DDL. The generic
  columns (`schema`, `data`) never change shape as content types evolve.

## Where it lives

- Schema: `app/data/schema.ts` (`contentTypes`, `entries` tables)
- Serialization to/from JSON and clean shapes:
  `app/data/content-types.server.ts`, `app/data/entries.server.ts`
- Field definition type and parsing: `app/utils/fields.ts`
