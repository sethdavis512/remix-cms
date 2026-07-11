import type { AppDatabase } from './db.ts'
import { users, type UserRow } from './schema.ts'
import { hashPassword } from '../utils/password.ts'

// Admin user accounts. The clean shape never includes password_hash; plaintext
// passwords come in, get hashed here, and only the hash is stored.

export interface User {
  id: number
  email: string
  name: string
  role: string
  createdAt: number
  updatedAt: number
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listUsers(db: AppDatabase): Promise<User[]> {
  let rows = await db.findMany(users, { orderBy: ['created_at', 'asc'] })
  return rows.map(toUser)
}

export async function findUser(db: AppDatabase, id: number): Promise<User | null> {
  let row = await db.find(users, id)
  return row ? toUser(row) : null
}

export async function findUserByEmail(db: AppDatabase, email: string): Promise<User | null> {
  let row = await db.findOne(users, { where: { email } })
  return row ? toUser(row) : null
}

export async function createUser(
  db: AppDatabase,
  input: { email: string; name: string; password: string; role?: string },
): Promise<User> {
  let now = Date.now()
  let created = await db.create(
    users,
    {
      email: input.email,
      name: input.name,
      password_hash: hashPassword(input.password),
      role: input.role ?? 'admin',
      created_at: now,
      updated_at: now,
    },
    { returnRow: true },
  )
  return toUser(created)
}

export async function updateUserPassword(
  db: AppDatabase,
  id: number,
  password: string,
): Promise<void> {
  await db.update(users, id, { password_hash: hashPassword(password), updated_at: Date.now() })
}

export async function deleteUser(db: AppDatabase, id: number): Promise<void> {
  await db.delete(users, id)
}

export async function countUsers(db: AppDatabase): Promise<number> {
  let rows = await db.findMany(users, {})
  return rows.length
}
