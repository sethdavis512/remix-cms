import { rawSql } from 'remix/data-table'

import type { AppDatabase } from './db.ts'
import { flags, flagVariants, flagRules, type FlagRow, type FlagVariantRow, type FlagRuleRow } from './schema.ts'
import { logAudit } from './audit.server.ts'
import {
  decide,
  type DecisionFlag,
  type DecisionReason,
  type EvalRule,
  type WeightedVariant,
} from '../utils/bucketing.ts'

// Feature flags & A/B experiments. A flag resolves to one of its variants per
// user. Boolean flags are on/off with targeting; experiments split traffic by
// weight via deterministic bucketing (app/utils/bucketing.ts). Each variant
// carries an arbitrary JSON config payload. Flags can start/stop on a schedule,
// fired by runDueFlagTransitions from the shared scheduler.
//
// Follows the repo's data-layer conventions: every fn takes db first, returns
// clean camelCase shapes (never raw rows), and drops to rawSql only where the
// typed write API can't express a NULL.

export type FlagKind = 'boolean' | 'experiment'
export type LifecycleState = 'scheduled' | 'active' | 'ended'
export type RuleOperator = 'equals' | 'in'

export interface Flag {
  id: number
  key: string
  name: string
  description: string
  kind: FlagKind
  enabled: boolean
  startAt: number | null
  endAt: number | null
  lifecycleState: LifecycleState
  offVariantId: number | null
  fallthroughVariantId: number | null
  createdAt: number
  updatedAt: number
}

export interface FlagVariant {
  id: number
  flagId: number
  key: string
  name: string
  weight: number
  config: unknown
  position: number
  createdAt: number
  updatedAt: number
}

export interface FlagRule {
  id: number
  flagId: number
  variantId: number
  attribute: string
  operator: RuleOperator
  value: string
  position: number
  createdAt: number
  updatedAt: number
}

// The result served over the public evaluation API.
export interface FlagEvaluation {
  key: string
  kind: FlagKind
  enabled: boolean
  variant: string | null
  value: unknown
  reason: DecisionReason
}

