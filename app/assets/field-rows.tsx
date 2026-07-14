import { clientEntry, css, on, ref, type Handle, type SerializableProps } from 'remix/ui'

// The Content-Type Builder's field editor, hydrated so rows can be added and
// removed in the browser without a save/reload cycle (TEC-303). Each field is a
// bordered card row: Name / Label / Type up top, then a contextual band that
// only shows the controls relevant to the chosen type (Component select,
// Relation target, enumeration Options) plus pill toggles for the booleans.
//
// Server semantics are unchanged: every row always submits exactly one value
// per `field_*` key, which `parseFieldDefs` reads as parallel arrays aligned by
// DOM position (no indexes in names). Hiding a control uses CSS display only —
// hidden inputs still submit — and each boolean pill pairs a hidden input
// (which carries the submitted yes/no value) with an unnamed checkbox that a
// delegated change handler keeps in sync. Adding a row appends a clone of a
// pristine blank row; removing a row drops one value from every array at once,
// so alignment survives arbitrary add/remove.
//
// No-JS fallback: rows are server-rendered and submit correctly on their own
// (each pill's hidden input carries the saved value). Contextual controls are
// shown/hidden per the row's saved type, and a type change without JavaScript
// surfaces the right controls after the next round trip (e.g. the 400 re-render
// that asks for a component). Add/Remove/toggles are inert without JavaScript.

// Plain, serializable shapes passed from the server page (no runtime import
// from app/utils so this module stays within the asset server's allow-list).
// Type aliases (not interfaces) so they satisfy `SerializableValue`.
type FieldRowData = {
  name: string
  label: string
  type: string
  required: boolean
  unique: boolean
  options: string[]
  component?: string
  target?: string
  repeatable?: boolean
}

type TypeOption = {
  value: string
  label: string
}

type RefItem = {
  apiId: string
  name: string
}

interface FieldRowsEditorProps extends SerializableProps {
  fields: FieldRowData[]
  fieldTypes: TypeOption[]
  components: RefItem[]
  contentTypes: RefItem[]
}

// Unique is meaningless for booleans, component groups, relations, and media.
const UNIQUE_HIDDEN_TYPES = ['boolean', 'component', 'relation', 'media']

