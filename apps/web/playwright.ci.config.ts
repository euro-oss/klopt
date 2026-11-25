import { defineConfig } from '@playwright/test'
import base from './playwright.config.js'
import { E2E_BUILT_HTTPS_ORIGIN } from './e2e/server-env'

const pointingAtExternalServer = process.env['KLOPT_E2E_BASE_URL'] !== undefined

/**
 * CI main-suite shards: production bundle over self-signed `https://localhost`.
 * Local `pnpm test:e2e` keeps the default `playwright.config.ts` (vite dev).
 *
 * Set `KLOPT_E2E_BUILT_SERVER=1` when invoking this config locally (see
 * `e2e/README.md`).
 */
export default defineConfig({
  ...base,
  use: {
    ...base.use,
    baseURL: process.env['KLOPT_E2E_BASE_URL'] ?? E2E_BUILT_HTTPS_ORIGIN,
    ignoreHTTPSErrors: true,
  },
  ...(pointingAtExternalServer
    ? {}
    : {
        webServer: {
          command: 'pnpm exec tsx e2e/scripts/built-server-webserver.ts',
          url: `${E2E_BUILT_HTTPS_ORIGIN}/api/v1/health`,
          ignoreHTTPSErrors: true,
          stdout: 'pipe',
          stderr: 'pipe',
          reuseExistingServer: false,
          timeout: 180_000,
        },
      }),
})
