import { createController } from 'remix/router'
import { Database } from 'remix/data-table'
import { Session } from 'remix/session'
import { redirect } from 'remix/response/redirect'
import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { users } from '#app/data/schema.ts'
import { verifyPassword } from '#app/utils/password.ts'
import { routes } from '#app/routes.ts'
import { Document } from '#app/ui/document.tsx'
import { primaryButtonStyle, themeStyle } from '#app/ui/admin-shell.tsx'
import { fieldLabelStyle, formErrorStyle, inputStyle } from '#app/ui/primitives.tsx'

const loginSchema = f.object({
  email: f.field(s.defaulted(s.string(), '')),
  password: f.field(s.defaulted(s.string(), '')),
  returnTo: f.field(s.defaulted(s.string(), '')),
})

// Only allow same-origin absolute paths as a post-login redirect target.
function safeReturnTo(value: string): string {
  if (value.startsWith('/') && !value.startsWith('//')) return value
  return routes.admin.index.href()
}

export default createController(routes.auth, {
  actions: {
    loginForm(context) {
      let returnTo = context.url.searchParams.get('returnTo') ?? ''
      return context.render(<LoginPage returnTo={returnTo} />)
    },

    async login(context) {
      let { email, password, returnTo } = s.parse(loginSchema, context.get(FormData))
      email = email.trim().toLowerCase()

      if (email === '' || password === '') {
        return context.render(
          <LoginPage email={email} returnTo={returnTo} error="Email and password are required." />,
          { status: 400 },
        )
      }

      let db = context.get(Database)!
      let user = await db.findOne(users, { where: { email } })

      if (!user || !verifyPassword(password, user.password_hash)) {
        return context.render(
          <LoginPage email={email} returnTo={returnTo} error="Invalid email or password." />,
          { status: 401 },
        )
      }

      let session = context.get(Session)!
      session.regenerateId(true)
      session.set('auth', { userId: user.id })

      return redirect(safeReturnTo(returnTo), 303)
    },

    logout(context) {
      let session = context.get(Session)!
      session.unset('auth')
      session.regenerateId(true)
      return redirect(routes.auth.loginForm.href(), 303)
    },
  },
})

function LoginPage(handle: Handle<{ email?: string; returnTo?: string; error?: string }>) {
  return () => {
    let { email = '', returnTo = '', error } = handle.props

    return (
      <Document title="Sign in · Remix CMS">
        <main mix={[themeStyle, pageStyle]}>
          <form method="POST" action={routes.auth.login.href()} mix={cardStyle}>
            <div mix={css({ display: 'flex', flexDirection: 'column', gap: '4px' })}>
              <h1 mix={css({ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em' })}>
                Remix<span mix={css({ color: 'var(--brand)' })}>CMS</span>
              </h1>
              <p mix={css({ margin: 0, fontSize: '14px', color: 'var(--text-tertiary)' })}>
                Sign in to the admin
              </p>
            </div>

            {error ? (
              <p role="alert" mix={[formErrorStyle, css({ margin: 0 })]}>
                {error}
              </p>
            ) : null}

            <input type="hidden" name="returnTo" value={returnTo} />

            <label mix={fieldLabelStyle}>
              <span>Email</span>
              <input
                type="email"
                name="email"
                value={email}
                required
                autoComplete="username"
                mix={inputStyle}
              />
            </label>

            <label mix={fieldLabelStyle}>
              <span>Password</span>
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                mix={inputStyle}
              />
            </label>

            <button
              type="submit"
              mix={[primaryButtonStyle, css({ justifyContent: 'center', width: '100%' })]}
            >
              Sign in
            </button>
          </form>
        </main>
      </Document>
    )
  }
}

// Layout only: the shared admin themeStyle (mixed alongside this on the root)
// carries the palette, font stack, and box-sizing reset.
const pageStyle = css({
  margin: 0,
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
})

const cardStyle = css({
  width: '100%',
  maxWidth: '360px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  padding: '28px',
  borderRadius: '16px',
  border: '1px solid var(--border)',
  background: 'var(--surface-1)',
  boxShadow: 'var(--shadow-md)',
})
