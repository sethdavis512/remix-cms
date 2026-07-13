import { clientEntry, css, on, ref, type Handle, type SerializableProps } from 'remix/ui'

// The Content-Type Builder's field editor, hydrated so rows can be added and
// removed in the browser without a save/reload cycle (TEC-303).
//
// Server semantics are unchanged: every row still renders the same aligned set
// of `field_*` inputs that `parseFieldDefs` reads as parallel arrays (indexed by
// DOM position, not by an index in the input name). Adding a row appends a fresh
// blank row; removing a row deletes its inputs. Because a removed row drops one
// value from every parallel array at once, the arrays stay aligned and rows with
// a blank name are skipped server-side — so gaps from a removed middle row parse
// correctly with no re-indexing needed.
//
// No-JS fallback: the rows are server-rendered and fully submittable on their
// own. The Add/Remove buttons are plain `type="button"` controls that simply do
// nothing without JavaScript; the pre-rendered blank row remains usable and its
// blank name is skipped on save.

// Plain, serializable shapes passed from the server page (no runtime import from
// app/utils so this module stays within the asset server's allow-list). Type
// aliases (not interfaces) so they satisfy `SerializableValue`'s index type.
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

    // Event delegation so cloned rows (which carry no attached handlers) still
    // remove correctly.
    function handleContainerClick(event: Event) {
      let target = event.target as Element | null
      let removeButton = target?.closest('[data-remove-row]')
      if (!removeButton) return
      removeButton.closest('[data-field-row]')?.remove()
    }

    function renderRow(row: FieldRowData | null, seed: boolean) {
      let { fieldTypes, components, contentTypes } = handle.props
      let type = row?.type ?? 'text'
      // Unique is meaningless for booleans, component groups, relations, and
      // media; options only apply to enumerations. Render an inactive cell (with
      // a hidden input) for the rest so every row still submits an aligned value.
      let uniqueApplies =
        type !== 'boolean' && type !== 'component' && type !== 'relation' && type !== 'media'
      let optionsApply = type === 'enumeration'

      // The trailing blank "seed" row doubles as the clone source: capture a
      // pristine copy the moment it mounts, before any user edits.
      let seedRef = ref((node: Element) => {
        pristineRow = node.cloneNode(true) as Element
      })

      return (
        <div data-field-row mix={seed ? [rowStyle, seedRef] : rowStyle}>
          <input
            type="text"
            name="field_name"
            value={row?.name ?? ''}
            placeholder="title"
            mix={cellInputStyle}
          />
          <input
            type="text"
            name="field_label"
            value={row?.label ?? ''}
            placeholder="Title"
            mix={cellInputStyle}
          />
          <select name="field_type" mix={cellInputStyle}>
            {fieldTypes.map((fieldType) => (
              <option value={fieldType.value} selected={type === fieldType.value}>
                {fieldType.label}
              </option>
            ))}
          </select>
          <select name="field_component" mix={cellInputStyle}>
            <option value="" selected={!row?.component}>
              None
            </option>
            {components.map((component) => (
              <option value={component.apiId} selected={row?.component === component.apiId}>
                {component.name}
              </option>
            ))}
          </select>
          <select name="field_target" mix={cellInputStyle}>
            <option value="" selected={!row?.target}>
              None
            </option>
            {contentTypes.map((contentType) => (
              <option value={contentType.apiId} selected={row?.target === contentType.apiId}>
                {contentType.name}
              </option>
            ))}
          </select>
          {renderYesNo('field_repeatable', row?.repeatable ?? false)}
          {renderYesNo('field_required', row?.required ?? false)}
          {uniqueApplies ? (
            renderYesNo('field_unique', row?.unique ?? false)
          ) : (
            <span mix={inactiveCellStyle}>
              <input type="hidden" name="field_unique" value="no" />
              n/a
            </span>
          )}
          {optionsApply ? (
            <input
              type="text"
              name="field_options"
              value={row?.options.join(', ') ?? ''}
              placeholder="draft, published"
              mix={cellInputStyle}
            />
          ) : (
            <span mix={inactiveCellStyle}>
              <input type="hidden" name="field_options" value="" />
              Enumeration only
            </span>
          )}
          <button
            type="button"
            data-remove-row
            aria-label="Remove field"
            title="Remove field"
            mix={removeButtonStyle}
          >
            ✕
          </button>
        </div>
      )
    }

    return () => {
      let { fields } = handle.props

      return (
        <div>
          <div mix={rowHeaderStyle}>
            <span>Name</span>
            <span>Label</span>
            <span>Type</span>
            <span>Component</span>
            <span>Relation target</span>
            <span>Repeatable / Many</span>
            <span>Required</span>
            <span>Unique</span>
            <span>Options (comma-separated)</span>
            <span />
          </div>

          <div
            mix={[
              ref((node: Element) => (container = node)),
              on<HTMLDivElement>('click', handleContainerClick),
            ]}
          >
            {fields.map((field) => renderRow(field, false))}
            {renderRow(null, true)}
          </div>

          <div mix={css({ marginTop: '12px' })}>
            <button type="button" mix={[addButtonStyle, on<HTMLButtonElement>('click', handleAdd)]}>
              + Add field
            </button>
          </div>
        </div>
      )
    }
  },
)

function renderYesNo(name: string, value: boolean) {
  return (
    <select name={name} mix={cellInputStyle}>
      <option value="no" selected={!value}>
        No
      </option>
      <option value="yes" selected={value}>
        Yes
      </option>
    </select>
  )
}

const GRID_COLUMNS = '1.1fr 1.1fr 0.9fr 1fr 1fr 0.9fr 0.7fr 0.7fr 1.2fr 32px'

const rowHeaderStyle = css({
  display: 'grid',
  gridTemplateColumns: GRID_COLUMNS,
  gap: '8px',
  padding: '0 2px 6px',
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--text-tertiary)',
  '@media (max-width: 1100px)': { display: 'none' },
})

const rowStyle = css({
  display: 'grid',
  gridTemplateColumns: GRID_COLUMNS,
  gap: '8px',
  marginBottom: '8px',
  alignItems: 'center',
  '@media (max-width: 1100px)': { gridTemplateColumns: '1fr 1fr' },
})

const cellInputStyle = css({
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

const inactiveCellStyle = css({
  display: 'flex',
  alignItems: 'center',
  padding: '8px 10px',
  fontSize: '13px',
  color: 'var(--text-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: '7px',
  background: 'var(--surface-2)',
})

const removeButtonStyle = css({
  font: 'inherit',
  fontSize: '13px',
  lineHeight: 1,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  padding: 0,
  borderRadius: '7px',
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  '&:hover': { background: 'var(--danger-soft)', color: 'var(--danger)', borderColor: 'var(--danger)' },
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
