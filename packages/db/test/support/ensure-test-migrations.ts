import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { runMigrations } from '../../src/migrate.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations')

async function sha256(text: string): Promise<string> {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function listMigrationFiles(): Promise<readonly string[]> {
  return (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Per-file Vitest setup after `globalSetup` has already migrated once.
 *
 * Verifies every migration file is recorded with a matching checksum, without
 * `pg_advisory_lock`, so parallel `beforeAll` hooks do not queue on the lock
 * and exhaust the shared CI Postgres pool (verify #232).
 *
 * Falls back to `runMigrations` only when the database is behind (local test
 * without CI Migrate and without globalSetup).
 */
export async function assertTestMigrationsApplied(databaseUrl: string): Promise<void> {
  const files = await listMigrationFiles()
  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    onnotice: () => undefined,
  })

  let fullyApplied = false

  try {
    const rows = await sql<{ name: string; checksum: string }[]>`
      select name, checksum from klopt_meta.migrations
    `.catch(() => null)

    if (rows !== null && rows.length >= files.length) {
      const appliedChecksums = new Map(rows.map((row) => [row.name, row.checksum]))
      fullyApplied = true
      for (const name of files) {
        const source = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
        const checksum = await sha256(source)
        const previous = appliedChecksums.get(name)
        if (previous === undefined || previous !== checksum) {
          fullyApplied = false
          break
        }
      }
    }
  } finally {
    await sql.end({ timeout: 5 })
  }

  if (!fullyApplied) {
    await runMigrations(databaseUrl)
  }
}
