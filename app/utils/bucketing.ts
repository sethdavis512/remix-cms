// Pure feature-flag evaluation: deterministic bucketing, targeting-rule
// matching, and the decision function. No DB or framework imports so it is
// trivially unit-testable. The data layer (app/data/flags.server.ts) loads a
// flag's variants + rules and calls decide().

import { createHash } from 'node:crypto'

// A user is assigned to a stable bucket 0..99 from the flag key and their user
// key. Deterministic, so the same (flag, user) always lands in the same bucket
// — that is what gives sticky assignment without persisting anything. Keying by
// flag means a user is not correlated to the same slot across different flags.
export function hashBucket(flagKey: string, userKey: string): number {
  let hex = createHash('sha1').update(`${flagKey}:${userKey}`).digest('hex')
  // Top 32 bits are plenty of entropy for a 0..99 split; the modulo bias is
  // negligible at this scale.
  return parseInt(hex.slice(0, 8), 16) % 100
}

export interface WeightedVariant {
  key: string
  weight: number
  position: number
  id: number
}

// Pick a variant by walking cumulative weights against the user's bucket.
// Weights need not sum to 100 — the bucket is scaled to the actual total — but
// the admin UI enforces a sum of 100 for experiments. Returns null when there
// are no variants or every weight is zero.
export function pickVariant<T extends WeightedVariant>(
  flagKey: string,
  userKey: string,
  variants: T[],
): T | null {
  let ordered = [...variants].sort((a, b) => a.position - b.position || a.id - b.id)
  let total = ordered.reduce((sum, v) => sum + Math.max(0, v.weight), 0)
  if (total <= 0) return null

  // Scale the 0..99 bucket into 0..total so any weight total works.
  let point = (hashBucket(flagKey, userKey) / 100) * total
  let cumulative = 0
  for (let variant of ordered) {
    cumulative += Math.max(0, variant.weight)
    if (point < cumulative) return variant
  }
  return ordered[ordered.length - 1] ?? null
}

export interface EvalRule {
  attribute: string
  operator: 'equals' | 'in'
  value: string
  variantKey: string
  position: number
  id: number
}

// Parse a rule's stored value into a list: a JSON array if it parses as one,
// otherwise a comma-separated fallback.
function parseList(value: string): string[] {
  try {
    let parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map((v) => String(v))
  } catch {
    // fall through to comma-splitting
  }
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
}

// Does a single targeting rule match the caller's attributes? A missing
// attribute never matches.
export function ruleMatches(
  rule: Pick<EvalRule, 'attribute' | 'operator' | 'value'>,
  attributes: Record<string, string>,
): boolean {
  let actual = attributes[rule.attribute]
  if (actual === undefined) return false
  if (rule.operator === 'in') return parseList(rule.value).includes(actual)
  return actual === rule.value
}

export interface DecisionFlag {
  key: string
  kind: 'boolean' | 'experiment'
  enabled: boolean
  startAt: number | null
  endAt: number | null
  offVariantKey: string | null
  fallthroughVariantKey: string | null
}

export type DecisionReason =
  | 'disabled'
  | 'out_of_window'
  | 'rule_match'
  | 'fallthrough'
  | 'bucket'
  | 'no_variants'

export interface Decision {
  variantKey: string | null
  reason: DecisionReason
}

// The evaluation precedence, resolved to a variant key (or null when the flag
// has no usable variant):
//   1. flag disabled                       -> off variant
//   2. now outside [startAt, endAt] window  -> off variant
//   3. first matching targeting rule        -> that rule's variant
//   4. boolean flag                         -> fallthrough (the "on") variant
//      experiment flag                      -> weighted bucketing
//   5. nothing resolved                     -> null
export function decide(
  flag: DecisionFlag,
  variants: WeightedVariant[],
  rules: EvalRule[],
  ctx: { userKey: string; attributes: Record<string, string>; now: number },
): Decision {
  if (!flag.enabled) return offOr(flag, variants, 'disabled')

  let started = flag.startAt == null || flag.startAt <= ctx.now
  let notEnded = flag.endAt == null || ctx.now < flag.endAt
  if (!started || !notEnded) return offOr(flag, variants, 'out_of_window')

  for (let rule of [...rules].sort((a, b) => a.position - b.position || a.id - b.id)) {
    if (ruleMatches(rule, ctx.attributes) && hasVariant(variants, rule.variantKey)) {
      return { variantKey: rule.variantKey, reason: 'rule_match' }
    }
  }

  if (flag.kind === 'boolean') {
    if (flag.fallthroughVariantKey && hasVariant(variants, flag.fallthroughVariantKey)) {
      return { variantKey: flag.fallthroughVariantKey, reason: 'fallthrough' }
    }
    return { variantKey: null, reason: 'no_variants' }
  }

  let picked = pickVariant(flag.key, ctx.userKey, variants)
  if (picked) return { variantKey: picked.key, reason: 'bucket' }
  return { variantKey: null, reason: 'no_variants' }
}

function hasVariant(variants: WeightedVariant[], key: string): boolean {
  return variants.some((v) => v.key === key)
}

// Resolve to the off variant when one is set and present, else report there is
// nothing to serve.
function offOr(flag: DecisionFlag, variants: WeightedVariant[], reason: DecisionReason): Decision {
  if (flag.offVariantKey && hasVariant(variants, flag.offVariantKey)) {
    return { variantKey: flag.offVariantKey, reason }
  }
  return { variantKey: null, reason }
}
