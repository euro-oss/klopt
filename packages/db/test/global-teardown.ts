import { teardownAuditReleaseMatchBlockTrigger } from './support/audit-release-match-block-ddl.js'

const databaseUrl =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

export default async function globalTeardown(): Promise<void> {
  await teardownAuditReleaseMatchBlockTrigger(databaseUrl)
}
