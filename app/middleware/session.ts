import { createCookie } from 'remix/cookie'
import { createFsSessionStorage } from 'remix/session-storage/fs'

// Session cookie is always signed and hardened. The secret is required outside
// of tests so we never ship a demo secret to production.
let sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret && process.env.NODE_ENV !== 'test') {
  throw new Error('SESSION_SECRET is required')
}

export const sessionCookie = createCookie('__session', {
  secrets: [sessionSecret ?? 'test-only-secret'],
  httpOnly: true,
  sameSite: 'Lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 30, // 30 days
  path: '/',
})

// Filesystem-backed storage for the running app. Tests use an in-memory store.
export function createAppSessionStorage() {
  return createFsSessionStorage('./tmp/sessions')
}
