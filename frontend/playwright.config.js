import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    // The e2e harness supplies an owned localhost origin.  This inert fallback exists only so
    // `playwright test --list` can discover every project without reaching an arbitrary stack.
    baseURL: process.env.OPENGYM_E2E_BASE_URL || 'http://localhost:1',
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  projects: [
    { name: 'm0-branding-desktop', testMatch: /branding\.spec\.js/, use: { ...devices['Desktop Chrome'], locale: 'en-US' } },
    { name: 'm0-branding-mobile', testMatch: /branding\.spec\.js/, use: { ...devices['Pixel 5'], locale: 'en-US' } },
    { name: 'm1-onboarding-desktop', testMatch: /t9-onboarding\.spec\.js/, use: { ...devices['Desktop Chrome'], locale: 'en-US' } },
    { name: 'm1-onboarding-mobile', testMatch: /t9-onboarding\.spec\.js/, use: { ...devices['Pixel 5'], locale: 'en-US' } },
    { name: 'm1-clinical-desktop', testMatch: /t10-clinical\.spec\.js/, use: { ...devices['Desktop Chrome'], locale: 'en-US' } },
    { name: 'm1-clinical-mobile', testMatch: /t10-clinical\.spec\.js/, use: { ...devices['Pixel 5'], locale: 'en-US' } },
  ],
})
