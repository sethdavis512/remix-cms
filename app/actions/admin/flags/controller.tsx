import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { AppDatabase } from '../../../data/db.ts'

import { Auth, requireAdmin, type AuthUser } from '../../../middleware/auth.ts'
import { listContentTypes, type ContentType } from '../../../data/content-types.server.ts'
import {
  createFlag,
  createRule,
  createVariant,
  deleteFlag,
  deleteRule,
  deleteVariant,
  findFlag,
  findFlagByKey,
  listFlags,
  loadFlagBundle,
  setFlagDefaults,
  setFlagEnabled,
  setVariantWeights,
  updateFlag,
  updateVariant,
  type Flag,
  type FlagKind,
  type FlagRule,
  type FlagVariant,
  type RuleOperator,
} from '../../../data/flags.server.ts'
import { logAudit } from '../../../data/audit.server.ts'
import { runScheduledWork } from '../../../data/scheduler.server.ts'
import { slugify } from '../../../utils/fields.ts'
import { formatWhen, parseScheduledAt, toDatetimeLocal } from '../../../utils/schedule.ts'
import { routes } from '../../../routes.ts'
import {
  AdminShell,
  cardStyle,
  dangerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../../ui/admin-shell.tsx'
import { Pagination } from '../../../ui/pagination.tsx'
import { paginateList, pageHref } from '../../../utils/pagination.ts'

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

function notFound() {
  return new Response('Not Found', { status: 404 })
}

function actorEmail(context: { get: (key: typeof Auth) => unknown }): string {
  return currentUser(context)?.email ?? 'system'
}

function flashOf(context: { get: (key: typeof Session) => unknown }): string | null {
  let session = context.get(Session) as { get: (k: string) => unknown } | undefined
  let value = session?.get('message')
  return typeof value === 'string' ? value : null
}

// The rendering context renderFlag needs, pulled from a controller context.
function viewOf(context: {
  render: (node: RemixNode, opts?: { status?: number }) => Response
  url: URL
  get: (key: typeof Auth) => unknown
}): { render: (node: RemixNode, opts?: { status?: number }) => Response; user?: AuthUser; origin: string } {
  return { render: context.render, user: currentUser(context), origin: context.url.origin }
}

// Sum an experiment's variant weights.
function weightSum(variants: FlagVariant[]): number {
  return variants.reduce((sum, v) => sum + v.weight, 0)
}

// Re-render the flag detail page (used for the show action and for validation
// failures on its sub-forms). Returns 404 if the flag is gone. Takes the pieces
// it needs rather than the whole request context so it stays framework-typed.
async function renderFlag(
  db: AppDatabase,
  flagId: number,
  view: {
    render: (node: RemixNode, opts?: { status?: number }) => Response
    user?: AuthUser
    origin: string
    flash?: string | null
    error?: string
    status?: number
  },
): Promise<Response> {
  let bundle = await loadFlagBundle(db, flagId)
  if (!bundle) return notFound()
  return view.render(
    <FlagShowPage
      flag={bundle.flag}
      variants={bundle.variants}
      rules={bundle.rules}
      contentTypes={await listContentTypes(db)}
      user={view.user}
      flash={view.error ? null : view.flash ?? null}
      error={view.error}
      origin={view.origin}
    />,
    view.status ? { status: view.status } : undefined,
  )
}

export default createController(routes.admin.flags, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let flash = session.get('message')
      let { pagination, items } = paginateList(
        await listFlags(db),
        context.url.searchParams.get('page'),
      )
      return context.render(
        <FlagsIndexPage
          flags={items}
          contentTypes={await listContentTypes(db)}
          user={currentUser(context)}
          flash={typeof flash === 'string' ? flash : null}
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
        />,
      )
    },

    async create(context) {
      let db = context.get(Database)!
      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim()
      let rawKey = String(formData.get('key') ?? '').trim()
      let key = slugify(rawKey || name)
      let kind: FlagKind = String(formData.get('kind') ?? 'boolean') === 'experiment' ? 'experiment' : 'boolean'

      let error: string | null = null
      if (name === '') {
        error = 'A flag needs a name.'
      } else if (key === '') {
        error = 'A flag needs a key (letters, numbers, and dashes).'
      } else if (await findFlagByKey(db, key)) {
        error = `The flag key "${key}" is already in use.`
      }

      if (error) {
        let { pagination, items } = paginateList(
          await listFlags(db),
          context.url.searchParams.get('page'),
        )
        return context.render(
          <FlagsIndexPage
            flags={items}
            contentTypes={await listContentTypes(db)}
            user={currentUser(context)}
            error={error}
            nameValue={name}
            keyValue={rawKey}
            kindValue={kind}
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
          />,
          { status: 400 },
        )
      }

      let flag = await createFlag(db, { key, name, description: '', kind, startAt: null, endAt: null })
      await logAudit(db, actorEmail(context), 'flag.created', 'flag', flag.id, `Created ${kind} flag "${flag.key}"`)
      context.get(Session)!.flash('message', `Flag "${flag.key}" created.`)
      return redirect(routes.admin.flags.show.href({ flagId: String(flag.id) }), 303)
    },

    async show(context) {
      let db = context.get(Database)!
      // Fire anything due so the admin sees the true lifecycle state.
      await runScheduledWork(db)
      let id = Number(context.params.flagId)
      if (!Number.isInteger(id)) return notFound()
      return renderFlag(db, id, { ...viewOf(context), flash: flashOf(context) })
    },

    async update(context) {
      let db = context.get(Database)!
      let id = Number(context.params.flagId)
      let flag = Number.isInteger(id) ? await findFlag(db, id) : null
      if (!flag) return notFound()

      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim() || flag.name
      let description = String(formData.get('description') ?? '').trim()
      let startAt = parseScheduledAt(String(formData.get('start_at') ?? ''))
      let endAt = parseScheduledAt(String(formData.get('end_at') ?? ''))

      if (startAt != null && endAt != null && startAt >= endAt) {
        return renderFlag(db, id, { ...viewOf(context), error: 'The start time must be before the end time.', status: 400 })
      }

      await updateFlag(db, id, { name, description, startAt, endAt })
      await logAudit(db, actorEmail(context), 'flag.updated', 'flag', id, `Updated flag "${flag.key}"`)
      context.get(Session)!.flash('message', 'Flag saved.')
      return redirect(routes.admin.flags.show.href({ flagId: String(id) }), 303)
    },

    async destroy(context) {
      let db = context.get(Database)!
      let id = Number(context.params.flagId)
      let flag = Number.isInteger(id) ? await findFlag(db, id) : null
      if (flag) {
        await deleteFlag(db, id)
        await logAudit(db, actorEmail(context), 'flag.deleted', 'flag', id, `Deleted flag "${flag.key}"`)
        context.get(Session)!.flash('message', `Flag "${flag.key}" deleted.`)
      }
      return redirect(routes.admin.flags.index.href(), 303)
    },

    async toggle(context) {
      let db = context.get(Database)!
      let id = Number(context.params.flagId)
      let bundle = Number.isInteger(id) ? await loadFlagBundle(db, id) : null
      if (!bundle) return notFound()
      let { flag, variants } = bundle

      // Guard turning a flag on: it must be servable.
      if (!flag.enabled) {
        if (variants.length === 0) {
          return renderFlag(db, id, { ...viewOf(context), error: 'Add at least one variant before enabling this flag.', status: 400 })
        }
        if (flag.kind === 'experiment' && weightSum(variants) !== 100) {
          return renderFlag(db, id, { ...viewOf(context), error: 'Variant weights must sum to 100 before enabling an experiment.', status: 400 })
        }
      }

      let updated = await setFlagEnabled(db, id, !flag.enabled)
      await logAudit(
        db,
        actorEmail(context),
        updated.enabled ? 'flag.enabled' : 'flag.disabled',
        'flag',
        id,
        `${updated.enabled ? 'Enabled' : 'Disabled'} flag "${flag.key}"`,
      )
      context.get(Session)!.flash('message', `Flag "${flag.key}" ${updated.enabled ? 'enabled' : 'disabled'}.`)
      return redirect(routes.admin.flags.show.href({ flagId: String(id) }), 303)
    },

    async setDefaults(context) {
      let db = context.get(Database)!
      let id = Number(context.params.flagId)
      let bundle = Number.isInteger(id) ? await loadFlagBundle(db, id) : null
      if (!bundle) return notFound()

      let formData = context.get(FormData)!
      let ids = new Set(bundle.variants.map((v) => v.id))
      let parsePointer = (name: string): number | null => {
        let raw = String(formData.get(name) ?? '').trim()
        if (raw === '') return null
        let n = Number(raw)
        return Number.isInteger(n) && ids.has(n) ? n : null
      }
      let offVariantId = parsePointer('off_variant_id')
      let fallthroughVariantId = parsePointer('fallthrough_variant_id')

      await setFlagDefaults(db, id, { offVariantId, fallthroughVariantId })
      await logAudit(db, actorEmail(context), 'flag.defaults_set', 'flag', id, `Updated default variants for "${bundle.flag.key}"`)
      context.get(Session)!.flash('message', 'Default variants updated.')
      return redirect(routes.admin.flags.show.href({ flagId: String(id) }), 303)
    },

    async setWeights(context) {
      let db = context.get(Database)!
      let id = Number(context.params.flagId)
      let bundle = Number.isInteger(id) ? await loadFlagBundle(db, id) : null
      if (!bundle) return notFound()

      let formData = context.get(FormData)!
      let variantIds = formData.getAll('variant_id').map((v) => Number(v))
      let rawWeights = formData.getAll('weight').map((v) => Number(v))

      let weights: Array<{ id: number; weight: number }> = []
      for (let i = 0; i < variantIds.length; i++) {
        let weight = rawWeights[i] ?? NaN
        if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
          return renderFlag(db, id, { ...viewOf(context), error: 'Each weight must be a whole number between 0 and 100.', status: 400 })
        }
        weights.push({ id: variantIds[i]!, weight })
      }
      if (weights.reduce((sum, w) => sum + w.weight, 0) !== 100) {
        return renderFlag(db, id, { ...viewOf(context), error: 'Variant weights must sum to exactly 100.', status: 400 })
      }

      await setVariantWeights(db, id, weights)
      await logAudit(db, actorEmail(context), 'flag.weights_set', 'flag', id, `Updated traffic split for "${bundle.flag.key}"`)
      context.get(Session)!.flash('message', 'Traffic split saved.')
      return redirect(routes.admin.flags.show.href({ flagId: String(id) }), 303)
    },

    async addVariant(context) {
      let db = context.get(Database)!
      let id = Number(context.params.flagId)
      let bundle = Number.isInteger(id) ? await loadFlagBundle(db, id) : null
      if (!bundle) return notFound()

      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim()
      let key = slugify(String(formData.get('key') ?? '').trim() || name)
      let rawWeight = Number(String(formData.get('weight') ?? '0') || '0')
      let rawConfig = String(formData.get('config') ?? '').trim() || '{}'

      let error: string | null = null
      let config = '{}'
      if (name === '') {
        error = 'A variant needs a name.'
      } else if (key === '') {
        error = 'A variant needs a key.'
      } else if (bundle.variants.some((v) => v.key === key)) {
        error = `This flag already has a variant "${key}".`
      } else if (!Number.isInteger(rawWeight) || rawWeight < 0 || rawWeight > 100) {
        error = 'Weight must be a whole number between 0 and 100.'
      } else {
        try {
          config = JSON.stringify(JSON.parse(rawConfig))
        } catch {
          error = 'Config must be valid JSON.'
        }
      }
      if (error) return renderFlag(db, id, { ...viewOf(context), error, status: 400 })

      let variant = await createVariant(db, id, { key, name, weight: rawWeight, config })
      await logAudit(db, actorEmail(context), 'flag.variant_added', 'flag', id, `Added variant "${variant.key}" to "${bundle.flag.key}"`)
      context.get(Session)!.flash('message', `Variant "${variant.key}" added.`)
      return redirect(routes.admin.flags.show.href({ flagId: String(id) }), 303)
    },

    async updateVariant(context) {
      let db = context.get(Database)!
      let id = Number(context.params.flagId)
      let variantId = Number(context.params.variantId)
      let bundle = Number.isInteger(id) ? await loadFlagBundle(db, id) : null
      let variant = bundle?.variants.find((v) => v.id === variantId)
      if (!bundle || !variant) return notFound()

      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim() || variant.name
      let rawWeight = Number(String(formData.get('weight') ?? '0') || '0')
      let rawConfig = String(formData.get('config') ?? '').trim() || '{}'

      let error: string | null = null
      let config = '{}'
      if (!Number.isInteger(rawWeight) || rawWeight < 0 || rawWeight > 100) {
        error = 'Weight must be a whole number between 0 and 100.'
      } else {
        try {
          config = JSON.stringify(JSON.parse(rawConfig))
        } catch {
          error = 'Config must be valid JSON.'
        }
      }
      if (error) return renderFlag(db, id, { ...viewOf(context), error, status: 400 })

      await updateVariant(db, variantId, { name, weight: rawWeight, config })
      await logAudit(db, actorEmail(context), 'flag.variant_updated', 'flag', id, `Updated variant "${variant.key}" of "${bundle.flag.key}"`)
      context.get(Session)!.flash('message', `Variant "${variant.key}" saved.`)
      return redirect(routes.admin.flags.show.href({ flagId: String(id) }), 303)
    },

    async removeVariant(context) {
      let db = context.get(Database)!
      let id = Number(context.params.flagId)
      let variantId = Number(context.params.variantId)
      let bundle = Number.isInteger(id) ? await loadFlagBundle(db, id) : null
      let variant = bundle?.variants.find((v) => v.id === variantId)
      if (!bundle || !variant) return notFound()

      if (bundle.variants.length <= 2) {
        return renderFlag(db, id, { ...viewOf(context), error: 'A flag needs at least two variants; add another before removing this one.', status: 400 })
      }

      await deleteVariant(db, variantId)
      await logAudit(db, actorEmail(context), 'flag.variant_removed', 'flag', id, `Removed variant "${variant.key}" from "${bundle.flag.key}"`)
      context.get(Session)!.flash('message', `Variant "${variant.key}" removed.`)
      return redirect(routes.admin.flags.show.href({ flagId: String(id) }), 303)
    },

    async addRule(context) {
      let db = context.get(Database)!
      let id = Number(context.params.flagId)
      let bundle = Number.isInteger(id) ? await loadFlagBundle(db, id) : null
      if (!bundle) return notFound()

      let formData = context.get(FormData)!
      let attribute = String(formData.get('attribute') ?? '').trim()
      let operator: RuleOperator = String(formData.get('operator') ?? 'equals') === 'in' ? 'in' : 'equals'
      let value = String(formData.get('value') ?? '').trim()
      let variantId = Number(formData.get('variant_id'))

      let error: string | null = null
      if (attribute === '') {
        error = 'A rule needs an attribute name.'
      } else if (value === '') {
        error = 'A rule needs a value to match.'
      } else if (!bundle.variants.some((v) => v.id === variantId)) {
        error = 'Pick a variant to serve when the rule matches.'
      }
      if (error) return renderFlag(db, id, { ...viewOf(context), error, status: 400 })

      let storedValue = operator === 'in'
        ? JSON.stringify(value.split(',').map((v) => v.trim()).filter(Boolean))
        : value
      await createRule(db, id, { variantId, attribute, operator, value: storedValue })
      await logAudit(db, actorEmail(context), 'flag.rule_added', 'flag', id, `Added targeting rule on "${attribute}" to "${bundle.flag.key}"`)
      context.get(Session)!.flash('message', 'Targeting rule added.')
      return redirect(routes.admin.flags.show.href({ flagId: String(id) }), 303)
    },

    async removeRule(context) {
      let db = context.get(Database)!
      let id = Number(context.params.flagId)
      let ruleId = Number(context.params.ruleId)
      let bundle = Number.isInteger(id) ? await loadFlagBundle(db, id) : null
      if (!bundle) return notFound()
      if (Number.isInteger(ruleId) && bundle.rules.some((r) => r.id === ruleId)) {
        await deleteRule(db, ruleId)
        await logAudit(db, actorEmail(context), 'flag.rule_removed', 'flag', id, `Removed a targeting rule from "${bundle.flag.key}"`)
        context.get(Session)!.flash('message', 'Targeting rule removed.')
      }
      return redirect(routes.admin.flags.show.href({ flagId: String(id) }), 303)
    },
  },
})

