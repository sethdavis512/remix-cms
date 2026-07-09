# Routing, controllers, and the middleware stack

**Status:** Accepted (Milestone 1)

## Context

Remix v3 routes are a typed contract in `app/routes.ts`, implemented by
controllers under `app/actions/`. The framework offers shorthand route builders
(`form()`, `resources()`) as well as explicit `get()`/`post()` leaves, and it maps
each route map to a controller with `router.map(...)`.

## Decision: explicit `get`/`post` leaves, one controller per route area

`app/routes.ts` uses plain `get(...)`/`post(...)` leaves grouped under
`route('admin', {...})` and `route('api', {...})` prefixes, rather than `form()`
or `resources()`.

```
auth:  loginForm (GET), login (POST), logout (POST)
admin: index (GET)
  types:   index, newForm, create, editForm, update, destroy
  content: index, newForm, create, editForm, update, destroy, publish
api:   list (GET /:type), show (GET /:type/:id)
```

### Why not `form()` / `resources()`

- `form('login')` expands to a nested `{ index, action }` route map, which would
  need its own `router.map(...)` and complicate single-controller wiring.
  Explicit `loginForm`/`login`/`login` leaves keep every route directly mappable
  in one controller and keep action names self-explanatory.
- The names come out intent-revealing (`newForm`, `editForm`, `destroy`) and the
  URL patterns stay obvious.

## Decision: controller per route area, mapped explicitly

Each area is its own controller and is registered explicitly, because nested
route maps do not inherit their parent's controller or middleware:

- `app/actions/controller.tsx` — root (`home`, `assets`)
- `app/actions/auth/controller.tsx`
- `app/actions/admin/controller.tsx` (dashboard) + `requireAdmin()`
- `app/actions/admin/types/controller.tsx` + `requireAdmin()`
- `app/actions/admin/content/controller.tsx` + `requireAdmin()`
- `app/actions/api/controller.tsx` (public)

Each controller follows the same shape: read typed context (`get(Database)`,
`get(Session)`, `get(Auth)`, `get(FormData)`), validate input at the boundary,
mutate through the `*.server.ts` query modules, and return an explicit `Response`
(`context.render(...)`, `redirect(...)`, or a 404). Expected failures (validation,
not-found) are returned as responses, never thrown.

## Decision: a router factory shared by server and tests

`app/router.ts` exports `createAppRouter({ database, sessionStorage, dev })`,
which builds the middleware stack inline and maps every controller. `server.ts`
calls it with the real file DB and filesystem session storage; tests call it with
an in-memory DB and memory session storage.

- The middleware array is inline in the factory so the middleware-provided context
  (Database, Session, Auth, FormData, render) is inferred into `AppContext`, which
  is then declared as `RouterTypes.context` so controllers stay fully typed.
- Middleware order matters: static files and rendering first, then `formData()`,
  `methodOverride()`, `session(...)`, `loadDatabase(...)`, `loadAuth()` (auth
  verification needs the database, so it comes after it).

### A note on the request logger

`logger()` was omitted from the stack. It is a context-providing middleware whose
type is not assignable to a bare `Middleware`, and gating it conditionally
threatened the tuple inference that produces `AppContext`. Keeping the stack a
fixed, provider-clean tuple was worth more than dev request logs for Milestone 1.

## Where it lives

- `app/routes.ts`, `app/router.ts`, `app/actions/**/controller.tsx`
- Middleware: `app/middleware/{database,session,auth,render}.*`
