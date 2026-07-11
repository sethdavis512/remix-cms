# Feature flags & A/B testing

**Status:** Accepted (Milestone 2)

## Context

The CMS gates and experiments on nothing: content is either published or not.
We want LaunchDarkly-style feature management — turn features on/off per audience,
and run weighted A/B/n experiments — served over the same public API surface as
content, without a separate analytics stack.

Three shapes were on the table:

1. **Separate "flags" and "experiments" subsystems** — two data models, two UIs.
2. **One "flag" primitive** with a `kind` discriminator (boolean vs experiment),
   sharing variants, targeting, scheduling, and evaluation.
3. **Full experimentation platform** — flags plus exposure logging, goal metrics,
   and statistical significance.

## Decision

Build **one flag primitive** (option 2). A flag resolves to exactly one of its
**variants** for a given user; each variant carries an arbitrary **JSON config
payload** that the caller renders however it likes (decoupled from CMS entries).

- `flags` — `key` (unique slug), `name`, `description`, `kind`
  (`boolean` | `experiment`), `enabled` (kill switch), optional `start_at`/`end_at`
  schedule, `lifecycle_state`, and `off_variant_id` / `fallthrough_variant_id`
  pointers.
- `flag_variants` — `key`, `name`, `weight` (0–100, experiments only), `config`
  (JSON), `position`.
- `flag_rules` — ordered targeting rules (`attribute` `equals`/`in` `value` →
  a variant).

**Evaluation** (`app/utils/bucketing.ts`, pure) resolves in precedence order:
disabled → off variant (`disabled`); outside the `[start_at, end_at]` window →
off variant (`out_of_window`); first matching targeting rule → its variant
(`rule_match`); a boolean flag → its fallthrough ("on") variant (`fallthrough`);
an experiment → deterministic weighted bucketing (`bucket`); nothing servable →
`null` (`no_variants`).

**Deterministic bucketing:** `sha1(flagKey + ':' + userKey)` → a stable bucket
`0..99`, mapped to a variant by cumulative weight. The same `(flag, user)` always
resolves to the same variant, so assignment is **sticky with no stored
assignment table**. Keying by flag means a user is not correlated to the same
slot across flags.

**Public API** (`GET /api/flags` and `GET /api/flags/:key`, both requiring
`?user=<key>`) reuses the entries API's bearer-token gate and fires due scheduled
work lazily, exactly like the content endpoints.

## Why

- One primitive keeps the data model, admin UI, targeting, scheduling, and
  evaluation code shared; a boolean flag is just a 2-variant flag whose "on" is
  served directly instead of by weight.
- Deterministic hashing gives sticky assignment for free — no per-user writes on
  the read path, which fits a read-optimized headless API.
- JSON config payloads keep flags independent of the content model, so a flag can
  gate anything (a copy string, a layout, a feature toggle), not just entries.
- Scheduling and the lazy-fire pattern already exist for releases and per-entry
  timers (`runScheduledWork`); flags plug into the same path.

## Alternatives considered

- **Separate flag/experiment subsystems** — rejected as duplicated surface for
  what is one concept with a mode switch.
- **Full experimentation platform** (exposure logs + goal metrics + significance)
  — deferred. It needs an events/assignments store and a stats layer that is a
  project of its own; see the follow-ups doc.
- **Real foreign keys for the off/fallthrough pointers** — rejected: a FK
  `flags → flag_variants` combined with `flag_variants.flag_id → flags` is
  circular and complicates insert ordering and cascade deletes. The pointers are
  plain integer columns, app-validated, and NULL-cleared in JS when their target
  variant is deleted (the same `rawSql` escape hatch releases use for
  unscheduling).
- **Persisting assignments** for stickiness — unnecessary given deterministic
  hashing, and it would add a write per evaluation.

## Consequences

- Assignment is sticky and reproducible, but there is **no record of who saw
  what** — exposure/conversion analytics are out of scope (a deliberate cut).
- Experiment weights are validated in application code (must be whole numbers
  summing to 100) at the request boundary, not by a DB constraint.
- `lifecycle_state` is advanced once each across a boundary by the scheduler
  (`scheduled → active → ended`), which is what makes start/end fire an audit
  entry exactly once; evaluation still enforces the window live, so a flag reads
  as off the instant it is out of window even before the transition row flips.
- Schedule times are interpreted in the server's timezone (same caveat as
  releases and per-entry timers).
- Targeting is limited to `equals` and `in` on string attributes supplied as
  query params; there is no numeric/semver/percentage-rollout rule type yet.

## Where it lives

- Schema: `app/data/schema.ts` (`flags`, `flagVariants`, `flagRules`) +
  `db/migrations/20260710220000_feature_flags/`
- Pure evaluation: `app/utils/bucketing.ts` (+ `bucketing.test.ts`)
- Data layer: `app/data/flags.server.ts` (CRUD, evaluation orchestration,
  `runDueFlagTransitions`)
- Admin UI: `app/actions/admin/flags/controller.tsx`, nav in
  `app/ui/admin-shell.tsx`
- Public API: `app/actions/api/flags/controller.tsx` (`routes.api.flags`)
- Scheduling: hooked into `runScheduledWork` in `app/data/scheduler.server.ts`
- Tests: the `feature flags` suite in `app/router.test.ts`
