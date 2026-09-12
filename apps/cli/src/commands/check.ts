import type { Command } from './registry.js'
import { optionOf } from './registry.js'

/**
 * The reconciliation check (spec 10.4).
 *
 * Three questions, in the order an accountant asks them:
 *
 *   1. Does the hash chain verify? If not, a posted entry has been altered and
 *      nothing below this line is worth reading.
 *   2. Does the trial balance net to zero? A non-zero difference means the
 *      ledger is internally inconsistent, which should be impossible.
 *   3. Is everything mapped to RGS? Unmapped accounts do not appear in a
 *      report or the auditfile, so the answer is right and incomplete.
 *
 * Exit code 1 when any of them fails, so it is usable from cron. That is most
 * of the reason this command exists rather than three separate ones — nobody
 * schedules three commands and reads three outputs.
 */
export const check: Command = {
  name: 'check',
  summary: 'Verify the hash chain, the trial balance and the RGS coverage.',
  usage: 'klopt check [--year 2026]',
  options: { year: 'string' },
  operations: ['ledger.verifyChain', 'ledger.getTrialBalance', 'rgs.getCoverage'],

  async run({ client, args, out, err }) {
    if (client === null) {
      err('Not signed in. Run `klopt login`, or set KLOPT_TOKEN.')
      return 1
    }

    const year = optionOf(args, 'year') ?? String(new Date().getUTCFullYear())
    let failed = false

    const chain = (await client.get('/ledger/chain-verification')) as {
      verified?: boolean
      entryCount?: number
      headHash?: string | null
      brokenAt?: unknown
    }

    if (chain.verified === true) {
      out(
        `chain      ok         ${String(chain.entryCount ?? 0)} entries, head ${(chain.headHash ?? '—').slice(0, 16)}`,
      )
    } else {
      out('chain      BROKEN     a posted entry does not match its hash')
      failed = true
    }

    const trial = (await client.get('/reports/trial-balance', { fiscalYear: year })) as {
      difference?: string
      totalDebit?: string
      totalCredit?: string
    }

    if (trial.difference === '0') {
      out(
        `balance    ok         ${trial.totalDebit ?? '?'} debit, ${trial.totalCredit ?? '?'} credit`,
      )
    } else {
      out(`balance    OFF BY     ${trial.difference ?? '?'} in ${year}`)
      failed = true
    }

    const coverage = (await client.get('/rgs/coverage')) as {
      mappedCount?: number
      accountCount?: number
      unmappedCount?: number
      version?: string
    }

    if ((coverage.unmappedCount ?? 0) === 0) {
      out(
        `rgs        ok         ${String(coverage.accountCount ?? 0)} accounts on RGS ${coverage.version ?? '?'}`,
      )
    } else {
      // Not a failure. An unmapped account is incomplete reporting, not a
      // wrong number, and exiting 1 for it would train somebody to ignore the
      // exit code of the command whose whole job is to be believed.
      out(
        `rgs        partial    ${String(coverage.unmappedCount ?? 0)} of ` +
          `${String(coverage.accountCount ?? 0)} accounts unmapped`,
      )
    }

    return failed ? 1 : 0
  },
}
