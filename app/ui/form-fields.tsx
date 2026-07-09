import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { FieldDef } from '../utils/fields.ts'

const labelStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-primary)',
})

const controlStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '14px',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
  width: '100%',
  '&:focus-visible': { outline: '2px solid var(--brand)', outlineOffset: '1px' },
})

const errorStyle = css({
  margin: 0,
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--danger)',
})

const hintStyle = css({
  fontSize: '12px',
  fontWeight: 400,
  color: 'var(--text-tertiary)',
})

// Renders a single labelled input for a content-type field, prefilled with the
// current value and showing a validation error when present. The input is
// wrapped by <label> so no htmlFor/id wiring is needed.
export function FieldInput(handle: Handle<{ field: FieldDef; value?: unknown; error?: string }>) {
  return () => {
    let { field, value, error } = handle.props
    let stringValue = value == null ? '' : String(value)

    return (
      <label mix={labelStyle}>
        <span>
          {field.label}
          {field.required ? <span mix={css({ color: 'var(--danger)' })}> *</span> : null}
        </span>
        {renderControl(field, value, stringValue)}
        {field.type === 'enumeration' && field.options.length === 0 ? (
          <span mix={hintStyle}>No options defined for this field.</span>
        ) : null}
        {error ? <p mix={errorStyle}>{error}</p> : null}
      </label>
    )
  }
}

function renderControl(field: FieldDef, value: unknown, stringValue: string) {
  switch (field.type) {
    case 'richtext':
      return <textarea name={field.name} rows={6} value={stringValue} mix={controlStyle} />


    case 'boolean':
      return (
        <span mix={css({ display: 'inline-flex', alignItems: 'center', gap: '8px' })}>
          <input
            type="checkbox"
            name={field.name}
            value="on"
            checked={value === true || value === 'true' || value === 'on'}
          />
          <span mix={css({ fontWeight: 400, fontSize: '13px' })}>Enabled</span>
        </span>
      )

    case 'number':
      return <input type="number" name={field.name} value={stringValue} mix={controlStyle} />

    case 'date':
      return <input type="date" name={field.name} value={stringValue} mix={controlStyle} />

    case 'email':
      return <input type="email" name={field.name} value={stringValue} mix={controlStyle} />

    case 'enumeration':
      return (
        <select name={field.name} mix={controlStyle}>
          {field.required ? null : <option value="">—</option>}
          {field.options.map((option) => (
            <option value={option} selected={option === stringValue}>
              {option}
            </option>
          ))}
        </select>
      )

    case 'text':
    default:
      return <input type="text" name={field.name} value={stringValue} mix={controlStyle} />
  }
}