export const FieldRowsEditor = clientEntry(
  import.meta.url,
  function FieldRowsEditor(handle: Handle<FieldRowsEditorProps>) {
    // Captured once at hydration; both are null on the server and until the
    // container/seed row mount, so every handler guards for it.
    let container: Element | null = null
    let pristineRow: Element | null = null

    function handleAdd() {
      if (!container || !pristineRow) return
      let clone = pristineRow.cloneNode(true) as Element
      container.appendChild(clone)
      let firstInput = clone.querySelector<HTMLElement>('input, select')
      firstInput?.focus()
    }

    // Click delegation so cloned rows (which carry no attached handlers) still
    // remove correctly.
    function handleContainerClick(event: Event) {
      let target = event.target as Element | null
      let removeButton = target?.closest('[data-remove-row]')
      if (!removeButton) return
      removeButton.closest('[data-field-row]')?.remove()
    }

    // Change delegation, for the same reason. Two jobs: keep each boolean
    // pill's hidden input in sync with its checkbox, and swap the contextual
    // controls when a row's type changes.
    function handleContainerChange(event: Event) {
      let target = event.target
      let row = target instanceof Element ? target.closest('[data-field-row]') : null
      if (!row) return

      if (
        target instanceof HTMLInputElement &&
        target.type === 'checkbox' &&
        target.hasAttribute('data-toggle')
      ) {
        let hidden = target
          .closest('[data-toggle-pill]')
          ?.querySelector<HTMLInputElement>('input[type="hidden"]')
        if (hidden) hidden.value = target.checked ? 'yes' : 'no'
        return
      }

      if (target instanceof HTMLSelectElement && target.name === 'field_type') {
        applyRowType(row, target.value)
      }
    }

    function applyRowType(row: Element, type: string) {
      for (let cell of row.querySelectorAll<HTMLElement>('[data-show-for]')) {
        let show = (cell.getAttribute('data-show-for') ?? '').split(' ').includes(type)
        cell.style.display = show ? '' : 'none'
      }

      // Unique gets hidden AND reset for types where it is meaningless, so a
      // toggle checked under an earlier type cannot leak into the saved field.
      let unique = row.querySelector<HTMLElement>('[data-unique-pill]')
      if (unique) {
        let applies = !UNIQUE_HIDDEN_TYPES.includes(type)
        unique.style.display = applies ? '' : 'none'
        if (!applies) {
          let hidden = unique.querySelector<HTMLInputElement>('input[type="hidden"]')
          let checkbox = unique.querySelector<HTMLInputElement>('input[type="checkbox"]')
          if (hidden) hidden.value = 'no'
          if (checkbox) checkbox.checked = false
        }
      }
    }

    // A boolean as a pill toggle: the hidden input is what submits (one value
    // per row per key, no-JS safe); the checkbox is unnamed and synced to it by
    // the delegated change handler above.
    function renderToggle(
      name: string,
      label: string,
      value: boolean,
      show: { uniquePill?: boolean; showFor?: string; visible: boolean },
    ) {
      return (
        <label
          data-toggle-pill
          data-unique-pill={show.uniquePill ? 'true' : undefined}
          data-show-for={show.showFor}
          mix={pillStyle}
          style={show.visible ? undefined : { display: 'none' }}
        >
          <input type="hidden" name={name} value={value ? 'yes' : 'no'} />
          <input type="checkbox" data-toggle checked={value} mix={pillCheckboxStyle} />
          <span>{label}</span>
        </label>
      )
    }

    function renderRow(row: FieldRowData | null, seed: boolean) {
      let { fieldTypes, components, contentTypes } = handle.props
      let type = row?.type ?? 'text'
      let uniqueApplies = !UNIQUE_HIDDEN_TYPES.includes(type)

      // The trailing blank "seed" row doubles as the clone source: capture a
      // pristine copy the moment it mounts, before any user edits.
      let seedRef = ref((node: Element) => {
        pristineRow = node.cloneNode(true) as Element
      })

      return (
        <div data-field-row mix={seed ? [rowCardStyle, seedRef] : rowCardStyle}>
          <button
            type="button"
            data-remove-row
            aria-label="Remove field"
            title="Remove field"
            mix={removeButtonStyle}
          >
            ✕
          </button>

          <div mix={primaryGridStyle}>
            <label mix={cellStyle}>
              <span mix={cellLabelStyle}>Name</span>
              <input
                type="text"
                name="field_name"
                value={row?.name ?? ''}
                placeholder="title"
                mix={inputStyle}
              />
            </label>
            <label mix={cellStyle}>
              <span mix={cellLabelStyle}>Label</span>
              <input
                type="text"
                name="field_label"
                value={row?.label ?? ''}
                placeholder="Title"
                mix={inputStyle}
              />
            </label>
            <label mix={cellStyle}>
              <span mix={cellLabelStyle}>Type</span>
              <select name="field_type" mix={inputStyle}>
                {fieldTypes.map((fieldType) => (
                  <option value={fieldType.value} selected={type === fieldType.value}>
                    {fieldType.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div mix={secondaryRowStyle}>
            <label
              data-show-for="component"
              mix={[cellStyle, contextualCellStyle]}
              style={type === 'component' ? undefined : { display: 'none' }}
            >
              <span mix={cellLabelStyle}>Component</span>
              <select name="field_component" mix={inputStyle}>
                <option value="" selected={!row?.component}>
                  Select a component…
                </option>
                {components.map((component) => (
                  <option value={component.apiId} selected={row?.component === component.apiId}>
                    {component.name}
                  </option>
                ))}
              </select>
            </label>

            <label
              data-show-for="relation"
              mix={[cellStyle, contextualCellStyle]}
              style={type === 'relation' ? undefined : { display: 'none' }}
            >
              <span mix={cellLabelStyle}>Relation target</span>
              <select name="field_target" mix={inputStyle}>
                <option value="" selected={!row?.target}>
                  Select a content type…
                </option>
                {contentTypes.map((contentType) => (
                  <option value={contentType.apiId} selected={row?.target === contentType.apiId}>
                    {contentType.name}
                  </option>
                ))}
              </select>
            </label>

            <label
              data-show-for="enumeration"
              mix={[cellStyle, contextualCellStyle]}
              style={type === 'enumeration' ? undefined : { display: 'none' }}
            >
              <span mix={cellLabelStyle}>Options</span>
              <input
                type="text"
                name="field_options"
                value={row?.options.join(', ') ?? ''}
                placeholder="draft, published"
                mix={inputStyle}
              />
            </label>

            <div mix={togglesStyle}>
              {renderToggle('field_required', 'Required', row?.required ?? false, {
                visible: true,
              })}
              {renderToggle('field_unique', 'Unique', row?.unique ?? false, {
                uniquePill: true,
                visible: uniqueApplies,
              })}
              {renderToggle('field_repeatable', 'Repeatable', row?.repeatable ?? false, {
                showFor: 'component relation',
                visible: type === 'component' || type === 'relation',
              })}
            </div>
          </div>
        </div>
      )
    }

    return () => {
      let { fields } = handle.props

      return (
        <div>
          <div
            mix={[
              ref((node: Element) => (container = node)),
              on<HTMLDivElement>('click', handleContainerClick),
              on<HTMLDivElement>('change', handleContainerChange),
            ]}
          >
            {fields.map((field) => renderRow(field, false))}
            {renderRow(null, true)}
          </div>

          <div mix={css({ marginTop: '4px' })}>
            <button type="button" mix={[addButtonStyle, on<HTMLButtonElement>('click', handleAdd)]}>
              + Add field
            </button>
          </div>
        </div>
      )
    }
  },
)

// ----- Styles -----

const rowCardStyle = css({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  padding: '16px',
  paddingRight: '52px',
  marginBottom: '12px',
  border: '1px solid var(--border)',
  borderRadius: '12px',
  background: 'var(--surface-1)',
  '&:hover [data-remove-row]': { opacity: 1 },
})

const primaryGridStyle = css({
  display: 'grid',
  gridTemplateColumns: 'minmax(150px, 1.2fr) minmax(150px, 1.2fr) minmax(130px, 1fr)',
  gap: '12px',
  '@media (max-width: 800px)': { gridTemplateColumns: '1fr' },
})

const secondaryRowStyle = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  gap: '12px 16px',
})

const cellStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  minWidth: 0,
})

