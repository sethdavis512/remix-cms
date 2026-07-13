import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { parseFieldDefs } from './fields.ts'

// The Content-Type Builder submits one set of same-named `field_*` inputs per
// row; parseFieldDefs reads them as parallel arrays indexed by DOM position, so
// alignment must survive rows that the client added or removed. A removed row
// drops one value from every array at once (arrays shrink together), and a row
// whose name is blank is skipped without shifting the rows around it.

function builderForm(rows: Array<Record<string, string>>): FormData {
  let keys = [
    'field_name',
    'field_label',
    'field_type',
    'field_required',
    'field_unique',
    'field_options',
  ]
  let fd = new FormData()
  for (let row of rows) {
    for (let key of keys) fd.append(key, row[key] ?? '')
  }
  return fd
}

describe('parseFieldDefs', () => {
  it('keeps rows aligned when a blank-name row sits between real rows', () => {
    // The middle row (blank name) is skipped; the third row's values must still
    // map to the third row, not leak in from the skipped one.
    let fields = parseFieldDefs(
      builderForm([
        { field_name: 'title', field_label: 'Title', field_type: 'text', field_required: 'no', field_unique: 'yes' },
        { field_name: '', field_label: '', field_type: 'text', field_required: 'yes', field_unique: 'no' },
        { field_name: 'body', field_label: 'Body', field_type: 'richtext', field_required: 'yes', field_unique: 'no' },
      ]),
    )

    assert.equal(fields.length, 2)
    assert.deepEqual(fields[0], {
      name: 'title',
      label: 'Title',
      type: 'text',
      required: false,
      unique: true,
      options: [],
    })
    assert.deepEqual(fields[1], {
      name: 'body',
      label: 'Body',
      type: 'richtext',
      required: true,
      unique: false,
      options: [],
    })
  })

  it('ignores trailing blank rows left by the seed/added rows', () => {
    let fields = parseFieldDefs(
      builderForm([
        { field_name: 'title', field_label: 'Title', field_type: 'text' },
        { field_name: '', field_label: '', field_type: 'text' },
        { field_name: '', field_label: '', field_type: 'enumeration' },
      ]),
    )

    assert.equal(fields.length, 1)
    assert.equal(fields[0]!.name, 'title')
  })

  it('parses enumeration options only where present, staying aligned', () => {
    let fields = parseFieldDefs(
      builderForm([
        { field_name: 'status', field_type: 'enumeration', field_options: 'draft, published' },
        { field_name: 'body', field_type: 'text', field_options: '' },
      ]),
    )

    assert.deepEqual(fields[0]!.options, ['draft', 'published'])
    assert.deepEqual(fields[1]!.options, [])
    assert.equal(fields[1]!.type, 'text')
  })
})
