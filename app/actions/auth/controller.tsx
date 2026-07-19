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
        <main mix={pageStyle}>
          <form method="POST" action={routes.auth.login.href()} mix={cardStyle}>
            <div mix={css({ display: 'flex', flexDirection: 'column', gap: '4px' })}>
              <h1 mix={css({ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.02em' })}>
                Remix<span mix={css({ color: '#2dacf9' })}>CMS</span>
              </h1>
              <p mix={css({ margin: 0, fontSize: '14px', color: 'var(--text-tertiary)' })}>
                Sign in to the admin
              </p>
            </div>

            {error ? <p mix={errorStyle}>{error}</p> : null}

            <input type="hidden" name="returnTo" value={returnTo} />

            <label mix={labelStyle}>
              <span>Email</span>
              <input
                type="email"
                name="email"
                value={email}
                autoComplete="username"
                mix={inputStyle}
              />
            </label>

            <label mix={labelStyle}>
              <span>Password</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                mix={inputStyle}
              />
            </label>

            <button type="submit" mix={submitStyle}>
              Sign in
            </button>
          </form>
        </main>
      </Document>
    )
  }
}

const pageStyle = css({
  '--text-primary': '#1c2024',
  '--text-tertiary': '#8b9199',
  '--border': '#dde2e7',
  '--surface': '#ffffff',
  '--page': '#f4f6f8',
  '@media (prefers-color-scheme: dark)': {
    '--text-primary': '#e6e9ec',
    '--text-tertiary': '#8b9199',
    '--border': '#31363c',
    '--surface': '#1e2226',
    '--page': '#16191d',
  },
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
  margin: 0,
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  background: 'var(--page)',
  color: 'var(--text-primary)',
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
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
  background: 'var(--surface)',
})

const labelStyle = css({
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
  padding: '10px 12px',
  borderRadius: '9px',
  border: '1px solid var(--border)',
  background: 'var(--page)',
  color: 'var(--text-primary)',
  '&:focus-visible': { outline: '2px solid #2dacf9', outlineOffset: '1px' },
})

const submitStyle = css({
  font: 'inherit',
  fontSize: '14px',
  fontWeight: 700,
  cursor: 'pointer',
  padding: '11px 16px',
  borderRadius: '9px',
  border: 'none',
  background: '#2dacf9',
  color: '#fff',
  '&:hover': { background: '#1892e0' },
})

const errorStyle = css({
  margin: 0,
  padding: '10px 12px',
  borderRadius: '9px',
  fontSize: '13px',
  fontWeight: 500,
  color: '#e5484d',
  background: 'rgba(229, 72, 77, 0.12)',
  border: '1px solid rgba(229, 72, 77, 0.3)',
})
