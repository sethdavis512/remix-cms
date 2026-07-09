# Boundary validation with dynamic schemas

**Status:** Accepted (Milestone 1)

## Context

Entry input must be validated at the request boundary, but the fields are not
known at build time: they depend on the content type the user created. Remix v3
provides `remix/data-schema` (and `remix/data-schema/form-data`) for validating
`FormData` at trust boundaries.

## Decision

Build a `data-schema` form-data schema **on the fly** from a content type's field
definitions, then `parseSafe` the submitted `FormData` against it.

- `app/utils/field-schema.ts` maps each `FieldDef` to a schema and composes them
  into an `f.object({...})`. Every value starts as a defaulted string (so an
  absent field, e.g. an unchecked checkbox, does not blow up) and is then
  transformed and refined per type:
  - text / richtext / date: required check, trimmed (richtext preserved)
  - number: coerced to a finite number or null
  - boolean: coerced from checkbox presence
  - email: format-checked, required-aware
  - enumeration: value must be one of the field's options
- The content controller (`app/actions/admin/content/controller.tsx`) calls
  `parseSafe(buildEntrySchema(type.fields), formData)`. On success it stores the
  validated object as JSON in `entries.data`; on failure it re-renders the form
  with a 400 and inline per-field errors (issues mapped to `{ fieldName: message }`).

## Why

- Validation must be **data-driven**: the schema has to reflect whatever fields
  the admin defined, so it is constructed from the stored field definitions rather
  than hand-written per type.
- Using `parseSafe` makes validation failure a return value (re-render with
  errors), not an exception, which keeps the route contract honest: the same
  action returns 200 on success and 400 on bad input, with no out-of-band throw.
- The login and content-type forms use the same `data-schema` approach for their
  fixed fields, keeping one validation idiom across the app.

## Consequences

- Coercion lives in one pure, testable place; a change to how a field type is
  parsed is a single edit in `field-schema.ts`.
- Because storage is generic JSON (see [data-model](./data-model.md)), the schema
  is also the only thing enforcing shape on write. Cross-entry constraints like
  `unique` are not expressible here and are not yet enforced (TEC-302).

## Where it lives

- `app/utils/field-schema.ts`, `app/utils/fields.ts`
- Consumed in `app/actions/admin/content/controller.tsx`
