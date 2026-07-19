# Known limitations and follow-ups

**Status:** Accepted (Milestone 1)

Milestone 1 is a working vertical slice: admin auth, a Content-Type Builder, a
Content Manager with publish, and a public read API. These are the known gaps,
with the ones filed in Linear noted.

## Filed in Linear (Remix CMS project)

- **TEC-301 — `.nvmrc` + Node preflight.** The app requires Node >= 24.3 (for
  `node:sqlite`), but nothing selects or checks the version, so a machine on an
  older Node fails cryptically. Add `.nvmrc` and a clear preflight message.
- **TEC-302 — Enforce `unique` fields. (Done.)** Unique scalar fields are now
  enforced on create and update in the content controller: a duplicate value in
  the same content type is rejected with an inline 400. Booleans and components
  are never unique-checked, and the builder hides the Unique control where it
  does not apply. Enforcement is an in-JS scan of the type's entries, not a
  database constraint (a consequence of the generic JSON storage).
- **TEC-303 — Builder add/remove field rows. (Done.)** The Content-Type Builder
  is now a hydrated field editor (`app/assets/field-rows.tsx`, the app's second
  `clientEntry`): one server-rendered blank row plus an "Add field" button that
  appends fresh rows and a per-row ✕ that removes them, all without saving. With
  JavaScript disabled the pre-rendered row still submits and blank-name rows are
  skipped. A remaining nicety, out of scope here: a newly added row's Unique and
  Options cells do not switch active/inactive when its type changes until saved
  (same as the previous blank-row behavior).
- **TEC-304 — Clear `published_at` on unpublish.** The typed write API cannot
  re-null a nullable column, so an unpublished entry keeps a stale `published_at`.
  Harmless today (the API filters on `status`), but inaccurate.

## Deliberately out of scope for Milestone 1

- **Media/upload field types have landed (TEC-305).** An `assets` table tracks
  uploaded files (stored on local disk under `uploads/`, served over the public
  `/uploads/:id/:filename` route), managed at `/admin/media`. A `media` field
  stores an asset id in `entries.data`; the entry form renders a picker of
  existing assets (uploads happen on the media page, not inline in the entry
  form). Referential integrity (the asset exists) is enforced at write time in
  the content controller, and deleting an asset is refused while any entry still
  references it (`isAssetInUse` in `assets.server.ts`, a full scan like
  relations). The public API always expands a media id into
  `{ url, filename, mimeType, size }` (null when the asset is gone). Media is
  scalar-per-field and cannot nest inside components. Known gaps: image
  resizing/transformations and alt-text metadata remain out of scope.
- **Pluggable object storage has landed.** Asset bytes go through a small
  storage-driver abstraction (`app/data/storage.server.ts`): `put`/`get`/`delete`
  over an opaque `<uuid>-<name>` key. The default driver is local disk (under
  `UPLOADS_DIR`, unchanged), and an S3-compatible driver takes over automatically
  when both `AWS_ENDPOINT_URL` and `AWS_S3_BUCKET_NAME` are set (e.g. a Railway
  bucket). The S3 driver signs its own requests with AWS Signature V4 using
  `node:crypto` (no new runtime dependency), honors `AWS_S3_URL_STYLE`
  (virtual-host by default, path-style otherwise), and puts the region
  (`AWS_DEFAULT_REGION`, e.g. `auto`) into the credential scope verbatim.
  Consumers never address the bucket directly — media is always served through
  the `/uploads/:id/:filename` route, so `assetUrlPath` and the API's expanded
  shape are unchanged regardless of backend.
- **Relation field type has landed since (TEC-308), with known gaps.** A
  `relation` field links entries across content types: the builder exposes a
  target-type select and one/many cardinality (reusing the repeatable column),
  values are stored in `entries.data` as a target entry id or id array, and the
  entry form renders a picker of the target type's entries. Referential
  integrity (target exists and is of the configured type) is enforced at write
  time in the content controller, like unique enforcement. Deleting an entry
  scans referrers and nulls/drops references (`nullifyRelationsToEntry` in
  `entries.server.ts`) — a full scan, acceptable at current scale given JSON
  storage. The public API returns raw ids by default and expands one level with
  `?populate=1` (published targets only, no recursion). Gaps: relations cannot
  live inside components (scalar-only); the target-entry picker lists every
  entry of the target type with no search or pagination; and populate/cleanup
  both scan rather than query, since you cannot index inside JSON. Incoming
  references ("used by") are filed as TEC-322.
- **RBAC / multiple roles.** There is a single admin role; no per-resource
  authorization beyond "is an admin". Filed as TEC-312 (editor role).
- **GraphQL API.** The public API is REST/JSON only.
- **API list querying has landed (TEC-310), with a scan caveat.**
  `GET /api/:typePlural` supports `?page=`/`?pageSize=` (capped, with a
  `meta.pagination` block), `?sort=` over real columns only
  (`id`, `createdAt`, `updatedAt`, `publishedAt`, `-` prefix for descending),
  and `?filter[fieldName]=value` equality filters validated against the type's
  schema. Filters use SQLite `json_extract`, which is a full scan of the
  type's rows — fine at current scale, but there are no JSON indexes; heavy
  filtering wants the hybrid model below.
