import { runMigrations } from '../src/migrate.js'
import { installAuditReleaseMatchBlockTrigger } from './support/audit-release-match-block-ddl.js'

const databaseUrl =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

/**
 * Runs once before any db/web worker starts so parallel `beforeAll` hooks do
 * not race on first migrate. Heavy web/db suites rely on this setup only.
 *
 * Also installs the GUC-gated `bank.releaseMatch` audit block trigger used by
 * `matching.test.ts` (no per-test DDL on klopt.audit_log during the suite).
 */
export default async function globalSetup(): Promise<void> {
  await runMigrations(databaseUrl)
  await installAuditReleaseMatchBlockTrigger(databaseUrl)
}
