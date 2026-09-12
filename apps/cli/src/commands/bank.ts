import { readFileSync } from 'node:fs'
import type { Command } from './registry.js'
import { flagOf, optionOf, requireOption } from './registry.js'

/**
 * Importing a statement (spec 10.4).
 *
 * A dry run by default, which is the opposite of what a CLI usually does and
 * is right here. The import screen is two steps on purpose — see the note on
 * the bank route — because a bank download is opaque and an accountant's export
 * is often the wrong month. A command that silently imported forty-two
 * transactions because somebody got a path wrong would be worse than the
 * screen, not better. `--commit` is the second step.
 */
export const bankImport: Command = {
  name: 'bank-import',
  summary: 'Read a statement file. Reports what it would do; --commit to do it.',
  usage: 'klopt bank-import --account <uuid> --file statement.mt940 [--commit]',
  options: { account: 'string', file: 'string', commit: 'boolean' },
  operations: ['bank.importStatement', 'bank.listAccounts'],

  async run({ client, args, out, err }) {
    if (client === null) {
      err('Not signed in. Run `klopt login`, or set KLOPT_TOKEN.')
      return 1
    }

    const file = requireOption(args, 'file')
    let account = optionOf(args, 'account')

    if (account === undefined) {
      // One bank account is the ordinary case for a small BV, and making
      // somebody paste a uuid to use the only one they have is a small
      // cruelty. More than one and it asks, by name.
      const listed = (await client.get('/bank-accounts')) as {
        accounts?: { id: string; name: string; iban: string }[]
      }
      const accounts = listed.accounts ?? []

      if (accounts.length === 1) account = accounts[0]!.id
      else {
        err(
          accounts.length === 0
            ? 'There are no bank accounts yet. Add one first.'
            : 'Which account? Pass --account with one of:',
        )
        for (const entry of accounts) err(`  ${entry.id}  ${entry.name} (${entry.iban})`)
        return 2
      }
    }

    const commit = flagOf(args, 'commit')
    const report = (await client.post('/bank-statements', {
      bankAccountId: account,
      content: readFileSync(file, 'utf8'),
      dryRun: !commit,
    })) as {
      format?: string | null
      newEntries?: number
      duplicates?: number
      imported?: number
      needsMapping?: boolean
      problems?: { severity: string; message: string }[]
    }

    if (report.needsMapping === true) {
      err('This is a CSV whose columns Klopt has not seen before.')
      err('Import it once through the bank screen, which asks about the columns and')
      err('remembers the answer. After that this command works on its own.')
      return 2
    }

    for (const problem of report.problems ?? []) {
      err(`${problem.severity}: ${problem.message}`)
    }

    if (commit) {
      out(
        `Imported ${String(report.imported ?? 0)} transaction(s); ` +
          `${String(report.duplicates ?? 0)} were already there.`,
      )
      return 0
    }

    out(`Format: ${report.format ?? 'unknown'}`)
    out(
      `Would add ${String(report.newEntries ?? 0)}; ${String(report.duplicates ?? 0)} already there.`,
    )
    out('Nothing was imported. Pass --commit to do it.')
    return 0
  },
}
