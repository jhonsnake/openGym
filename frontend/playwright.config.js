import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  outputDir: './artifacts/branding/browser',
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4187', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4187 --strictPort', url: 'http://127.0.0.1:4187', reuseExistingServer: false },
})
