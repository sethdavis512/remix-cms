import { createRouter, type RouterContext } from 'remix/router'
import { staticFiles } from 'remix/middleware/static'
import { formData } from 'remix/middleware/form-data'
import { methodOverride } from 'remix/middleware/method-override'
import { session } from 'remix/middleware/session'
import type { SessionStorage } from 'remix/session'

import { render } from './middleware/render.tsx'
import { loadDatabase } from './middleware/database.ts'
import { loadAuth } from './middleware/auth.ts'
import { sessionCookie } from './middleware/session.ts'
import type { AppDatabase } from './data/db.ts'
import { routes } from './routes.ts'

import rootController from './actions/controller.tsx'
import authController from './actions/auth/controller.tsx'
import adminController from './actions/admin/controller.tsx'
import typesController from './actions/admin/types/controller.tsx'
import contentController from './actions/admin/content/controller.tsx'
import apiController from './actions/api/controller.tsx'

export interface AppRouterOptions {
  database: AppDatabase
  sessionStorage: SessionStorage
  dev?: boolean
}

export function createAppRouter(options: AppRouterOptions) {
  let router = createRouter({
    middleware: [
      staticFiles('./public', { index: false }),
      render(),
      formData(),
      methodOverride(),
      session(sessionCookie, options.sessionStorage),
      loadDatabase(options.database),
      loadAuth(),
    ],
  })

  // Register each controller explicitly. Nested route maps (admin.types,
  // admin.content) get their own controllers, each with its own requireAdmin.
  router.map(routes, rootController)
  router.map(routes.auth, authController)
  router.map(routes.admin, adminController)
  router.map(routes.admin.types, typesController)
  router.map(routes.admin.content, contentController)
  router.map(routes.api, apiController)

  return router
}

export type AppRouter = ReturnType<typeof createAppRouter>
export type AppContext = RouterContext<AppRouter>

declare module 'remix/router' {
  interface RouterTypes {
    context: AppContext
  }
}
