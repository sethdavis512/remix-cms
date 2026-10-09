# Remix v3 as the foundation

**Status:** Accepted (Milestone 1)

## Context

The project was scaffolded with `remix new` on the 3.0 beta and now depends on the
stable `remix@^3.0.0` release.
Remix v3 is a ground-up rewrite and is **not** the Remix that became React Router
7, and its UI layer is **not** React. Because it is early and unlike the team's
usual React Router 7 stack, the programming model had to be learned before
building, and it shapes every other decision in this repo.

## Decision

Build directly on Remix v3's primitives and follow its conventions rather than
porting React Router 7 or React patterns. The bundled skill at
`.agents/skills/remix/SKILL.md` (kept in sync with the upstream `remix` repo) is
treated as the entry point; it directs to the installed documentation, which is
canonical: `node_modules/remix/INDEX.md` maps tasks to the guides in
`node_modules/remix/guides/` and to the package READMEs under
`node_modules/remix/src/**/README.md`. Exact APIs are verified there before
writing code.

## What Remix v3 is (mental model)

- **Server-first, Web-API based.** Everything is built on `Request`, `Response`,
  `URL`, and `FormData`. The app boots a plain Node HTTP server in `server.ts`
  and dispatches through `router.fetch(request)`.
- **Single package, subpath imports.** All modules come from `remix/*` subpaths
  (`remix/router`, `remix/data-table`, `remix/data-schema`, `remix/component`,
  ...). The root `remix` module is type-only; it exists so apps can augment
  `RouterTypes` with their context (`declare module 'remix' { ... }`).
- **Typed route contract.** `app/routes.ts` declares URLs; everything else
  generates links and redirects from it via `routes.<name>.href(...)`.
- **Controllers, not file routes.** Request handlers live in
  `app/actions/**/controller.tsx` and return explicit `Response` objects.
- **`remix/component` is not React.** A component is
  `function Name(handle) { return () => <jsx/> }`: it receives a `handle`, reads
  props from `handle.props`, keeps state in setup-scope variables, and calls
  `handle.update()` explicitly. There are no hooks and no implicit re-render.
  Host-element behavior and styling attach via `mix={...}` (e.g. `css(...)`,
  `on('click', ...)`).

## Consequences

- The code reads very differently from a React Router 7 app; contributors need
  the mental model above (and the SKILL file) before editing.
- Verifying APIs against the installed guides and package READMEs is a required
  first step for any new surface; the 3.0 release renamed several entry points
  (`remix/ui` became `remix/component`, database adapters became
  `createSqliteDatabase`, the asset server moved to `allowFiles`/`mounts`), so
  remembered pre-release APIs are not reliable.
- Server-rendered HTML is the default; browser interactivity is opt-in per
  component via `clientEntry(...)` (see [ui-and-rendering](./ui-and-rendering.md)).

## Where it lives

- `server.ts`, `app/router.ts`, `app/routes.ts`, `remix.json`
- `.agents/skills/remix/SKILL.md`, `node_modules/remix/INDEX.md`
