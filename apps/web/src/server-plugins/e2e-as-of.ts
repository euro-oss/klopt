import { ensureE2eAsOfServerBridge } from '../lib/e2e-as-of-server-bridge.js'

/**
 * Dev/test-only Nitro plugin.
 *
 * Binds TanStack Start's `getRequestHeader` for `localTodayIso()` e2e overrides.
 * Omitted from production builds in `vite.config.ts`.
 */
export default function e2eAsOfPlugin(): void {
  ensureE2eAsOfServerBridge()
}
