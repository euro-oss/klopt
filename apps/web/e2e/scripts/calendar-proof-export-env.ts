/**
 * Prints `export KEY=...` lines for bash `eval`, matching Playwright webServer env.
 * Usage: eval "$(pnpm exec tsx e2e/scripts/calendar-proof-export-env.ts 2027-01-01)"
 */
import { e2eWebServerEnv } from '../server-env.js'

const date = process.argv[2]
if (date === undefined || date === '') {
  console.error('calendar-proof-export-env: expected YYYY-MM-DD argument')
  process.exit(1)
}

const env = e2eWebServerEnv({ ...process.env, KLOPT_E2E_TODAY_ISO: date })
for (const [key, value] of Object.entries(env)) {
  process.stdout.write(`export ${key}=${JSON.stringify(value)}\n`)
}
