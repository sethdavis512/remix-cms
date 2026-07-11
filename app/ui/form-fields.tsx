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

interface FieldInputProps {
  field: FieldDef
  value?: unknown
  error?: string
  // Overrides the input's name attribute; component sub-fields submit under
  // '<field>.<sub>' / '<field>.<index>.<sub>' instead of the bare field name.
  inputName?: string
  // Inside component groups a required enumeration still gets a blank option,
  // so an untouched group stays fully blank and is skipped on parse.
  blankEnumOption?: boolean
}

// Renders a single labelled input for a content-type field, prefilled with the
// current value and showing a validation error when present. The input is
// wrapped by <label> so no htmlFor/id wiring is needed.
export function FieldInput(handle: Handle<FieldInputProps>) {
  return () => {
    let { field, value, error, inputName, blankEnumOption } = handle.props
    let name = inputName ?? field.name
    let stringValue = value == null ? '' : String(value)

    return (
      <label mix={labelStyle}>
        <span>
          {field.label}
          {field.required ? <span mix={css({ color: 'var(--danger)' })}> *</span> : null}
        </span>
        {renderControl(field, value, stringValue, name, blankEnumOption === true)}
        {field.type === 'enumeration' && field.options.length === 0 ? (
          <span mix={hintStyle}>No options defined for this field.</span>
        ) : null}
        {error ? <p mix={errorStyle}>{error}</p> : null}
      </label>
    )
  }
}

function renderControl(
  field: FieldDef,
  value: unknown,
  stringValue: string,
  name: string,
  blankEnumOption: boolean,
) {
  switch (field.type) {
    case 'richtext':
      return <textarea name={name} rows={6} value={stringValue} mix={controlStyle} />


    case 'boolean':
      return (
        <span mix={css({ display: 'inline-flex', alignItems: 'center', gap: '8px' })}>
          <input
            type="checkbox"
            name={name}
            value="on"
            checked={value === true || value === 'true' || value === 'on'}
          />
          <span mix={css({ fontWeight: 400, fontSize: '13px' })}>Enabled</span>
        </span>
      )

    case 'number':
      return <input type="number" name={name} value={stringValue} mix={controlStyle} />

    case 'date':
      return <input type="date" name={name} value={stringValue} mix={controlStyle} />

    case 'email':
      return <input type="email" name={name} value={stringValue} mix={controlStyle} />

    case 'enumeration':
      return (
        <select name={name} mix={controlStyle}>
          {field.required && !blankEnumOption ? null : <option value="">—</option>}
          {field.options.map((option) => (
            <option value={option} selected={option === stringValue}>
              {option}
            </option>
          ))}
        </select>
      )

    case 'text':
    default:
      return <input type="text" name={name} value={stringValue} mix={controlStyle} />
  }
}

interface ComponentFieldGroupProps {
  field: FieldDef
  subFields: FieldDef[]
  value?: unknown
  errors: Record<string, string>
}

// Renders a component field as a grouped fieldset. Single components render
// one group of sub-fields named '<field>.<sub>'; repeatable components render
// every existing item plus two blank item groups (named '<field>.<index>.<sub>').
// Blank groups are skipped when the form is parsed, so leaving them empty is
// safe; saving and re-opening exposes two more blank groups.
export function ComponentFieldGroup(handle: Handle<ComponentFieldGroupProps>) {
  return () => {
    let { field, subFields, value, errors } = handle.props
    let fieldError = errors[field.name]

    return (
      <fieldset mix={fieldsetStyle}>
        <legend mix={legendStyle}>
          {field.label}
          {field.required ? <span mix={css({ color: 'var(--danger)' })}> *</span> : null}
        </legend>

        {fieldError ? <p mix={errorStyle}>{fieldError}</p> : null}

        {subFields.length === 0 ? (
          <span mix={hintStyle}>This component has no fields yet.</span>
        ) : field.repeatable ? (
          renderRepeatable(field, subFields, value, errors)
        ) : (
          renderSingle(field, subFields, value, errors)
        )}
      </fieldset>
    )
  }
}

function renderSingle(
  field: FieldDef,
  subFields: FieldDef[],
  value: unknown,
  errors: Record<string, string>,
) {
  let item = asGroupValue(value)
  return (
    <div mix={groupBodyStyle}>
      {subFields.map((sub) => (
        <FieldInput
          field={sub}
          inputName={`${field.name}.${sub.name}`}
          value={item?.[sub.name]}
          error={errors[`${field.name}.${sub.name}`]}
          blankEnumOption
        />
      ))}
    </div>
  )
}

const BLANK_ITEM_GROUPS = 2

function renderRepeatable(
  field: FieldDef,
  subFields: FieldDef[],
  value: unknown,
  errors: Record<string, string>,
) {
  let items = Array.isArray(value) ? value : []
  let groups: unknown[] = [...items]
  for (let i = 0; i < BLANK_ITEM_GROUPS; i++) groups.push(null)

  return (
    <div mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}>
      <span mix={hintStyle}>
        Blank items are skipped when saving. Save and re-open to add more items.
      </span>
      {groups.map((group, index) => {
        let item = asGroupValue(group)
        return (
          <div mix={itemGroupStyle}>
            <span mix={itemBadgeStyle}>Item {index + 1}</span>
            <div mix={groupBodyStyle}>
              {subFields.map((sub) => (
                <FieldInput
                  field={sub}
                  inputName={`${field.name}.${index}.${sub.name}`}
                  value={item?.[sub.name]}
                  error={errors[`${field.name}.${index}.${sub.name}`]}
                  blankEnumOption
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function asGroupValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

const fieldsetStyle = css({
  margin: 0,
  padding: '14px 16px 16px',
  border: '1px solid var(--border)',
  borderRadius: '10px',
  background: 'var(--surface-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
})

const legendStyle = css({
  padding: '0 6px',
  fontSize: '13px',
  fontWeight: 700,
  color: 'var(--text-primary)',
})

const groupBodyStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
})

const itemGroupStyle = css({
  padding: '12px 14px 14px',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  background: 'var(--surface-1)',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
})

const itemBadgeStyle = css({
  alignSelf: 'flex-start',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-tertiary)',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
})
