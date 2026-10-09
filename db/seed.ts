import { db } from '../app/data/db.ts'
import { users } from '../app/data/schema.ts'
import { hashPassword } from '../app/utils/password.ts'

// Creates the first admin user from env vars.
// Usage: ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret node --import remix/node-tsx db/seed.ts

let email = process.env.ADMIN_EMAIL ?? 'admin@example.com'
let password = process.env.ADMIN_PASSWORD ?? 'password123'
let name = process.env.ADMIN_NAME ?? 'Admin'

let existing = await db.findOne(users, { where: { email } })
if (existing) {
  console.log(`Admin already exists: ${email}`)
} else {
  let now = Date.now()
  await db.create(users, {
    email,
    name,
    password_hash: hashPassword(password),
    role: 'admin',
    created_at: now,
    updated_at: now,
  })
  console.log(`Created admin: ${email}`)
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`  Using default password: ${password} (set ADMIN_PASSWORD to change)`)
  }
}
