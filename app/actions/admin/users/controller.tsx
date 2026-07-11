import { randomBytes } from 'node:crypto'

import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { Auth, requireAdmin, type AuthUser } from '../../../middleware/auth.ts'
import { listContentTypes, type ContentType } from '../../../data/content-types.server.ts'
import {
  countUsers,
  createUser,
  deleteUser,
  findUser,
  findUserByEmail,
  listUsers,
  updateUserPassword,
  type User,
} from '../../../data/users.server.ts'
import { logAudit } from '../../../data/audit.server.ts'
import { routes } from '../../../routes.ts'
import {
  AdminShell,
  cardStyle,
  dangerButtonStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
} from '../../../ui/admin-shell.tsx'

// Admin user management: invite users and reset passwords. There is no SMTP,
// so "inviting" generates a random temp password that is flashed through the
// session and shown exactly once; the acting admin passes it along themselves.
// Guards: you cannot delete your own account, and the last user is undeletable.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Unambiguous alphanumerics (no 0/O/1/l/I) for hand-copied temp passwords.
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function generateTempPassword(): string {
  let bytes = randomBytes(16)
  let password = ''
  for (let byte of bytes) password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]
  return password
}

function currentUser(context: { get: (key: typeof Auth) => unknown }): AuthUser | undefined {
  let auth = context.get(Auth) as { ok: boolean; identity: AuthUser } | undefined
  return auth?.ok ? auth.identity : undefined
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default createController(routes.admin.users, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let flash = session.get('message')
      let newPassword = session.get('newPassword')
      let newPasswordFor = session.get('newPasswordFor')
      return context.render(
        <UsersPage
          users={await listUsers(db)}
          contentTypes={await listContentTypes(db)}
          user={currentUser(context)}
          flash={typeof flash === 'string' ? flash : null}
          newPassword={typeof newPassword === 'string' ? newPassword : null}
          newPasswordFor={typeof newPasswordFor === 'string' ? newPasswordFor : null}
        />,
      )
    },

    async create(context) {
      let db = context.get(Database)!
      let formData = context.get(FormData)!
      let name = String(formData.get('name') ?? '').trim()
      let email = String(formData.get('email') ?? '').trim().toLowerCase()

      let error: string | null = null
      if (name === '') {
        error = 'A user needs a name.'
      } else if (!EMAIL_PATTERN.test(email)) {
        error = 'That does not look like a valid email address.'
      } else if (await findUserByEmail(db, email)) {
        error = `A user with the email "${email}" already exists.`
      }

      if (error) {
        return context.render(
          <UsersPage
            users={await listUsers(db)}
            contentTypes={await listContentTypes(db)}
            user={currentUser(context)}
            error={error}
            nameValue={name}
            emailValue={email}
          />,
          { status: 400 },
        )
      }

      let password = generateTempPassword()
      let created = await createUser(db, { email, name, password })
      await logAudit(
        db,
        currentUser(context)?.email ?? 'system',
        'user.created',
        'user',
        created.id,
        `Invited user "${created.email}"`,
      )
      let session = context.get(Session)!
      session.flash('message', `User "${created.email}" created.`)
      // Shown exactly once: the flashes are consumed by the next index render.
      session.flash('newPassword', password)
      session.flash('newPasswordFor', created.email)
      return redirect(routes.admin.users.index.href(), 303)
    },

    async resetPassword(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let id = Number(context.params.userId)
      let user = Number.isInteger(id) ? await findUser(db, id) : null

      if (user) {
        let password = generateTempPassword()
        await updateUserPassword(db, user.id, password)
        await logAudit(
          db,
          currentUser(context)?.email ?? 'system',
          'user.password_reset',
          'user',
          user.id,
          `Reset password for "${user.email}"`,
        )
        session.flash('message', `Password reset for "${user.email}".`)
        session.flash('newPassword', password)
        session.flash('newPasswordFor', user.email)
      }

      return redirect(routes.admin.users.index.href(), 303)
    },

    async destroy(context) {
      let db = context.get(Database)!
      let session = context.get(Session)!
      let id = Number(context.params.userId)
      let user = Number.isInteger(id) ? await findUser(db, id) : null

      if (user) {
        if ((await countUsers(db)) <= 1) {
          session.flash('message', 'The last user cannot be deleted.')
        } else if (user.id === currentUser(context)?.id) {
          session.flash('message', 'You cannot delete your own account.')
        } else {
          await deleteUser(db, user.id)
          await logAudit(
            db,
            currentUser(context)?.email ?? 'system',
            'user.deleted',
            'user',
            user.id,
            `Deleted user "${user.email}"`,
          )
          session.flash('message', `User "${user.email}" deleted.`)
        }
      }

      return redirect(routes.admin.users.index.href(), 303)
    },
  },
})

// ----- Pages -----

interface UsersPageProps {
  users: User[]
  contentTypes: ContentType[]
  user?: AuthUser
  flash?: string | null
  newPassword?: string | null
  newPasswordFor?: string | null
  error?: string
  nameValue?: string
  emailValue?: string
}

