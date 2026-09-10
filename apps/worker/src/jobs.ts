import type { Job, PgBoss } from 'pg-boss'
import { pollInboundSourcesJob } from './inbound.js'
import { purgeExpiredCodesJob } from './oauth.js'
import { sealPendingYearsJob } from './snapshots.js'

/**
 * A scheduled or queued job. Registration is data so that the worker's job list
 * is inspectable rather than buried in a boot sequence.
 *
 * The M0+ jobs land here: VAT period close, bank sync, retention snapshots and
 * the subledger-to-control-account reconciliation check (spec 6.5). None of them
 * may reach for a server function; they call @klopt/core directly, which is the
 * reason that package exists.
 */
export interface JobDefinition<TPayload = unknown> {
  readonly name: string
  /** Cron expression for scheduled jobs; omitted for queue-driven ones. */
  readonly schedule?: string
  readonly handler: (payload: TPayload) => Promise<void>
}

/**
 * Emptying the configured mailboxes into the purchase inbox.
 *
 * Every five minutes, which is the right order of magnitude for something a
 * person is waiting on but nobody is watching: fast enough that an invoice
 * forwarded before a meeting is there after it, slow enough that a mailbox is
 * not being asked six hundred times a day for nothing.
 *
 * The job body records its own outcome per source and never throws, so a
 * mailbox that is down is a line on a settings screen rather than a failed job
 * and a retry storm.
 */
function inboundPollJob(databaseUrl: string): JobDefinition {
  return {
    name: 'inbound.poll',
    schedule: '*/5 * * * *',
    handler: () => pollInboundSourcesJob(databaseUrl),
  }
}

/**
 * Sealing book years that have postings and no snapshot (spec 7.6).
 *
 * Nightly, at four, which is the point of "periodic": a snapshot somebody has
 * to remember to take is one that exists for the year somebody was paying
 * attention, and the years an inspector asks about are the other ones.
 *
 * Not hourly and not on every posting. A year already sealed is not resealed by
 * this job — three hundred and sixty-five near-identical artefacts would bury
 * the one that mattered — and resealing is a deliberate act with its own
 * button.
 */
function snapshotJob(databaseUrl: string): JobDefinition {
  return {
    name: 'snapshot.sealPendingYears',
    schedule: '0 4 * * *',
    handler: () => sealPendingYearsJob(databaseUrl),
  }
}

/**
 * Clearing out spent authorization codes.
 *
 * Nightly, and an hour after the snapshot sweep so two jobs are not competing
 * for the same connections at four. Nothing depends on it having run — an
 * expired code is refused by the check, not by its absence — so a night it
 * misses costs nothing but rows.
 */
function oauthPurgeJob(databaseUrl: string): JobDefinition {
  return {
    name: 'oauth.purgeExpiredCodes',
    schedule: '0 5 * * *',
    handler: () => purgeExpiredCodesJob(databaseUrl),
  }
}

export function jobsFor(databaseUrl: string): readonly JobDefinition[] {
  return [inboundPollJob(databaseUrl), snapshotJob(databaseUrl), oauthPurgeJob(databaseUrl)]
}

export async function registerJobs(boss: PgBoss, list: readonly JobDefinition[]): Promise<void> {
  for (const job of list) {
    await boss.createQueue(job.name)
    await boss.work(job.name, async (batch: Job<unknown>[]) => {
      // Sequential on purpose: two handlers for the same queue posting
      // concurrently is a lock-ordering problem waiting to happen.
      for (const message of batch) {
        await job.handler(message.data)
      }
    })
    if (job.schedule !== undefined) {
      await boss.schedule(job.name, job.schedule)
    }
  }
}
