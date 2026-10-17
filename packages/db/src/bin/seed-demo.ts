/**
 * Operator command: seed the fictional Demo BV (issue #48).
 *
 * Same shape as `migrate` — a db-package bin, because the CLI has no database
 * handle by rule. Never runs automatically.
 *
 *   DATABASE_URL=… node packages/db/dist/bin/seed-demo.js
 *   DATABASE_URL=… node packages/db/dist/bin/seed-demo.js --invite accountant@example.nl --role accountant
 *   DATABASE_URL=… node packages/db/dist/bin/seed-demo.js --invite owner@example.nl --role eigenaar
 */

import { closeDatabase, createDatabase } from '../client.js'
import { seedDemo } from '../demo/seed.js'
import { runMigrations } from '../migrate.js'

function usage(): never {
  console.error(`Usage: seed-demo [--invite <email>] [--role <role>] [--entity <uuid>]

Creates (or re-affirms) the singleton fictional Demo BV. Optional --invite
adds that address with the given role (owner/eigenaar, bookkeeper/boekhouder,
accountant, auditor/controleur). Refuses to write into an administration that
is not marked demo.`)
  process.exit(2)
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index === -1) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) usage()
  return value
}

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) usage()

const unknown = argv.filter(
  (item, index) =>
    item.startsWith('--') &&
    !['--invite', '--role', '--entity', '--help', '-h'].includes(item) &&
    (index === 0 || !['--invite', '--role', '--entity'].includes(argv[index - 1]!)),
)
if (unknown.length > 0) {
  console.error(`[seed-demo] unknown flag: ${unknown[0]}`)
  usage()
}

const databaseUrl = process.env['DATABASE_URL']
if (databaseUrl === undefined || databaseUrl === '') {
  console.error('[seed-demo] DATABASE_URL is not set.')
  process.exit(1)
}

const invite = argValue(argv, '--invite')
const role = argValue(argv, '--role')
const entityId = argValue(argv, '--entity')

if (role !== undefined && invite === undefined) {
  console.error('[seed-demo] --role requires --invite.')
  process.exit(2)
}

try {
  await runMigrations(databaseUrl)
  const database = createDatabase({ url: databaseUrl })
  try {
    const result = await seedDemo(database, {
      inviteEmail: invite,
      inviteRole: role,
      entityId,
    })

    if (result.created) {
      console.info(`[seed-demo] created ${result.name} (${result.entityId})`)
    } else if (result.seeded) {
      console.info(`[seed-demo] seeded existing demo ${result.name} (${result.entityId})`)
    } else {
      console.info(`[seed-demo] demo already present: ${result.name} (${result.entityId})`)
    }

    console.info(
      `[seed-demo] contacts=${String(result.counts.contacts)} sales=${String(result.counts.salesInvoices)} purchases=${String(result.counts.purchaseInvoices)} entries=${String(result.counts.journalEntries)} bank=${String(result.counts.bankTransactions)} (matched ${String(result.counts.bankMatched)}, open ${String(result.counts.bankUnmatched)}) filedPeriods=${String(result.counts.filedPeriods)}`,
    )
    console.info(
      `[seed-demo] trialBalanceDifference=${result.trialBalanceDifference} chainVerified=${String(result.chainVerified)}`,
    )

    if (result.invite !== null) {
      console.info(
        `[seed-demo] invite ${result.invite.email} as ${result.invite.role}` +
          (result.invite.joinedImmediately ? ' (joined immediately)' : ' (pending)'),
      )
    }

    if (result.trialBalanceDifference !== '0' || !result.chainVerified) {
      console.error('[seed-demo] books did not verify after seeding.')
      process.exit(1)
    }
  } finally {
    await closeDatabase(database)
  }
} catch (error: unknown) {
  console.error('[seed-demo] failed', error)
  process.exit(1)
}
