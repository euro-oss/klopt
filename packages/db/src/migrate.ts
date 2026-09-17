import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

/**
 * Forward-only migrations (spec 12).
 *
 * Not drizzle-kit's migrator, for one reason: drizzle-kit does not model
 * triggers, and the ledger's append-only guarantee, balance check and chain
 * linkage are triggers. Hand-written SQL therefore has to sit alongside
 * generated SQL, and one runner has to apply both in order.
 *
 * Rules this enforces:
 *
 * - Applied in filename order, once each, recorded in klopt.migrations.
 * - Each file runs inside its own transaction. A failure leaves that file
 *   unapplied rather than half-applied.
 * - A file that changed after being applied is a hard error. Editing a
 *   migration that has run somewhere is how two installations quietly diverge;
 *   add another migration instead.
 * - An advisory lock, so two containers starting at once do not race.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

/** Drizzle's separator. Splitting on `;` would break every plpgsql body. */
const STATEMENT_SEPARATOR = '--> statement-breakpoint'

/** Arbitrary but fixed: any Klopt process migrating takes this same lock. */
const ADVISORY_LOCK_KEY = 4207001

export interface MigrationResult {
  readonly applied: readonly string[]
  readonly alreadyApplied: number
}

async function sha256(text: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export async function runMigrations(databaseUrl: string): Promise<MigrationResult> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined })

  try {
    await sql`select pg_advisory_lock(${ADVISORY_LOCK_KEY})`

    // Its own schema, not `klopt`: the bookkeeping table is not part of the
    // administration, and it must not show up in a dump of the books.
    await sql`create schema if not exists klopt_meta`
    await sql`
      create table if not exists klopt_meta.migrations (
        name        text primary key,
        checksum    char(64) not null,
        applied_at  timestamptz not null default now()
      )
    `

    const existing = await sql<{ name: string; checksum: string }[]>`
      select name, checksum from klopt_meta.migrations
    `
    const appliedChecksums = new Map(existing.map((row) => [row.name, row.checksum]))

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b))

    const applied: string[] = []

    for (const name of files) {
      const source = await readFile(join(MIGRATIONS_DIR, name), 'utf8')
      const checksum = await sha256(source)
      const previous = appliedChecksums.get(name)

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${name} changed after it was applied. Migrations are forward-only: ` +
              'add a new one rather than editing this.',
          )
        }
        continue
      }

      const statements = source
        .split(STATEMENT_SEPARATOR)
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0)

      await sql.begin(async (tx) => {
        for (const statement of statements) {
          await tx.unsafe(statement)
        }
        await tx`
          insert into klopt_meta.migrations (name, checksum) values (${name}, ${checksum})
        `
      })

      applied.push(name)
    }

    return { applied, alreadyApplied: appliedChecksums.size }
  } finally {
    await sql`select pg_advisory_unlock(${ADVISORY_LOCK_KEY})`.catch(() => undefined)
    await sql.end({ timeout: 5 })
  }
}
