import { test } from '@playwright/test'

/**
 * Design shots for #201 are captured from the passing pending-state e2e:
 *
 *   CAPTURE_PR_SCREENSHOTS=1 PR_SCREENSHOT_NUMBER=201 \
 *     pnpm --filter @klopt/web exec playwright test e2e/import-wizard-next-pending.spec.ts
 *
 * PNGs land in `docs/pr-screenshots/201/` with tEXt Source
 * `apps/web/e2e/import-wizard-next-pending.spec.ts`.
 */

test.skip(true, 'Capture via e2e/import-wizard-next-pending.spec.ts (CAPTURE_PR_SCREENSHOTS=1)')
