import { execFileSync } from 'node:child_process'
import { readdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `drizzle-kit generate`, then renumber.
 *
 * drizzle-kit picks the next migration index from its own `meta/_journal.json`,
 * which knows nothing about the hand-written trigger migrations sitting in the
 * same directory. Left alone it produces `0001_x.sql` next to an existing
 * `0001_ledger_guards.sql`, and the runner — which orders by filename — then
 * applies them in whichever order the names happen to sort.
 *
 * So the generated file is renamed to the next free index across *all* the SQL
 * in the directory. drizzle's journal keeps its own numbering, which is fine:
 * nothing reads it except drizzle, and only to decide what to call the next one.
 *
 * The alternative — remembering to rename by hand — is the kind of instruction
 * that works until the day it matters.
 */

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations')
const PATTERN = /^(\d{4})_(.+)\.sql$/

function indices(): number[] {
  return readdirSync(MIGRATIONS)
    .map((name) => PATTERN.exec(name)?.[1])
    .filter((index): index is string => index !== undefined)
    .map(Number)
}

const before = new Set(readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')))
const nextFree = Math.max(-1, ...indices()) + 1

execFileSync('npx', ['--no-install', 'drizzle-kit', 'generate', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: join(MIGRATIONS, '..'),
})

const created = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql') && !before.has(name))

if (created.length === 0) {
  console.info('[generate] no schema changes')
  process.exit(0)
}
if (created.length > 1) {
  throw new Error(`Expected one new migration, got ${created.join(', ')}.`)
}

const generated = created[0]!
const match = PATTERN.exec(generated)
if (match === null) throw new Error(`Cannot parse generated migration name ${generated}.`)

const renamed = `${String(nextFree).padStart(4, '0')}_${match[2]!}.sql`
if (renamed !== generated) {
  renameSync(join(MIGRATIONS, generated), join(MIGRATIONS, renamed))
}

console.info(`[generate] ${renamed}`)
console.info('[generate] review it, then apply with: pnpm --filter @klopt/db run migrate')
