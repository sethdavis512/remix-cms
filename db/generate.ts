import { DatabaseSync } from 'node:sqlite'

import { checkbox, confirm, number } from '@inquirer/prompts'
import { createDatabase } from 'remix/data-table'
import { createSqliteDatabaseAdapter } from 'remix/data-table/sqlite'

import {
  createContentType,
  findContentTypeByApiId,
  type ContentType,
} from '../app/data/content-types.server.ts'
import { createEntry, listEntries, publishEntry } from '../app/data/entries.server.ts'
import { createComponent, findComponentByApiId } from '../app/data/components.server.ts'
import { createRelease, addReleaseItem } from '../app/data/releases.server.ts'
import { createApiToken } from '../app/data/api-tokens.server.ts'
import { createUser, findUserByEmail } from '../app/data/users.server.ts'
import { slugify, pluralize, type FieldDef } from '../app/utils/fields.ts'
import type { AppDatabase } from '../app/data/db.ts'

// Interactive seed/data generator. Pick what to create and how much; everything
// is written to the local sqlite. Run `npm run db:migrate` first so the tables
// exist. Usage:
//   npm run db:generate                 # interactive
//   npm run db:generate -- --all -y      # non-interactive, generate everything
//   npm run db:generate -- --only=blog,token --count=10 -y

// ----- CLI args -----

let argv = process.argv.slice(2)
let hasFlag = (name: string) => argv.includes(`--${name}`) || argv.includes(`-${name[0]}`)
let getOpt = (name: string) => {
  let hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
let nonInteractive = hasFlag('yes') || hasFlag('non-interactive') || hasFlag('all')
let onlyArg = getOpt('only')
let countArg = getOpt('count')

// ----- Sample data helpers -----

const FIRST = ['Ada', 'Alan', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Guido']
const LAST = ['Lovelace', 'Turing', 'Hopper', 'Torvalds', 'Hamilton', 'Ritchie', 'Liskov', 'Thompson', 'Perlman', 'van Rossum']
const NOUNS = ['pipeline', 'gateway', 'schema', 'runtime', 'cache', 'protocol', 'cluster', 'toolkit', 'framework', 'compiler']
const ADJ = ['resilient', 'declarative', 'headless', 'composable', 'typed', 'reactive', 'atomic', 'ergonomic']

let pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!
let pickN = <T>(list: T[], n: number): T[] => {
  let pool = [...list]
  let out: T[] = []
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!)
  return out
}
let titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
let personName = () => `${pick(FIRST)} ${pick(LAST)}`
let phrase = () => `${titleCase(pick(ADJ))} ${pick(NOUNS)}`
let paragraph = () =>
  Array.from({ length: 3 }, () => `The ${pick(ADJ)} ${pick(NOUNS)} keeps the ${pick(NOUNS)} ${pick(ADJ)}.`).join(' ')

// Build a plausible value for one field. `refs` maps a target api id to the
// entry ids available to satisfy relation fields.
function sampleValue(field: FieldDef, index: number, refs: Record<string, number[]>): unknown {
  switch (field.type) {
    case 'text':
      return /name/i.test(field.name) ? personName() : `${phrase()} ${index + 1}`
    case 'richtext':
      return paragraph()
    case 'number':
      return Math.floor(Math.random() * 1000)
    case 'boolean':
      return index % 2 === 0
    case 'date':
      return new Date(Date.now() - Math.floor(Math.random() * 90) * 86_400_000).toISOString().slice(0, 10)
    case 'email':
      return `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase().replace(/\s+/g, '')}@example.com`
    case 'enumeration':
      return field.options.length ? pick(field.options) : ''
    case 'media':
      return null
    case 'component':
      return field.repeatable ? [] : null
    case 'relation': {
      let pool = refs[field.target ?? ''] ?? []
      if (pool.length === 0) return field.repeatable ? [] : null
      return field.repeatable ? pickN(pool, Math.min(2, pool.length)) : pick(pool)
    }
    default:
      return null
  }
}

// ----- Field + type presets -----

let f = (name: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}): FieldDef => ({
  name: slugify(name),
  label: name,
  type,
  required: false,
  unique: false,
  options: [],
  ...extra,
})

interface TypePreset {
  name: string
  kind: 'collection' | 'single'
  fields: FieldDef[]
}

// Blog model: Authors and Categories are created first so Articles can point at
// real entry ids through their relation fields.
const BLOG_TYPES: TypePreset[] = [
  {
    name: 'Author',
    kind: 'collection',
    fields: [f('Name', 'text', { required: true }), f('Bio', 'richtext'), f('Email', 'email')],
  },
  {
    name: 'Category',
    kind: 'collection',
    fields: [f('Title', 'text', { required: true, unique: true }), f('Slug', 'text')],
  },
  {
    name: 'Article',
    kind: 'collection',
    fields: [
      f('Title', 'text', { required: true }),
      f('Body', 'richtext'),
      f('Published', 'boolean'),
      f('Author', 'relation', { target: 'author' }),
      f('Categories', 'relation', { target: 'category', repeatable: true }),
    ],
  },
]

const COMPONENT_PRESETS: { name: string; fields: FieldDef[] }[] = [
  { name: 'SEO', fields: [f('Meta title', 'text'), f('Meta description', 'text'), f('OG image', 'media')] },
  { name: 'Hero', fields: [f('Heading', 'text'), f('Subheading', 'text'), f('CTA label', 'text')] },
]

// ----- Generators -----