function UsersPage(handle: Handle<UsersPageProps>) {
  return () => {
    let {
      users,
      contentTypes,
      user,
      flash,
      newPassword,
      newPasswordFor,
      error,
      nameValue = '',
      emailValue = '',
    } = handle.props

    return (
      <AdminShell
        heading="Users"
        activeNav="users"
        contentTypes={contentTypes}
        user={user}
        flash={flash}
      >
        <div mix={css({ display: 'flex', flexDirection: 'column', gap: '20px' })}>
          {newPassword ? (
            <div mix={newPasswordCardStyle}>
              <p mix={css({ margin: '0 0 8px', fontSize: '14px', fontWeight: 600 })}>
                Temporary password for {newPasswordFor ?? 'the user'}. Copy it now; it will not
                be shown again.
              </p>
              <code mix={newPasswordValueStyle}>{newPassword}</code>
              <p mix={css({ margin: '10px 0 0', fontSize: '13px', color: 'var(--text-tertiary)' })}>
                This CMS does not send email, so share the password with the user yourself.
              </p>
            </div>
          ) : null}

          <div mix={cardStyle}>
            <table mix={tableStyle}>
              <thead>
                <tr>
                  <th mix={thStyle}>Name</th>
                  <th mix={thStyle}>Email</th>
                  <th mix={thStyle}>Created</th>
                  <th mix={thStyle} />
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr>
                    <td mix={tdStyle}>
                      {row.name}
                      {row.id === user?.id ? <span mix={youBadgeStyle}>You</span> : null}
                    </td>
                    <td mix={tdStyle}>{row.email}</td>
                    <td mix={tdStyle}>{formatWhen(row.createdAt)}</td>
                    <td mix={tdActionsStyle}>
                      <div
                        mix={css({
                          display: 'flex',
                          gap: '8px',
                          justifyContent: 'flex-end',
                          flexWrap: 'wrap',
                        })}
                      >
                        <form
                          method="POST"
                          action={routes.admin.users.resetPassword.href({
                            userId: String(row.id),
                          })}
                        >
                          <button type="submit" mix={smallSecondaryButtonStyle}>
                            Reset password
                          </button>
                        </form>
                        {row.id === user?.id ? null : (
                          <form
                            method="POST"
                            action={routes.admin.users.destroy.href({
                              userId: String(row.id),
                            })}
                          >
                            <button type="submit" mix={dangerButtonStyle}>
                              Delete
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div mix={cardStyle}>
            <h2 mix={css({ margin: '0 0 12px', fontSize: '15px' })}>Invite a user</h2>
            {error ? <p mix={formErrorStyle}>{error}</p> : null}
            <form
              method="POST"
              action={routes.admin.users.create.href()}
              mix={css({ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' })}
            >
              <label mix={fieldLabelStyle}>
                <span>Name</span>
                <input
                  type="text"
                  name="name"
                  value={nameValue}
                  placeholder="Casey Editor"
                  mix={inputStyle}
                />
              </label>
              <label mix={fieldLabelStyle}>
                <span>Email</span>
                <input
                  type="text"
                  name="email"
                  value={emailValue}
                  placeholder="casey@example.com"
                  mix={[inputStyle, css({ minWidth: '240px' })]}
                />
              </label>
              <button type="submit" mix={primaryButtonStyle}>
                Invite user
              </button>
            </form>
            <p mix={css({ margin: '10px 0 0', fontSize: '13px', color: 'var(--text-tertiary)' })}>
              Inviting creates the account with a random temporary password shown once on this
              page. No email is sent; pass the password along yourself and use "Reset password"
              if it gets lost.
            </p>
          </div>
        </div>
      </AdminShell>
    )
  }
}

// ----- Styles -----

const tableStyle = css({ width: '100%', borderCollapse: 'collapse', fontSize: '14px' })
const thStyle = css({
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: '12px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-tertiary)',
  borderBottom: '1px solid var(--border)',
})
const tdStyle = css({ padding: '12px', borderBottom: '1px solid var(--border)' })
const tdActionsStyle = css({
  padding: '12px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'right',
})

const youBadgeStyle = css({
  marginLeft: '8px',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '11px',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--brand)',
  background: 'var(--surface-2)',
})

const smallSecondaryButtonStyle = [
  secondaryButtonStyle,
  css({ fontSize: '13px', padding: '7px 12px' }),
]

const fieldLabelStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '13px',
  fontWeight: 600,
})

const inputStyle = css({
  font: 'inherit',
  fontWeight: 400,
  fontSize: '14px',
  padding: '9px 11px',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  background: 'var(--surface-input)',
  color: 'var(--text-primary)',
})

const formErrorStyle = css({
  margin: '0 0 12px',
  padding: '12px 16px',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--danger)',
  background: 'var(--danger-soft)',
  border: '1px solid var(--danger)',
})

const newPasswordCardStyle = css({
  background: 'var(--surface-1)',
  border: '1px solid var(--brand)',
  borderRadius: '14px',
  padding: '20px',
})

const newPasswordValueStyle = css({
  display: 'block',
  padding: '10px 12px',
  borderRadius: '8px',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  fontFamily: 'ui-monospace, monospace',
  fontSize: '13px',
  wordBreak: 'break-all',
  userSelect: 'all',
})
