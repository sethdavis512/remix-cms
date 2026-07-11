import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  hashBucket,
  pickVariant,
  ruleMatches,
  decide,
  type WeightedVariant,
  type EvalRule,
  type DecisionFlag,
} from './bucketing.ts'

function variant(key: string, weight: number, i: number): WeightedVariant {
  return { key, weight, position: i, id: i + 1 }
}

describe('hashBucket', () => {
  it('is deterministic for the same (flag, user)', () => {
    assert.equal(hashBucket('flag', 'user-1'), hashBucket('flag', 'user-1'))
  })

  it('always returns an integer in [0, 99]', () => {
    for (let i = 0; i < 500; i++) {
      let b = hashBucket('exp', `user-${i}`)
      assert.ok(Number.isInteger(b) && b >= 0 && b <= 99, `bucket out of range: ${b}`)
    }
  })

  it('namespaces by flag key (same user differs across flags for most keys)', () => {
    let differ = 0
    for (let i = 0; i < 50; i++) {
      if (hashBucket('flag-a', `u${i}`) !== hashBucket('flag-b', `u${i}`)) differ++
    }
    assert.ok(differ > 25, 'expected most users to bucket differently across flags')
  })
})

describe('pickVariant', () => {
  let variants = [variant('a', 50, 0), variant('b', 30, 1), variant('c', 20, 2)]

  it('maps buckets to variants by cumulative weight', () => {
    // 50/30/20 -> thresholds 50/80/100. Verify the split holds across many users.
    let counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    for (let i = 0; i < 5000; i++) {
      let v = pickVariant('exp', `user-${i}`, variants)
      counts[v!.key]++
    }
    // Roughly track the weights (loose bounds to avoid flakiness).
    assert.ok(counts.a > 2200 && counts.a < 2800, `a=${counts.a}`)
    assert.ok(counts.b > 1200 && counts.b < 1800, `b=${counts.b}`)
    assert.ok(counts.c > 700 && counts.c < 1300, `c=${counts.c}`)
  })

  it('is sticky: same user always gets the same variant', () => {
    let first = pickVariant('exp', 'stable-user', variants)!.key
    for (let i = 0; i < 20; i++) {
      assert.equal(pickVariant('exp', 'stable-user', variants)!.key, first)
    }
  })

  it('handles a single 100% variant', () => {
    let only = [variant('on', 100, 0), variant('off', 0, 1)]
    for (let i = 0; i < 100; i++) {
      assert.equal(pickVariant('exp', `u${i}`, only)!.key, 'on')
    }
  })

  it('returns null for no variants or all-zero weights', () => {
    assert.equal(pickVariant('exp', 'u', []), null)
    assert.equal(pickVariant('exp', 'u', [variant('a', 0, 0), variant('b', 0, 1)]), null)
  })
})

describe('ruleMatches', () => {
  it('equals compares the attribute strictly', () => {
    assert.equal(ruleMatches({ attribute: 'country', operator: 'equals', value: 'US' }, { country: 'US' }), true)
    assert.equal(ruleMatches({ attribute: 'country', operator: 'equals', value: 'US' }, { country: 'CA' }), false)
  })

  it('in checks membership of a JSON array (or comma list)', () => {
    assert.equal(ruleMatches({ attribute: 'plan', operator: 'in', value: '["pro","team"]' }, { plan: 'team' }), true)
    assert.equal(ruleMatches({ attribute: 'plan', operator: 'in', value: 'pro, team' }, { plan: 'free' }), false)
  })

  it('a missing attribute never matches', () => {
    assert.equal(ruleMatches({ attribute: 'country', operator: 'equals', value: 'US' }, {}), false)
  })
})

describe('decide', () => {
  let variants = [variant('control', 50, 0), variant('treatment', 50, 1)]
  let baseFlag: DecisionFlag = {
    key: 'checkout',
    kind: 'experiment',
    enabled: true,
    startAt: null,
    endAt: null,
    offVariantKey: 'control',
    fallthroughVariantKey: 'treatment',
  }
  let ctx = { userKey: 'u1', attributes: {}, now: 1_000 }

  it('returns the off variant with reason disabled when the flag is off', () => {
    let d = decide({ ...baseFlag, enabled: false }, variants, [], ctx)
    assert.deepEqual(d, { variantKey: 'control', reason: 'disabled' })
  })

  it('returns the off variant when outside the schedule window', () => {
    assert.equal(decide({ ...baseFlag, startAt: 5_000 }, variants, [], ctx).reason, 'out_of_window')
    assert.equal(decide({ ...baseFlag, endAt: 500 }, variants, [], ctx).reason, 'out_of_window')
  })

  it('honours a matching targeting rule first', () => {
    let rules: EvalRule[] = [
      { attribute: 'country', operator: 'equals', value: 'US', variantKey: 'treatment', position: 0, id: 1 },
    ]
    let d = decide(baseFlag, variants, rules, { ...ctx, attributes: { country: 'US' } })
    assert.deepEqual(d, { variantKey: 'treatment', reason: 'rule_match' })
  })

  it('buckets an experiment when no rule matches', () => {
    let d = decide(baseFlag, variants, [], ctx)
    assert.equal(d.reason, 'bucket')
    assert.ok(d.variantKey === 'control' || d.variantKey === 'treatment')
  })

  it('serves the fallthrough variant for a boolean flag', () => {
    let d = decide({ ...baseFlag, kind: 'boolean' }, variants, [], ctx)
    assert.deepEqual(d, { variantKey: 'treatment', reason: 'fallthrough' })
  })

  it('reports no_variants when the flag has none', () => {
    let d = decide({ ...baseFlag, offVariantKey: null, fallthroughVariantKey: null }, [], [], ctx)
    assert.deepEqual(d, { variantKey: null, reason: 'no_variants' })
  })
})
