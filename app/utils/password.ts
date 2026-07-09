import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// Password hashing with scrypt from node:crypto. Format: scrypt$<saltHex>$<hashHex>.
// scrypt is CPU-bound and synchronous, which is fine for interactive admin logins.

const KEY_LENGTH = 64

export function hashPassword(password: string): string {
  let salt = randomBytes(16)
  let derived = scryptSync(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  let [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false

  let salt = Buffer.from(saltHex, 'hex')
  let expected = Buffer.from(hashHex, 'hex')
  let derived = scryptSync(password, salt, expected.length)

  return derived.length === expected.length && timingSafeEqual(derived, expected)
}
