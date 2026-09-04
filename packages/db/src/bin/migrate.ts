import { runMigrations } from '../migrate.js'

const databaseUrl = process.env['DATABASE_URL']
if (databaseUrl === undefined || databaseUrl === '') {
  console.error('[migrate] DATABASE_URL is not set.')
  process.exit(1)
}

try {
  const result = await runMigrations(databaseUrl)
  if (result.applied.length === 0) {
    console.info(`[migrate] up to date (${String(result.alreadyApplied)} applied)`)
  } else {
    for (const name of result.applied) console.info(`[migrate] applied ${name}`)
  }
} catch (error: unknown) {
  console.error('[migrate] failed', error)
  process.exit(1)
}
