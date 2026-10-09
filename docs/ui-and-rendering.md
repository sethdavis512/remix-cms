# UI and rendering

**Status:** Accepted (Milestone 1)

## Context

`remix/component` is a server-first, non-React component runtime. Rendering happens
through a request-scoped `render(...)` helper installed by middleware, and browser
interactivity is opt-in per component via `clientEntry(...)`. The admin is a
form-driven CRUD interface, which suits server rendering well.

## Decisions

### Server-first, hydrate only where needed

Admin pages are plain server-rendered HTML forms that work without JavaScript.
Four components are hydrated, all `clientEntry`s living in colocated `public/`
directories (the only browser-reachable source the asset server exposes):

- the API-snippet **copy button** (`app/ui/public/copy-button.tsx`), modeled on the
  scaffold's `PromptButton`, for clipboard access.
- the **Content-Type Builder field editor** (`app/actions/admin/types/public/field-rows.tsx`), which
  adds and removes field rows in place so building a type no longer needs a
  save/reload cycle (TEC-303). It degrades gracefully: the rows are
  server-rendered and submit on their own, and the Add/Remove buttons are inert
  `type="button"` controls without JavaScript.
- the **Media Library image lightbox** (`app/actions/admin/media/public/media-lightbox.tsx`): image
  tiles open a native `<dialog>` (`showModal()`) with the full-size image, since
  `remix/component` ships no modal component. Without JavaScript the thumbnail is a
  plain link that opens the image in a new tab.
- the **Media Library drop-zone uploader** (`app/actions/admin/media/public/media-uploader.tsx`),
  which posts files over fetch for inline previews; a plain form submit is the
  no-JavaScript fallback.

This keeps the surface simple and accessible, and reserves hydration for genuine
browser interactivity. The public pages (`/`, `/blog`) opt out of the browser
entry module entirely (`Document`'s `hydrate={false}`), so they ship zero
JavaScript.

### Use the framework's render middleware

Controllers call `context.render(<Page/>)`. That helper is the conventional
`render({ assets })` from `remix/middleware/render`, installed in
`app/router.ts`: it streams `remix/component/server` output into an HTML
`Response`, resolves `clientEntry(import.meta.url, ...)` modules to browser URLs
through the asset server in `app/assets.ts`, and serves nested `<Frame>` requests
through the router. The scaffold-era hand-written render middleware was removed
when upgrading to Remix 3.0. `Document` (`app/ui/document.tsx`) renders the
browser entry's `<ImportMap>`, module preloads, and `<script type="module">` in
the head; scripts keep their authored bare imports and resolve through the
import map.

### A shared admin shell

`app/ui/admin-shell.tsx` is the one layout for every admin page: sidebar (brand,
nav, the list of content types, user + sign out), a topbar with a heading and an
actions slot, an optional flash banner, and the content area. Pages pass their
data in and compose inside it; route-local page components live next to their
controllers, shared UI lives in `app/ui/`.

### Field rendering is data-driven

`app/ui/form-fields.tsx` renders the correct input for each `FieldDef` type (text,
richtext -> textarea, number, boolean -> checkbox, date, email, enumeration ->
select), prefilled with the current value and showing an inline error. Inputs are
wrapped by `<label>` so no id/for wiring is needed.

### Theming: light and dark via CSS variables

Colors are defined as CSS custom properties on a root wrapper, with a
`@media (prefers-color-scheme: dark)` block overriding them. Components reference
`var(--...)` tokens, so both themes come from one style definition. Both were
verified in a real browser.

## Consequences

- Adding a new field type touches two well-scoped places: `form-fields.tsx`
  (input) and `field-schema.ts` (validation).
- The Content-Type Builder's field rows are added and removed in the browser via
  the `field-rows.tsx` client entry, with a server-rendered blank row as the
  no-JS fallback.

## Where it lives

- `app/ui/{admin-shell,form-fields,api-snippets,document}.tsx`
- `app/actions/public/entry.ts`, `app/ui/public/copy-button.tsx`,
  `app/actions/admin/{types,media}/public/*.tsx`, `app/assets.ts`
