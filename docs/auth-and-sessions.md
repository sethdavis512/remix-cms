# Auth and sessions

**Status:** Accepted (Milestone 1)

## Context

The admin area must be protected, and the public API must stay open but expose
only published content. Remix v3 ships session middleware, an auth middleware with
pluggable schemes, and `requireAuth()` for route protection.

## Decision

Use a **session-cookie login** with server-side session storage, credentials
verified against the `users` table, and a session-backed auth scheme.

- **Password hashing:** `app/utils/password.ts` uses `node:crypto` scrypt, stored
  as `scrypt$<saltHex>$<hashHex>`; verification is constant-time
  (`timingSafeEqual`). No hashing dependency is added.
- **Session cookie:** `app/middleware/session.ts` creates a signed, `httpOnly`,
  `SameSite=Lax` cookie (`secure` in production). `SESSION_SECRET` is required
  outside tests and the app fails fast if it is missing. Storage is filesystem
  (`./tmp/sessions`) for the app and in-memory for tests.
- **Auth resolution:** `app/middleware/auth.ts` registers a
  `createSessionAuthScheme` that reads `session.get('auth') -> { userId }` and
  verifies it against the `users` table, exposing a clean `AuthUser` on
  `context.get(Auth)`.
- **Login flow:** `app/actions/auth/controller.tsx` verifies credentials, then
  `session.regenerateId(true)` (rotate on privilege change) and
  `session.set('auth', { userId })`. Logout unsets auth and rotates the id.
- **Route protection:** `requireAdmin()` (a configured `requireAuth`) is applied
  as controller middleware on each admin controller and redirects unauthenticated
  browser requests to the login page with a `returnTo` hint.

## Why

- Sessions (not plain cookies) are the right tool for identity: the value is
  tamper-sensitive and server-managed, matching the framework's guidance.
- Doing credential verification manually (rather than the OAuth/provider helpers)
  keeps Milestone 1 small while still following the secure defaults: hardened
  cookie, secret required in production, id rotation on login/logout.

## Important detail: middleware does not cascade

A controller's middleware applies only to that controller's direct actions.
Nested route maps get their **own** controllers, so each admin controller
(`admin`, `admin.types`, `admin.content`) declares `requireAdmin()` itself. The
public API controller has no auth and returns only published entries.

## Consequences

- Session-based protection is bypassable by clearing cookies (expected); it gates
  the admin UI, not durable identity guarantees.
- Per-resource authorization beyond "is an admin" is not needed yet (single admin
  role); RBAC is a future concern.

## Where it lives

- `app/utils/password.ts`, `app/middleware/session.ts`, `app/middleware/auth.ts`
- `app/actions/auth/controller.tsx`