const contextualCellStyle = css({
  flex: '1 1 220px',
  maxWidth: '340px',
})

const cellLabelStyle = css({
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
})

const inputStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '13px',
  padding: '8px 10px',
  borderRadius: '7px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  width: '100%',
})

const togglesStyle = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '8px',
  paddingBottom: '2px',
})

const pillStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  padding: '7px 12px',
  borderRadius: '999px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  fontSize: '13px',
  fontWeight: 500,
  color: 'var(--text-primary)',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  '&:hover': { background: 'var(--surface-2)' },
  '&:has(input:checked)': { borderColor: 'var(--brand)' },
})

const pillCheckboxStyle = css({
  width: '15px',
  height: '15px',
  margin: 0,
  cursor: 'pointer',
  accentColor: 'var(--brand)',
})

const removeButtonStyle = css({
  position: 'absolute',
  top: '12px',
  right: '12px',
  font: 'inherit',
  fontSize: '13px',
  lineHeight: 1,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  padding: 0,
  borderRadius: '7px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  opacity: 0.55,
  transition: 'opacity 120ms ease, background 120ms ease',
  '&:hover': {
    background: 'var(--danger-soft)',
    color: 'var(--danger)',
    borderColor: 'var(--danger)',
    opacity: 1,
  },
  '&:focus-visible': { opacity: 1 },
})

const addButtonStyle = css({
  font: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '9px 16px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  color: 'var(--text-primary)',
  '&:hover': { background: 'var(--surface-2)' },
})
