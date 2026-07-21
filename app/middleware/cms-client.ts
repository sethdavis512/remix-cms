import { createContextKey, type Middleware } from 'remix/router'

import { CmsClient } from '../data/cms-client.server.ts'

// Context key controllers read with `context.get(CmsClientKey)` (or `context.cms`).
export const CmsClientKey = createContextKey<CmsClient>()

// Minimal structural view of the router: all the client needs is a way to
// dispatch a request in-process. Kept narrow so any concrete app router is
// assignable without fighting the router's generic context type.
export interface FetchRouter {
  fetch(request: Request): Promise<Response>
}

// Injects a CMS client whose fetch dispatches in-process through the router. The
// router is passed via a getter closure because the middleware is built before
// the router variable is assigned in `createAppRouter`; the getter is only
// called at request time, by which point the router exists. The client module
// never imports the router, so there is no circular import.
export function loadCmsClient(getRouter: () => FetchRouter): Middleware<{
  key: typeof CmsClientKey
  value: CmsClient
  property: 'cms'
}> {
  return async (context, next) => {
    let client = new CmsClient((request) => getRouter().fetch(request), context.url.origin)
    context.set(CmsClientKey, client, { property: 'cms' })
    return next()
  }
}
