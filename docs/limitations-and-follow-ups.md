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
  the same content type and locale is rejected with an inline 400, while the
  same value is allowed across different locales. Booleans and components are
  never unique-checked, and the builder hides the Unique control where it does
  not apply. Enforcement is an in-JS scan of the type's entries, not a database
  constraint (a consequence of the generic JSON storage).
- **TEC-303 — Builder add/remove field rows.** The Content-Type Builder renders a
  fixed set of blank rows; add a hydrated add/remove-row control.
- **TEC-304 — Clear `published_at` on unpublish.** The typed write API cannot
  re-null a nullable column, so an unpublished entry keeps a stale `published_at`.
  Harmless today (the API filters on `status`), but inaccurate.

## Deliberately out of scope for Milestone 1

- **Relation and media/upload field types.** Only scalar field types and
  component groups exist; there is no way to relate entries or attach files
  yet. Filed as TEC-305 (media library + field type) and TEC-308 (relation
  field type).
- **RBAC / multiple roles.** There is a single admin role; no per-resource
  authorization beyond "is an admin". Filed as TEC-312 (editor role).
- **GraphQL API.** The public API is REST/JSON only.
- **API pagination, filtering, and sorting.** `GET /api/:typePlural` returns all
  published entries with no query parameters. Filed as TEC-310.
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
- **Webhooks have landed since, with known gaps.** Webhooks (`/admin/webhooks`)
  fire a JSON POST on entry lifecycle events (created, updated, deleted,
  published, unpublished), including entries flipped by a release (fired after
  the release transaction commits). Delivery is best-effort fire-and-forget
  with a 5 second timeout. Gaps: no request signing (no shared secret or HMAC
  header for receivers to verify), no retries or delivery log, no test-ping
  button, and events cover entries only (no content-type or release events).
  A crash between a release commit and dispatch loses those deliveries.
  Signing, retries/delivery log, and test ping filed as TEC-316.
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
  locales, releases, users, API tokens, webhooks, components, scheduling), with
  automatic scheduler / due-release transitions logged as the actor `system`.
  `logAudit` in `app/data/audit.server.ts` never throws (it swallows and logs
  write failures) so auditing can never break the action it records. Gaps: the
  page shows the latest 200 rows newest-first with no pagination, filtering, or
  search; the actor is recorded as a plain email string, not a foreign key, so
  entries survive (and can be orphaned by) user deletion; the log is
  append-only with no retention/rotation policy and no export; only a summary
  string is stored, not a before/after diff of what changed; and reads/logins
  are not recorded, only mutations.
- **Feature flags / A-B testing have landed since, with known gaps.** A
  LaunchDarkly-style framework (`/admin/flags`, public `GET /api/flags` and
  `/api/flags/:key`) resolves a named flag to one variant per user: boolean flags
  are on/off with targeting, experiments split traffic by weight via deterministic
  `sha1(flagKey:userKey)` bucketing (sticky with no stored assignments). Each
  variant carries an arbitrary JSON config payload. Flags start/stop on a schedule
  fired by `runScheduledWork` (see [feature-flags](./feature-flags.md)). Gaps: no
  conversion/goal-metric or exposure tracking (assignment is sticky but
  unrecorded); experiment weights are validated in JS (must be whole numbers
  summing to 100), not by a DB constraint; schedule times are the server's
  timezone (same caveat as releases/entries); targeting is limited to `equals` /
  `in` on string attributes passed as query params (no numeric/semver/percentage
  rollout rules); every evaluation requires a `?user=` key; and flag lifecycle
  events are audited but not delivered as webhooks (the webhook event model is
  entry-only — see the webhooks bullet above).
- **i18n has landed since, with known gaps.** Entity-level localization exists
  (locales settings page, per-type `localized` flag, per-entry `locale`,
  `?locale=` on the API). Still missing: linked translation groups (a "Bonjour"
  entry is not connected to its "Hello" counterpart), per-field localization,
  and changing the default locale (fixed at seeded `en`).

## Guidance for extending

- Add a field type in two places: `app/ui/form-fields.tsx` (input) and
  `app/utils/field-schema.ts` (validation), plus its metadata in
  `app/utils/fields.ts`.
- Keep DB access in the `app/data/*.server.ts` modules and return clean shapes,
  not raw rows.
- Define new URLs in `app/routes.ts` first, then wire a controller and register it
  explicitly in `app/router.ts` (with `requireAdmin()` if it is an admin area).
