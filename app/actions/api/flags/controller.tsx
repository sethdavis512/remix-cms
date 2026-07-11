import { createController } from 'remix/router'
import { Database } from 'remix/data-table'

import { authorizeApiRequest } from '../../../data/api-tokens.server.ts'
import { runScheduledWork } from '../../../data/scheduler.server.ts'
import {
  evaluateAllFlags,
  evaluateFlagForUser,
  findFlagByKey,
  type EvalContext,
} from '../../../data/flags.server.ts'
import { routes } from '../../../routes.ts'

// Public, read-only feature-flag evaluation API. Mirrors the entries API
// (app/actions/api/controller.tsx): gated by the same bearer-token setting, and
// it fires due scheduled work lazily so a flag's start/end window takes effect
// on the first read past its time. Every request must identify the caller with
// ?user=<key>; that key drives deterministic bucketing.
//
//   GET /api/flags?user=u123&country=US  -> evaluate every flag for the user
//   GET /api/flags/:key?user=u123        -> evaluate one flag

// Build the evaluation context from the query string: the reserved `user` param
// is the bucketing key; every other param becomes a targeting attribute.
function evalContext(url: URL, userKey: string): EvalContext {
  let attributes: Record<string, string> = {}
  for (let [name, value] of url.searchParams) {
    if (name !== 'user') attributes[name] = value
  }
  return { userKey, attributes, now: Date.now() }
}

export default createController(routes.api.flags, {
  actions: {
    async evaluateAll(context) {
      let db = context.get(Database)!
      let denied = await authorizeApiRequest(db, context.request)
      if (denied) return denied
      await runScheduledWork(db)

      let userKey = context.url.searchParams.get('user')
      if (!userKey) {
        return Response.json(
          { error: 'Missing required "user" query parameter' },
          { status: 400 },
        )
      }

      let data = await evaluateAllFlags(db, evalContext(context.url, userKey))
      return Response.json({ data, meta: { user: userKey } })
    },

    async evaluateOne(context) {
      let db = context.get(Database)!
      let denied = await authorizeApiRequest(db, context.request)
      if (denied) return denied
      await runScheduledWork(db)

      let userKey = context.url.searchParams.get('user')
      if (!userKey) {
        return Response.json(
          { error: 'Missing required "user" query parameter' },
          { status: 400 },
        )
      }

      let flag = await findFlagByKey(db, context.params.key)
      if (!flag) {
        return Response.json({ error: 'Not Found' }, { status: 404 })
      }

      let data = await evaluateFlagForUser(db, flag, evalContext(context.url, userKey))
      return Response.json({ data })
    },
  },
})
