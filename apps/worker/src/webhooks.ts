import { closeDatabase, createDatabase, deliverWebhooks } from '@klopt/db'

/**
 * Delivering the event stream to subscribers (spec 10.2).
 *
 * Everything about what to send and when to give up lives in
 * `deliverWebhooks`. This is the schedule and the connection, which is all a
 * job should be.
 */
export async function deliverWebhooksJob(databaseUrl: string): Promise<void> {
  const database = createDatabase({ url: databaseUrl, maxConnections: 2 })

  try {
    const report = await deliverWebhooks(database)
    if (report.delivered > 0 || report.failed > 0 || report.disabled > 0) {
      console.info(
        `[webhooks] ${String(report.delivered)} delivered, ${String(report.failed)} failed, ` +
          `${String(report.disabled)} switched off, across ${String(report.endpoints)} endpoint(s)`,
      )
    }
  } finally {
    await closeDatabase(database)
  }
}
