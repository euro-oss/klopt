import type { Job, PgBoss } from 'pg-boss'
import { pollInboundSourcesJob } from './inbound.js'

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

export function jobsFor(databaseUrl: string): readonly JobDefinition[] {
  return [inboundPollJob(databaseUrl)]
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