- **Rich querying inside content.** A consequence of generic JSON storage: you
  cannot efficiently filter or index by a specific field. If this is needed, the
  natural upgrade is the hybrid model (a real table + migration per type); see
  [data-model](./data-model.md).
- **Draft preview tokens and full single-type UX polish.** The `single`
  content-type kind is stored and handled minimally (the content manager routes
  straight to its one entry) but is not fully built out. Draft preview filed as
  TEC-307 (signed preview URLs).
- **Content releases have landed since, with known gaps.** Releases stage
  publish/unpublish actions on entries and fire on a schedule (60s server
  timer + lazy check on API reads) or manually. Unlike Sanity's Content
  Releases, a release does not stage *content versions*: you cannot stage an
  edit to an already-published entry, only flip entry visibility. No release
  preview perspective, no revert, no archive. Scheduled times are interpreted
  in the server's timezone. Entry versioning (TEC-306) is the foundation for
  staging content versions.
- **Per-entry scheduled publishing has landed since, with known gaps.** Entries
  carry `publish_at` / `unpublish_at` timers set from a Scheduling card on the
  edit page and fired by `runScheduledWork()` (60s server timer + lazy check on
  API reads, shared with releases). Gaps: times are interpreted in the server's
  timezone; nothing validates that publish comes before unpublish or that a
  time is in the future; the due-entry scan loads all drafts/published rows and
  filters in JS rather than querying on the timestamp columns; and a timer set
  on an entry that is also staged in a release is not reconciled with it
  (whichever fires first wins).
- **API tokens have landed since, with known gaps.** Bearer tokens
  (`/admin/tokens`) gate the read API. Gating is controlled by the
  `require_api_token` setting (a `settings` key/value table, toggled on the
  tokens page), independent of how many tokens exist: while it is off the API is
  fully public, and while it is on every `/api` request needs a valid
  `Authorization: Bearer <token>`. The page warns when the requirement is on but
  no tokens exist (the API is then unreachable). Gaps: tokens are all-or-nothing
  (no per-type or read/write scopes), never expire, and cannot be rotated in
  place (create a new one, delete the old). The hash lookup is a straight
  equality check, and `last_used_at` is written on every authenticated request
  (one extra write per API read).
- **User management has landed since, with known gaps.** Admins can invite
  users and reset passwords at `/admin/users`, with delete guards (no
  self-delete, the last user is undeletable). Gaps: there is no SMTP, so the
  generated temporary password is shown once to the acting admin instead of
  being emailed; every user is an admin (see the RBAC bullet above, TEC-312); users
  cannot change their own password, and nothing forces a temp password to be
  rotated on first login.
- **Components have landed since, with known gaps.** Reusable field groups
  (`/admin/components`) can be embedded by content types as single or
  repeatable component fields; entry data stores them nested (object for
  single, array of objects for repeatable) and the API serves them as-is.
  Gaps: nesting is single-level only (a component cannot contain another
  component); repeatable items use the fixed blank-row UX (each save exposes
  two blank item groups, with no hydrated add/remove/reorder controls, so
  reordering items means retyping them); editing a component's fields does not
  migrate existing entry data (removed sub-fields linger in stored JSON and
  new ones are absent until an entry is re-saved); and renaming a component
  changes its api id, which referencing content-type schemas do not follow
  (deletion is blocked while referenced, renames are not).
- **Audit log has landed since, with known gaps.** A read-only audit trail
  (`/admin/audit`) records every mutating admin action (content types, entries,
  releases, users, API tokens, components, scheduling), with
  automatic scheduler / due-release transitions logged as the actor `system`.
  `logAudit` in `app/data/audit.server.ts` never throws (it swallows and logs
  write failures) so auditing can never break the action it records. Gaps: the
  page shows the latest 200 rows newest-first with no pagination, filtering, or
  search; the actor is recorded as a plain email string, not a foreign key, so
  entries survive (and can be orphaned by) user deletion; the log is
  append-only with no retention/rotation policy and no export; only a summary
  string is stored, not a before/after diff of what changed; and reads/logins
  are not recorded, only mutations.
- **Scaled back: localization, webhooks, and feature flags were removed.**
  Entity-level i18n (locales, per-type `localized`, per-entry `locale`,
  `?locale=`), the webhook subsystem (`/admin/webhooks` + entry-lifecycle HTTP
  callbacks), and the feature-flag / A-B framework (`/admin/flags`, `GET
  /api/flags`) all shipped and were then deliberately removed to reduce surface
  area. Their tables and migrations were deleted (not reverted). If any of these
  is ever wanted again, the git history (`refactor: remove …` commits) is the
  reference implementation.

## Guidance for extending

- Add a field type in two places: `app/ui/form-fields.tsx` (input) and
  `app/utils/field-schema.ts` (validation), plus its metadata in
  `app/utils/fields.ts`.
- Keep DB access in the `app/data/*.server.ts` modules and return clean shapes,
  not raw rows.
- Define new URLs in `app/routes.ts` first, then wire a controller and register it
  explicitly in `app/router.ts` (with `requireAdmin()` if it is an admin area).
