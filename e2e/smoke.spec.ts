import { expect, test } from '@playwright/test'

// Default admin created by `db/seed.ts` when ADMIN_EMAIL / ADMIN_PASSWORD are unset.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'password123'

test.describe('smoke', () => {
  test('public home page renders', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle(/RemixCMS/)
    await expect(page.getByRole('heading', { level: 1, name: /RemixCMS/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Sign in/ })).toBeVisible()
  })

  test('admin requires authentication', async ({ page }) => {
    await page.goto('/admin')

    // requireAdmin bounces unauthenticated requests to the login form.
    await expect(page).toHaveURL(/\/auth\/login/)
    await expect(page.getByRole('button', { name: /Sign in/ })).toBeVisible()
  })

  test('admin can sign in and reach the dashboard', async ({ page }) => {
    await page.goto('/auth/login')

    await page.getByLabel('Email').fill(ADMIN_EMAIL)
    await page.getByLabel('Password').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: /Sign in/ }).click()

    await expect(page).toHaveURL(/\/admin\/?$/)
    await expect(page.getByRole('heading', { name: /Dashboard/ })).toBeVisible()
    await expect(page.getByText(/Welcome to Remix CMS/)).toBeVisible()
  })

  test('public JSON API responds', async ({ request }) => {
    // Unknown content types 404 as JSON; a well-formed error still proves the
    // API surface is wired up and serving JSON.
    const response = await request.get('/api/does-not-exist')
    expect(response.headers()['content-type']).toContain('application/json')
    expect([200, 404]).toContain(response.status())
  })
})
