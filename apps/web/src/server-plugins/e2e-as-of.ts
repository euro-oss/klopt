/**
 * Dev/test-only Nitro plugin placeholder.
 *
 * E2e as-of is read per request from `X-Klopt-E2e-As-Of` inside
 * `localTodayIso()` via TanStack Start's `getRequestHeader` (see
 * `local-clock.ts`). This plugin is omitted from production builds in
 * `vite.config.ts` so production Nitro never registers e2e hooks.
 */
export default function e2eAsOfPlugin(): void {
  // Intentionally empty — kept so dev/e2e builds can extend the chain later.
}
