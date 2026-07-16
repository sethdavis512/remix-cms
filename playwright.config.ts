import { defineConfig, devices } from '@playwright/test'

// End-to-end tests drive a real, running server with a real browser. This is a
// separate suite from the `node --test` integration tests (which call
// `router.fetch` in-process); keep the two apart so `npm test` stays fast and
// browser-free. Run these with `npm run test:e2e`.
const PORT = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 44100
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Boot the app for the suite. Locally this reuses an already-running dev
  // server; in CI it migrates, seeds the default admin, then starts the app.
  // SESSION_SECRET is read from .env by the underlying npm scripts.
  webServer: {
    command: 'npm run db:migrate up && npm run db:seed && npm run start',
    url: baseURL,
    // server.ts binds process.env.PORT; keep the started server on the port the
    // suite polls so a fresh boot and baseURL agree.
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