function toFlag(row: FlagRow): Flag {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    kind: row.kind === 'experiment' ? 'experiment' : 'boolean',
    enabled: row.enabled === 1,
    startAt: row.start_at ?? null,
    endAt: row.end_at ?? null,
    lifecycleState:
      row.lifecycle_state === 'scheduled' || row.lifecycle_state === 'ended'
        ? row.lifecycle_state
        : 'active',
    offVariantId: row.off_variant_id ?? null,
    fallthroughVariantId: row.fallthrough_variant_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toVariant(row: FlagVariantRow): FlagVariant {
  let config: unknown = {}
  try {
    config = JSON.parse(row.config)
  } catch {
    config = {}
  }
  return {
    id: row.id,
    flagId: row.flag_id,
    key: row.key,
    name: row.name,
    weight: row.weight,
    config,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toRule(row: FlagRuleRow): FlagRule {
  return {
    id: row.id,
    flagId: row.flag_id,
    variantId: row.variant_id,
    attribute: row.attribute,
    operator: row.operator === 'in' ? 'in' : 'equals',
    value: row.value,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// scheduled while the start is still in the future; active otherwise. 'ended' is
// only reached via the scheduler crossing end_at (runDueFlagTransitions).
function initialLifecycle(startAt: number | null, now: number): LifecycleState {
  return startAt != null && startAt > now ? 'scheduled' : 'active'
}

// ----- Flags -----

export async function listFlags(db: AppDatabase): Promise<Flag[]> {
  let rows = await db.findMany(flags, { orderBy: ['created_at', 'desc'] })
  return rows.map(toFlag)
}

export async function findFlag(db: AppDatabase, id: number): Promise<Flag | null> {
  let row = await db.find(flags, id)
  return row ? toFlag(row) : null
}

export async function findFlagByKey(db: AppDatabase, key: string): Promise<Flag | null> {
  let row = await db.findOne(flags, { where: { key } })
  return row ? toFlag(row) : null
}

// Create a flag with two starter variants so it is immediately usable, all in
// one transaction. Boolean flags get off/on (fallthrough = on); experiments get
// control/treatment split 50/50 (off = control). The flag starts disabled.
export async function createFlag(
  db: AppDatabase,
  input: {
    key: string
    name: string
    description: string
    kind: FlagKind
    startAt: number | null
    endAt: number | null
  },
): Promise<Flag> {
  let now = Date.now()
  let newId = 0
  await db.transaction(async (tx) => {
    let created = await tx.create(
      flags,
      {
        key: input.key,
        name: input.name,
        description: input.description,
        kind: input.kind,
        enabled: 0,
        start_at: input.startAt ?? undefined,
        end_at: input.endAt ?? undefined,
        lifecycle_state: initialLifecycle(input.startAt, now),
        created_at: now,
        updated_at: now,
      },
      { returnRow: true },
    )
    newId = created.id

    let starters =
      input.kind === 'boolean'
        ? [
            { key: 'off', name: 'Off', weight: 0 },
            { key: 'on', name: 'On', weight: 0 },
          ]
        : [
            { key: 'control', name: 'Control', weight: 50 },
            { key: 'treatment', name: 'Treatment', weight: 50 },
          ]

    let variantIds: number[] = []
    for (let [i, starter] of starters.entries()) {
      let v = await tx.create(
        flagVariants,
        {
          flag_id: created.id,
          key: starter.key,
          name: starter.name,
          weight: starter.weight,
          config: '{}',
          position: i,
          created_at: now,
          updated_at: now,
        },
        { returnRow: true },
      )
      variantIds.push(v.id)
    }

    // off = first starter, fallthrough = second.
    await tx.update(flags, created.id, {
      off_variant_id: variantIds[0],
      fallthrough_variant_id: variantIds[1],
      updated_at: now,
    })
  })

  let row = await db.find(flags, newId)
  if (!row) throw new Error(`Flag ${newId} not found after create`)
  return toFlag(row)
}

// Update name/description/schedule. start_at/end_at may need to be NULL, which
// the typed write API can't express, so this uses the raw escape hatch for all
// updates uniformly. lifecycle_state is recomputed from the new schedule.
export async function updateFlag(
  db: AppDatabase,
  id: number,
  input: { name: string; description: string; startAt: number | null; endAt: number | null },
): Promise<Flag> {
  let now = Date.now()
  await db.exec(
    rawSql(
      'update flags set name = ?, description = ?, start_at = ?, end_at = ?, lifecycle_state = ?, updated_at = ? where id = ?',
      [
        input.name,
        input.description,
        input.startAt,
        input.endAt,
        initialLifecycle(input.startAt, now),
        now,
        id,
      ],
    ),
  )
  let row = await db.find(flags, id)
  if (!row) throw new Error(`Flag ${id} not found`)
  return toFlag(row)
}

export async function setFlagEnabled(db: AppDatabase, id: number, enabled: boolean): Promise<Flag> {
  let updated = await db.update(flags, id, { enabled: enabled ? 1 : 0, updated_at: Date.now() })
  return toFlag(updated)
}

// Point the flag at its off / fallthrough variants (either may be null). rawSql
// so a pointer can be cleared to NULL.
export async function setFlagDefaults(
  db: AppDatabase,
  id: number,
  input: { offVariantId: number | null; fallthroughVariantId: number | null },
): Promise<void> {
  await db.exec(
    rawSql(
      'update flags set off_variant_id = ?, fallthrough_variant_id = ?, updated_at = ? where id = ?',
      [input.offVariantId, input.fallthroughVariantId, Date.now(), id],
    ),
  )
}

export async function deleteFlag(db: AppDatabase, id: number): Promise<void> {
  await db.delete(flags, id)
}

// ----- Variants -----

export async function listVariants(db: AppDatabase, flagId: number): Promise<FlagVariant[]> {
  let rows = await db.findMany(flagVariants, {
    where: { flag_id: flagId },
    orderBy: ['position', 'asc'],
  })
  return rows.map(toVariant)
}

export async function findVariant(db: AppDatabase, id: number): Promise<FlagVariant | null> {
  let row = await db.find(flagVariants, id)
  return row ? toVariant(row) : null
}

export async function createVariant(
  db: AppDatabase,
  flagId: number,
  input: { key: string; name: string; weight: number; config: string },
): Promise<FlagVariant> {
  let existing = await db.findMany(flagVariants, { where: { flag_id: flagId } })
  let position = existing.reduce((max, row) => Math.max(max, row.position + 1), 0)
  let now = Date.now()
  let created = await db.create(
    flagVariants,
    {
      flag_id: flagId,
      key: input.key,
      name: input.name,
      weight: input.weight,
      config: input.config,
      position,
      created_at: now,
      updated_at: now,
    },
    { returnRow: true },
  )
  return toVariant(created)
}

export async function updateVariant(
  db: AppDatabase,
  id: number,
  input: { name: string; weight: number; config: string },
): Promise<FlagVariant> {
  let updated = await db.update(flagVariants, id, {
    name: input.name,
    weight: input.weight,
    config: input.config,
    updated_at: Date.now(),
  })
  return toVariant(updated)
}

// Delete a variant, first NULL-clearing any flag default pointer aimed at it
// (rawSql). The FK cascade removes rules targeting the variant.
export async function deleteVariant(db: AppDatabase, id: number): Promise<void> {
  let variant = await db.find(flagVariants, id)
  if (!variant) return
  let flag = await db.find(flags, variant.flag_id)
  if (flag && (flag.off_variant_id === id || flag.fallthrough_variant_id === id)) {
    let sets: string[] = []
    if (flag.off_variant_id === id) sets.push('off_variant_id = null')
    if (flag.fallthrough_variant_id === id) sets.push('fallthrough_variant_id = null')
    await db.exec(
      rawSql(`update flags set ${sets.join(', ')}, updated_at = ? where id = ?`, [
        Date.now(),
        flag.id,
      ]),
    )
  }
  await db.delete(flagVariants, id)
}

// Bulk-set every variant's weight in one transaction, so an experiment's split
// is saved atomically (the sum is validated by the controller first).
export async function setVariantWeights(
  db: AppDatabase,
  flagId: number,
  weights: Array<{ id: number; weight: number }>,
): Promise<void> {
  let owned = new Set((await db.findMany(flagVariants, { where: { flag_id: flagId } })).map((r) => r.id))
  let now = Date.now()
  await db.transaction(async (tx) => {
    for (let { id, weight } of weights) {
      if (owned.has(id)) await tx.update(flagVariants, id, { weight, updated_at: now })
    }
  })
}

// ----- Rules -----

export async function listRules(db: AppDatabase, flagId: number): Promise<FlagRule[]> {
  let rows = await db.findMany(flagRules, {
    where: { flag_id: flagId },
    orderBy: ['position', 'asc'],
  })
  return rows.map(toRule)
}

export async function createRule(
  db: AppDatabase,
  flagId: number,
  input: { variantId: number; attribute: string; operator: RuleOperator; value: string },
): Promise<FlagRule> {
  let existing = await db.findMany(flagRules, { where: { flag_id: flagId } })
  let position = existing.reduce((max, row) => Math.max(max, row.position + 1), 0)
  let now = Date.now()
  let created = await db.create(
    flagRules,
    {
      flag_id: flagId,
      variant_id: input.variantId,
      attribute: input.attribute,
      operator: input.operator,
      value: input.value,
      position,
      created_at: now,
      updated_at: now,
    },
    { returnRow: true },
  )
  return toRule(created)
}

export async function deleteRule(db: AppDatabase, id: number): Promise<void> {
  await db.delete(flagRules, id)
}

// ----- Evaluation -----

export interface FlagBundle {
  flag: Flag
  variants: FlagVariant[]
  rules: FlagRule[]
}

export async function loadFlagBundle(db: AppDatabase, flagId: number): Promise<FlagBundle | null> {
  let flag = await findFlag(db, flagId)
  if (!flag) return null
  return { flag, variants: await listVariants(db, flagId), rules: await listRules(db, flagId) }
}

export interface EvalContext {
  userKey: string
  attributes: Record<string, string>
  now: number
}

// Turn DB shapes into the pure decision inputs, decide, then resolve the chosen
// variant's config as the served value.
function evaluateBundle(bundle: FlagBundle, ctx: EvalContext): FlagEvaluation {
  let { flag, variants, rules } = bundle
  let keyById = new Map(variants.map((v) => [v.id, v.key]))

  let decisionFlag: DecisionFlag = {
    key: flag.key,
    kind: flag.kind,
    enabled: flag.enabled,
    startAt: flag.startAt,
    endAt: flag.endAt,
    offVariantKey: flag.offVariantId != null ? keyById.get(flag.offVariantId) ?? null : null,
    fallthroughVariantKey:
      flag.fallthroughVariantId != null ? keyById.get(flag.fallthroughVariantId) ?? null : null,
  }
  let weighted: WeightedVariant[] = variants.map((v) => ({
    key: v.key,
    weight: v.weight,
    position: v.position,
    id: v.id,
  }))
  let evalRules: EvalRule[] = rules.map((r) => ({
    attribute: r.attribute,
    operator: r.operator,
    value: r.value,
    variantKey: keyById.get(r.variantId) ?? '',
    position: r.position,
    id: r.id,
  }))

  let decision = decide(decisionFlag, weighted, evalRules, ctx)
  let chosen = decision.variantKey ? variants.find((v) => v.key === decision.variantKey) : undefined
  return {
    key: flag.key,
    kind: flag.kind,
    enabled: flag.enabled,
    variant: decision.variantKey,
    value: chosen ? chosen.config : null,
    reason: decision.reason,
  }
}

export async function evaluateFlagForUser(
  db: AppDatabase,
  flag: Flag,
  ctx: EvalContext,
): Promise<FlagEvaluation> {
  let bundle: FlagBundle = {
    flag,
    variants: await listVariants(db, flag.id),
    rules: await listRules(db, flag.id),
  }
  return evaluateBundle(bundle, ctx)
}

export async function evaluateAllFlags(
  db: AppDatabase,
  ctx: EvalContext,
): Promise<FlagEvaluation[]> {
  let all = await listFlags(db)
  let results: FlagEvaluation[] = []
  for (let flag of all) {
    results.push(await evaluateFlagForUser(db, flag, ctx))
  }
  return results
}

// ----- Scheduling -----

// Advance flag lifecycle across schedule boundaries, once each. Mirrors
// runDueReleases: automatic transitions are audited as the actor 'system'.
// Called from runScheduledWork (60s timer + lazily before public API reads).
export async function runDueFlagTransitions(
  db: AppDatabase,
  now: number = Date.now(),
): Promise<{ started: Flag[]; ended: Flag[] }> {
  let started: Flag[] = []
  let ended: Flag[] = []
  let rows = await db.findMany(flags, { orderBy: ['created_at', 'asc'] })

  for (let row of rows) {
    let flag = toFlag(row)
    if (flag.lifecycleState === 'ended') continue

    if (flag.endAt != null && flag.endAt <= now) {
      await db.update(flags, flag.id, { lifecycle_state: 'ended', updated_at: now })
      await logAudit(db, 'system', 'flag.ended', 'flag', flag.id, `Flag "${flag.key}" ended on schedule`)
      ended.push({ ...flag, lifecycleState: 'ended' })
      continue
    }

    if (flag.lifecycleState === 'scheduled' && (flag.startAt == null || flag.startAt <= now)) {
      await db.update(flags, flag.id, { lifecycle_state: 'active', updated_at: now })
      await logAudit(db, 'system', 'flag.started', 'flag', flag.id, `Flag "${flag.key}" started on schedule`)
      started.push({ ...flag, lifecycleState: 'active' })
    }
  }

  return { started, ended }
}
