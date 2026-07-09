# UI and rendering

**Status:** Accepted (Milestone 1)

## Context

`remix/ui` is a server-first, non-React component runtime. Rendering happens
through a request-scoped `render(...)` helper installed by middleware, and browser
interactivity is opt-in per component via `clientEntry(...)`. The admin is a
form-driven CRUD interface, which suits server rendering well.

## Decisions

### Server-first, hydrate only where needed

Admin pages are plain server-rendered HTML forms that work without JavaScript.
The only hydrated component so far is the API-snippet **copy button**
(`app/assets/copy-button.tsx`), a `clientEntry` modeled on the scaffold's
`PromptButton`. This keeps the surface simple and accessible, and reserves
hydration for genuine browser-only behavior (clipboard access).

### Reuse the existing render middleware

Controllers call `context.render(<Page/>)`. That helper
(`app/middleware/render.tsx`, from the scaffold) adapts `remix/ui/server`
streaming into an HTML `Response` and resolves client entries to compiled asset
URLs. No separate response-rendering module was introduced.

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
- The Content-Type Builder is currently server-only with a fixed set of blank
  field rows ("save and re-open to add more"); a hydrated add/remove-row control
  is a tracked follow-up (TEC-303).

## Where it lives

- `app/ui/{admin-shell,form-fields,api-snippets,document}.tsx`
- `app/assets/copy-button.tsx`, `app/middleware/render.tsx`
