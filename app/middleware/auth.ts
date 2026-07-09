import { auth, Auth, createSessionAuthScheme, requireAuth } from 'remix/middleware/auth'
import { Database } from 'remix/data-table'
import { redirect } from 'remix/response/redirect'

import { users, type UserRow } from '../data/schema.ts'
import { routes } from '../routes.ts'

// The identity carried on request auth state, mapped to a clean shape.
export interface AuthUser {
  id: number
  email: string
  name: string
  role: string
}

// The value persisted in the session by the login action.
export interface SessionAuth {
  userId: number
}

function toAuthUser(row: UserRow): AuthUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role }
}

// Resolves the session auth record back into request auth state (context.auth).
export function loadAuth() {
  return auth({
    schemes: [
      createSessionAuthScheme<AuthUser, SessionAuth>({
        read(session) {
          return (session.get('auth') as SessionAuth | undefined) ?? null
        },
        async verify(value, context) {
          let db = context.get(Database)
          if (!db) return null
          let row = await db.find(users, value.userId)
          return row ? toAuthUser(row) : null
        },
        invalidate(session) {
          session.unset('auth')
        },
      }),
    ],
  })
}

// Controller middleware that protects admin areas. Unauthenticated browser
// requests are redirected to the login page with a returnTo hint.
export function requireAdmin() {
  return requireAuth<AuthUser>({
    onFailure(context) {
      let returnTo = encodeURIComponent(context.url.pathname + context.url.search)
      return redirect(`${routes.auth.loginForm.href()}?returnTo=${returnTo}`, 303)
    },
  })
}

export { Auth }