// ----- Pages -----

interface IndexProps {
  flags: Flag[]
  contentTypes: ContentType[]
  user?: AuthUser
  flash?: string | null
  error?: string
  nameValue?: string
  keyValue?: string
  kindValue?: FlagKind
  page: number
  totalPages: number
  total: number
}

function FlagsIndexPage(handle: Handle<IndexProps>) {
  return () => {
    let {
      flags,
      contentTypes,
      user,
      flash,
      error,
      nameValue = '',
      keyValue = '',
      kindValue = 'boolean',
      page,
      totalPages,
      total,
    } = handle.props

    return (
      <AdminShell heading="Feature Flags" activeNav="flags" contentTypes={contentTypes} user={user} flash={flash}>
        <div mix={columnStyle}>
          <div mix={cardStyle}>
            {flags.length === 0 ? (
              <p mix={mutedStyle}>No flags yet. Create one below.</p>
            ) : (
              <table mix={tableStyle}>
                <thead>
                  <tr>
                    <th mix={thStyle}>Name</th>
                    <th mix={thStyle}>Key</th>
                    <th mix={thStyle}>Kind</th>
                    <th mix={thStyle}>State</th>
                    <th mix={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {flags.map((flag) => (
                    <tr>
                      <td mix={tdStyle}>{flag.name}</td>
                      <td mix={tdMonoStyle}>{flag.key}</td>
                      <td mix={tdStyle}>{flag.kind}</td>
                      <td mix={tdStyle}>
                        <span mix={flag.enabled ? badgeOnStyle : badgeOffStyle}>
                          {flag.enabled ? 'On' : 'Off'}
                        </span>{' '}
                        <span mix={mutedStyle}>{flag.lifecycleState}</span>
                      </td>
                      <td mix={tdActionsStyle}>
                        <a href={routes.admin.flags.show.href({ flagId: String(flag.id) })} mix={secondaryButtonStyle}>
                          Manage
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            noun="flag"
            prevHref={pageHref(routes.admin.flags.index.href(), page - 1, totalPages)}
            nextHref={pageHref(routes.admin.flags.index.href(), page + 1, totalPages)}
          />

          <div mix={cardStyle}>
            <h2 mix={cardHeadingStyle}>New flag</h2>
            {error ? <p mix={errorStyle}>{error}</p> : null}
            <form method="POST" action={routes.admin.flags.create.href()} mix={formStyle}>
              <label mix={labelStyle}>
                <span>Name</span>
                <input type="text" name="name" value={nameValue} placeholder="New checkout" mix={controlStyle} />
              </label>
              <label mix={labelStyle}>
                <span>Key (optional — defaults from the name)</span>
                <input type="text" name="key" value={keyValue} placeholder="new-checkout" mix={controlStyle} />
              </label>
              <label mix={labelStyle}>
                <span>Kind</span>
                <select name="kind" mix={controlStyle}>
                  <option value="boolean" selected={kindValue === 'boolean'}>
                    Boolean (on/off with targeting)
                  </option>
                  <option value="experiment" selected={kindValue === 'experiment'}>
                    Experiment (weighted A/B split)
                  </option>
                </select>
              </label>
              <div>
                <button type="submit" mix={primaryButtonStyle}>
                  Create flag
                </button>
              </div>
            </form>
          </div>
        </div>
      </AdminShell>
    )
  }
}

interface ShowProps {
  flag: Flag
  variants: FlagVariant[]
  rules: FlagRule[]
  contentTypes: ContentType[]
  user?: AuthUser
  flash?: string | null
  error?: string
  origin: string
}

function FlagShowPage(handle: Handle<ShowProps>) {
  return () => {
    let { flag, variants, rules, contentTypes, user, flash, error, origin } = handle.props
    let isExperiment = flag.kind === 'experiment'
    let total = weightSum(variants)
    let curl = `curl -s "${origin}${routes.api.flags.evaluateOne.href({ key: flag.key })}?user=USER_ID"`

    return (
      <AdminShell
        heading={flag.name}
        activeNav="flags"
        contentTypes={contentTypes}
        user={user}
        flash={flash}
        actions={
          <a href={routes.admin.flags.index.href()} mix={secondaryButtonStyle}>
            All flags
          </a>
        }
      >
        <div mix={columnStyle}>
          {error ? <div mix={errorBannerStyle}>{error}</div> : null}

          {/* Settings + kill switch */}
          <div mix={cardStyle}>
            <div mix={rowBetweenStyle}>
              <div>
                <span mix={flag.enabled ? badgeOnStyle : badgeOffStyle}>{flag.enabled ? 'On' : 'Off'}</span>{' '}
                <span mix={mutedStyle}>
                  {flag.kind} · {flag.lifecycleState} · key <code mix={inlineCodeStyle}>{flag.key}</code>
                </span>
              </div>
              <form method="POST" action={routes.admin.flags.toggle.href({ flagId: String(flag.id) })}>
                <button type="submit" mix={flag.enabled ? dangerButtonStyle : primaryButtonStyle}>
                  {flag.enabled ? 'Disable' : 'Enable'}
                </button>
              </form>
            </div>

            <form method="POST" action={routes.admin.flags.update.href({ flagId: String(flag.id) })} mix={formStyle}>
              <label mix={labelStyle}>
                <span>Name</span>
                <input type="text" name="name" value={flag.name} mix={controlStyle} />
              </label>
              <label mix={labelStyle}>
                <span>Description</span>
                <input type="text" name="description" value={flag.description} mix={controlStyle} />
              </label>
              <div mix={twoColStyle}>
                <label mix={labelStyle}>
                  <span>Starts (optional)</span>
                  <input
                    type="datetime-local"
                    name="start_at"
                    value={flag.startAt != null ? toDatetimeLocal(flag.startAt) : ''}
                    mix={controlStyle}
                  />
                </label>
                <label mix={labelStyle}>
                  <span>Ends (optional)</span>
                  <input
                    type="datetime-local"
                    name="end_at"
                    value={flag.endAt != null ? toDatetimeLocal(flag.endAt) : ''}
                    mix={controlStyle}
                  />
                </label>
              </div>
              {flag.startAt != null || flag.endAt != null ? (
                <p mix={mutedStyle}>
                  {flag.startAt != null ? `Starts ${formatWhen(flag.startAt)}. ` : ''}
                  {flag.endAt != null ? `Ends ${formatWhen(flag.endAt)}.` : ''}
                </p>
              ) : null}
              <div>
                <button type="submit" mix={primaryButtonStyle}>
                  Save settings
                </button>
              </div>
            </form>
          </div>

          {/* Variants */}
          <div mix={cardStyle}>
            <h2 mix={cardHeadingStyle}>Variants</h2>
            {variants.map((variant) => (
              <form
                method="POST"
                action={routes.admin.flags.updateVariant.href({ flagId: String(flag.id), variantId: String(variant.id) })}
                mix={variantRowStyle}
              >
                <div mix={variantHeadStyle}>
                  <code mix={inlineCodeStyle}>{variant.key}</code>
                  <input type="text" name="name" value={variant.name} mix={controlStyle} />
                  {isExperiment ? (
                    <input type="number" name="weight" value={String(variant.weight)} min="0" max="100" mix={weightInputStyle} />
                  ) : (
                    <input type="hidden" name="weight" value={String(variant.weight)} />
                  )}
                </div>
                <label mix={labelStyle}>
                  <span>Config (JSON)</span>
                  <textarea name="config" rows={3} value={JSON.stringify(variant.config, null, 2)} mix={codeAreaStyle} />
                </label>
                <div mix={variantActionsStyle}>
                  <button type="submit" mix={secondaryButtonStyle}>
                    Save variant
                  </button>
                </div>
                <div mix={variantDeleteStyle}>
                  <button
                    type="submit"
                    formAction={routes.admin.flags.removeVariant.href({ flagId: String(flag.id), variantId: String(variant.id) })}
                    mix={dangerButtonStyle}
                  >
                    Remove
                  </button>
                </div>
              </form>
            ))}

            <div mix={dividerStyle} />
            <h3 mix={subHeadingStyle}>Add a variant</h3>
            <form method="POST" action={routes.admin.flags.addVariant.href({ flagId: String(flag.id) })} mix={formStyle}>
              <div mix={twoColStyle}>
                <label mix={labelStyle}>
                  <span>Key</span>
                  <input type="text" name="key" placeholder="variant-c" mix={controlStyle} />
                </label>
                <label mix={labelStyle}>
                  <span>Name</span>
                  <input type="text" name="name" placeholder="Variant C" mix={controlStyle} />
                </label>
              </div>
              {isExperiment ? (
                <label mix={labelStyle}>
                  <span>Weight (0–100)</span>
                  <input type="number" name="weight" value="0" min="0" max="100" mix={controlStyle} />
                </label>
              ) : (
                <input type="hidden" name="weight" value="0" />
              )}
              <label mix={labelStyle}>
                <span>Config (JSON)</span>
                <textarea name="config" rows={3} placeholder="{}" mix={codeAreaStyle} />
              </label>
              <div>
                <button type="submit" mix={primaryButtonStyle}>
                  Add variant
                </button>
              </div>
            </form>

            <div mix={dividerStyle} />
            <h3 mix={subHeadingStyle}>Default variants</h3>
            <form method="POST" action={routes.admin.flags.setDefaults.href({ flagId: String(flag.id) })} mix={formStyle}>
              <div mix={twoColStyle}>
                <label mix={labelStyle}>
                  <span>Off / out-of-window variant</span>
                  <VariantSelect name="off_variant_id" variants={variants} selectedId={flag.offVariantId} />
                </label>
                <label mix={labelStyle}>
                  <span>{isExperiment ? 'Control variant' : 'On (fallthrough) variant'}</span>
                  <VariantSelect name="fallthrough_variant_id" variants={variants} selectedId={flag.fallthroughVariantId} />
                </label>
              </div>
              <div>
                <button type="submit" mix={secondaryButtonStyle}>
                  Save defaults
                </button>
              </div>
            </form>
          </div>

          {/* Traffic split (experiments only) */}
          {isExperiment ? (
            <div mix={cardStyle}>
              <h2 mix={cardHeadingStyle}>Traffic split</h2>
              <p mix={total === 100 ? mutedStyle : errorStyle}>
                Weights currently total {total}%{total === 100 ? '.' : ' — must be exactly 100% to enable.'}
              </p>
              <form method="POST" action={routes.admin.flags.setWeights.href({ flagId: String(flag.id) })} mix={formStyle}>
                {variants.map((variant) => (
                  <label mix={splitRowStyle}>
                    <input type="hidden" name="variant_id" value={String(variant.id)} />
                    <span mix={splitLabelStyle}>{variant.name}</span>
                    <input type="number" name="weight" value={String(variant.weight)} min="0" max="100" mix={weightInputStyle} />
                    <span mix={mutedStyle}>%</span>
                  </label>
                ))}
                <div>
                  <button type="submit" mix={primaryButtonStyle}>
                    Save split
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {/* Targeting rules */}
          <div mix={cardStyle}>
            <h2 mix={cardHeadingStyle}>Targeting rules</h2>
            <p mix={mutedStyle}>Rules are checked in order; the first match wins, before the split or on/off default.</p>
            {rules.length === 0 ? (
              <p mix={mutedStyle}>No rules. Every user falls through to the split or default.</p>
            ) : (
              <table mix={tableStyle}>
                <thead>
                  <tr>
                    <th mix={thStyle}>Attribute</th>
                    <th mix={thStyle}>Operator</th>
                    <th mix={thStyle}>Value</th>
                    <th mix={thStyle}>Serve</th>
                    <th mix={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr>
                      <td mix={tdMonoStyle}>{rule.attribute}</td>
                      <td mix={tdStyle}>{rule.operator}</td>
                      <td mix={tdMonoStyle}>{rule.value}</td>
                      <td mix={tdStyle}>{variants.find((v) => v.id === rule.variantId)?.key ?? '—'}</td>
                      <td mix={tdActionsStyle}>
                        <form method="POST" action={routes.admin.flags.removeRule.href({ flagId: String(flag.id), ruleId: String(rule.id) })}>
                          <button type="submit" mix={dangerButtonStyle}>
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div mix={dividerStyle} />
            <h3 mix={subHeadingStyle}>Add a rule</h3>
            <form method="POST" action={routes.admin.flags.addRule.href({ flagId: String(flag.id) })} mix={formStyle}>
              <div mix={ruleGridStyle}>
                <label mix={labelStyle}>
                  <span>Attribute</span>
                  <input type="text" name="attribute" placeholder="country" mix={controlStyle} />
                </label>
                <label mix={labelStyle}>
                  <span>Operator</span>
                  <select name="operator" mix={controlStyle}>
                    <option value="equals">equals</option>
                    <option value="in">in (comma-separated)</option>
                  </select>
                </label>
                <label mix={labelStyle}>
                  <span>Value</span>
                  <input type="text" name="value" placeholder="US" mix={controlStyle} />
                </label>
                <label mix={labelStyle}>
                  <span>Serve variant</span>
                  <VariantSelect name="variant_id" variants={variants} selectedId={null} />
                </label>
              </div>
              <div>
                <button type="submit" mix={primaryButtonStyle}>
                  Add rule
                </button>
              </div>
            </form>
          </div>

          {/* Evaluation API */}
          <div mix={cardStyle}>
            <h2 mix={cardHeadingStyle}>Evaluate over the API</h2>
            <p mix={mutedStyle}>Pass a stable user key; the same key always resolves to the same variant.</p>
            <pre mix={codeBlockStyle}>{curl}</pre>
          </div>

          {/* Danger zone */}
          <div mix={cardStyle}>
            <form method="POST" action={routes.admin.flags.destroy.href({ flagId: String(flag.id) })}>
              <button type="submit" mix={dangerButtonStyle}>
                Delete this flag
              </button>
            </form>
          </div>
        </div>
      </AdminShell>
    )
  }
}

function VariantSelect(
  handle: Handle<{ name: string; variants: FlagVariant[]; selectedId: number | null }>,
) {
  return () => {
    let { name, variants, selectedId } = handle.props
    return (
      <select name={name} mix={controlStyle}>
        <option value="" selected={selectedId == null}>
          —
        </option>
        {variants.map((variant) => (
          <option value={String(variant.id)} selected={variant.id === selectedId}>
            {variant.name} ({variant.key})
          </option>
        ))}
      </select>
    )
  }
}

// ----- Styles -----

const columnStyle = css({ display: 'flex', flexDirection: 'column', gap: '20px' })
const formStyle = css({ display: 'flex', flexDirection: 'column', gap: '12px' })
const twoColStyle = css({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' })
const ruleGridStyle = css({ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' })
const rowBetweenStyle = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' })
const cardHeadingStyle = css({ margin: '0 0 12px', fontSize: '15px' })
const subHeadingStyle = css({ margin: '0 0 10px', fontSize: '14px' })
const mutedStyle = css({ margin: 0, fontSize: '13px', color: 'var(--text-tertiary)' })
const errorStyle = css({ margin: '0 0 8px', fontSize: '13px', fontWeight: 500, color: 'var(--danger)' })
const errorBannerStyle = css({
  padding: '10px 14px',
  borderRadius: '10px',
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--danger)',
  background: 'var(--danger-soft)',
  border: '1px solid var(--danger)',
})
const dividerStyle = css({ height: '1px', background: 'var(--border)', margin: '16px 0' })

const labelStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-primary)',
})
const controlStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '14px',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  width: '100%',
})
const weightInputStyle = css({
  font: 'inherit',
  fontSize: '14px',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  width: '90px',
})
const codeAreaStyle = css({
  font: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '13px',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  width: '100%',
  whiteSpace: 'pre',
})

const variantRowStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  padding: '14px',
  borderRadius: '10px',
  border: '1px solid var(--border)',
  marginBottom: '12px',
})
const variantHeadStyle = css({ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' })
const variantActionsStyle = css({ display: 'flex', gap: '10px' })
const variantDeleteStyle = css({})
const splitRowStyle = css({ display: 'flex', alignItems: 'center', gap: '10px' })
const splitLabelStyle = css({ minWidth: '160px', fontWeight: 600, fontSize: '13px' })

const tableStyle = css({ width: '100%', borderCollapse: 'collapse', fontSize: '14px' })
const thStyle = css({ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: '12px', color: 'var(--text-tertiary)' })
const tdStyle = css({ padding: '10px', borderBottom: '1px solid var(--border)' })
const tdMonoStyle = css({ padding: '10px', borderBottom: '1px solid var(--border)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px' })
const tdActionsStyle = css({ padding: '10px', borderBottom: '1px solid var(--border)', textAlign: 'right' })
const inlineCodeStyle = css({ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '13px', background: 'var(--surface-input)', padding: '2px 6px', borderRadius: '6px' })
const codeBlockStyle = css({ margin: 0, padding: '12px', borderRadius: '10px', background: 'var(--surface-input)', border: '1px solid var(--border)', fontSize: '13px', overflowX: 'auto', whiteSpace: 'pre' })

const badgeOnStyle = css({ fontSize: '12px', fontWeight: 700, color: '#0f7a4d', background: 'rgba(15, 122, 77, 0.12)', padding: '2px 8px', borderRadius: '999px' })
const badgeOffStyle = css({ fontSize: '12px', fontWeight: 700, color: 'var(--text-tertiary)', background: 'var(--surface-input)', padding: '2px 8px', borderRadius: '999px' })