// Create a content type if its api id is free, otherwise reuse the existing one
// so re-running the generator never trips the unique api_id constraint.
async function ensureType(db: AppDatabase, preset: TypePreset): Promise<ContentType> {
  let apiId = slugify(preset.name)
  let existing = await findContentTypeByApiId(db, apiId)
  if (existing) return existing
  return createContentType(db, {
    name: preset.name,
    apiId,
    apiIdPlural: pluralize(apiId),
    kind: preset.kind,
    fields: preset.fields,
  })
}

async function generateBlog(db: AppDatabase, count: number, log: string[]) {
  let refs: Record<string, number[]> = {}
  for (let preset of BLOG_TYPES) {
    let type = await ensureType(db, preset)
    let created: number[] = []
    for (let i = 0; i < count; i++) {
      let entry = await createEntry(db, type.id, buildData(preset.fields, i, refs))
      // Publish roughly half so the API and dashboard show published counts.
      if (i % 2 === 0) await publishEntry(db, entry.id)
      created.push(entry.id)
    }
    refs[type.apiId] = created
    log.push(`  ${count} ${type.name} entries (${Math.ceil(count / 2)} published)`)
  }
}

function buildData(fields: FieldDef[], index: number, refs: Record<string, number[]>) {
  let data: Record<string, unknown> = {}
  for (let field of fields) data[field.name] = sampleValue(field, index, refs)
  return data
}

async function generateComponents(db: AppDatabase, log: string[]) {
  for (let preset of COMPONENT_PRESETS) {
    let apiId = slugify(preset.name)
    if (await findComponentByApiId(db, apiId)) {
      log.push(`  component "${preset.name}" already exists, skipped`)
      continue
    }
    await createComponent(db, { name: preset.name, apiId, fields: preset.fields })
    log.push(`  component "${preset.name}"`)
  }
}

async function generateUser(db: AppDatabase, log: string[]) {
  let email = 'editor@example.com'
  if (await findUserByEmail(db, email)) {
    log.push(`  user ${email} already exists, skipped`)
    return
  }
  await createUser(db, { email, name: 'Editor', password: 'password123', role: 'admin' })
  log.push(`  user ${email} (password: password123)`)
}

async function generateToken(db: AppDatabase, log: string[]) {
  let { plaintext } = await createApiToken(db, 'Seed token')
  log.push(`  API token "Seed token": ${plaintext}`)
}

async function generateRelease(db: AppDatabase, log: string[]) {
  let release = await createRelease(db, 'Spring launch', null)
  // Stage up to 3 existing entries to publish with the release.
  let articles = await findContentTypeByApiId(db, 'article')
  let staged = 0
  if (articles) {
    let entries = await listEntries(db, articles.id)
    for (let entry of entries.slice(0, 3)) {
      await addReleaseItem(db, release.id, entry.id, 'publish')
      staged++
    }
  }
  log.push(`  release "Spring launch" (${staged} entries staged)`)
}

// ----- Menu -----

const CHOICES = [
  { name: 'Blog content model (Authors, Categories, Articles) + entries', value: 'blog' },
  { name: 'Reusable components (SEO, Hero)', value: 'components' },
  { name: 'An extra admin user (editor@example.com)', value: 'user' },
  { name: 'An API token', value: 'token' },
  { name: 'A content release (stages a few entries)', value: 'release' },
] as const

type Choice = (typeof CHOICES)[number]['value']

async function selectWhat(): Promise<Choice[]> {
  if (nonInteractive) {
    if (onlyArg) return onlyArg.split(',').map((s) => s.trim()) as Choice[]
    return CHOICES.map((c) => c.value)
  }
  return checkbox<Choice>({
    message: 'What do you want to generate?',
    choices: CHOICES.map((c) => ({ name: c.name, value: c.value, checked: true })),
  })
}

async function selectCount(): Promise<number> {
  if (nonInteractive) return countArg ? Number(countArg) || 5 : 5
  return (await number({ message: 'How many entries per content type?', default: 5, min: 0, max: 500 })) ?? 5
}

// ----- Main -----

let dbPath = process.env.DATABASE_PATH ?? './db/app.sqlite'

async function main() {
  let what = await selectWhat()
  if (what.length === 0) {
    console.log('Nothing selected. Exiting.')
    return
  }
  let count = what.includes('blog') ? await selectCount() : 0

  if (!nonInteractive) {
    let ok = await confirm({ message: `Write generated data to ${dbPath}?`, default: true })
    if (!ok) {
      console.log('Aborted.')
      return
    }
  }

  let sqlite = new DatabaseSync(dbPath)
  sqlite.exec('PRAGMA foreign_keys = ON')
  let db = createDatabase(createSqliteDatabaseAdapter(sqlite))

  let log: string[] = []
  // Order matters: components and blog types first, release last (it stages
  // the entries created by the blog step).
  if (what.includes('components')) await generateComponents(db, log)
  if (what.includes('blog')) await generateBlog(db, count, log)
  if (what.includes('user')) await generateUser(db, log)
  if (what.includes('token')) await generateToken(db, log)
  if (what.includes('release')) await generateRelease(db, log)

  console.log('\nGenerated:')
  for (let line of log) console.log(line)
  console.log('\nDone.')
}

main().catch((error) => {
  // Inquirer throws ExitPromptError on Ctrl-C; treat that as a clean cancel.
  if (error && (error as { name?: string }).name === 'ExitPromptError') {
    console.log('\nCancelled.')
    return
  }
  if (error instanceof Error && /no such table/i.test(error.message)) {
    console.error('\nTables are missing. Run `npm run db:migrate` first, then retry.')
    process.exitCode = 1
    return
  }
  console.error(error)
  process.exitCode = 1
})
