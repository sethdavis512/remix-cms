# Known limitations and follow-ups

**Status:** Accepted (Milestone 1)

Milestone 1 is a working vertical slice: admin auth, a Content-Type Builder, a
Content Manager with publish, and a public read API. These are the known gaps,
with the ones filed in Linear noted.

## Filed in Linear (Remix CMS project)

- **TEC-301 — `.nvmrc` + Node preflight.** The app requires Node >= 24.3 (for
  `node:sqlite`), but nothing selects or checks the version, so a machine on an
  older Node fails cryptically. Add `.nvmrc` and a clear preflight message.
- **TEC-302 — Enforce `unique` fields.** The builder stores a field's `unique`
  flag but nothing enforces it on write, so duplicate values are accepted
  silently. Enforce at write time in `entries.server.ts`, or hide the toggle.
- **TEC-303 — Builder add/remove field rows.** The Content-Type Builder renders a
  fixed set of blank rows; add a hydrated add/remove-row control.
- **TEC-304 — Clear `published_at` on unpublish.** The typed write API cannot
  re-null a nullable column, so an unpublished entry keeps a stale `published_at`.
  Harmless today (the API filters on `status`), but inaccurate.

## Deliberately out of scope for Milestone 1

- **Relation and media/upload field types.** Only scalar field types exist; there
  is no way to relate entries or attach files yet.
- **RBAC / multiple roles.** There is a single admin role; no per-resource
  authorization beyond "is an admin".
- **GraphQL API.** The public API is REST/JSON only.
- **API pagination, filtering, and sorting.** `GET /api/:typePlural` returns all
  published entries with no query parameters.
- **Rich querying inside content.** A consequence of generic JSON storage: you
  cannot efficiently filter or index by a specific field. If this is needed, the
  natural upgrade is the hybrid model (a real table + migration per type); see
  [data-model](./data-model.md).
- **i18n, draft preview tokens, and full single-type UX polish.** The `single`
  content-type kind is stored and handled minimally (the content manager routes
  straight to its one entry) but is not fully built out.

## Guidance for extending

- Add a field type in two places: `app/ui/form-fields.tsx` (input) and
  `app/utils/field-schema.ts` (validation), plus its metadata in
  `app/utils/fields.ts`.
- Keep DB access in the `app/data/*.server.ts` modules and return clean shapes,
  not raw rows.
- Define new URLs in `app/routes.ts` first, then wire a controller and register it
  explicitly in `app/router.ts` (with `requireAdmin()` if it is an admin area).
